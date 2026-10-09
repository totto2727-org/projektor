import { Effect } from 'effect'
import { FetchHttpClient, HttpServerResponse } from 'effect/http'
import { describe, expect, it, vi } from 'vite-plus/test'

import { featureDatabase } from './features/planning/action-test-fixture'
import { downloadFile } from './file-download'
import { makeRequestServices, RequestServices } from './request'
import { testEnvironment } from './server/test/resources'

function fixture(contentType = 'image/png', filename = 'diagram.png') {
  const database = featureDatabase()
  database.sqlite.exec(`
    UPDATE projects SET archived_at = 2 WHERE id = 'p1';
    INSERT INTO issues (id,workspace_id,project_id,number,title,status,priority,created_by_id,created_at,updated_at)
      VALUES ('i1','w1','p1',1,'Issue','backlog','medium','u1',1,1);
  `)
  database.sqlite
    .prepare(`INSERT INTO attachments
    (id,workspace_id,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at)
    VALUES ('a1','w1','w1/object',?,?,4,'issue','i1','u1',1)`)
    .run(filename, contentType)
  const bytes = new Uint8Array([0, 255, 7, 128])
  const consume = vi.fn(async () => bytes.buffer)
  const get = vi.fn(async (): Promise<{ arrayBuffer: typeof consume } | null> => ({ arrayBuffer: consume }))
  const r2 = { get } as unknown as R2Bucket
  const transport = vi.fn<typeof fetch>(async () => {
    throw new Error('Direct downloads must not use API HTTP.')
  })
  const env = testEnvironment(database.db, 'owner@example.test', {
    R2: r2,
    DEFAULT_WORKSPACE_SLUG: 'alpha',
    AUTO_JOIN_ROLE: 'none',
  })
  function execute(path = '/api/files/a1?workspace=alpha', method = 'GET', headers?: HeadersInit) {
    const request = new Request(`https://front.example${path}`, { method, headers })
    return Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* makeRequestServices(request, env)
        return yield* downloadFile(request).pipe(
          Effect.provideService(RequestServices, services),
          Effect.catchTags({
            ScopeError: (error) =>
              Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status })),
            ApiError: (error) =>
              Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status })),
          }),
          Effect.map(HttpServerResponse.toWeb),
        )
      }).pipe(Effect.provide(FetchHttpClient.layer), Effect.provideService(FetchHttpClient.Fetch, transport)),
    )
  }
  return { ...database, get, consume, bytes, transport, execute, env }
}

describe('direct authenticated Web file delivery', () => {
  it('delivers exact archived-owner bytes with protected browser headers and no API HTTP', async () => {
    const f = fixture()
    const response = await f.execute()
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(f.bytes)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-disposition')).toBe('inline; filename="diagram.png"')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
    expect(f.consume).toHaveBeenCalledOnce()
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('forces SVG download and sanitizes dangerous filename characters', async () => {
    const f = fixture('image/svg+xml', 'bad\r\n"\\.svg')
    const response = await f.execute()
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="bad____.svg"')
  })
  it('returns HEAD headers without response bytes after closing the R2 handle', async () => {
    const f = fixture()
    const response = await f.execute(undefined, 'HEAD')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(f.consume).toHaveBeenCalledOnce()
  })
  it('preserves hintless file links for a verified single-workspace member', async () => {
    const f = fixture()
    expect((await f.execute('/api/files/a1')).status).toBe(200)
    expect(f.get).toHaveBeenCalledOnce()
  })
  it('never guesses a workspace for a multi-workspace member or treats the file ID as a page selector', async () => {
    const f = fixture()
    f.sqlite.exec("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w2','u1','owner',1)")
    expect((await f.execute('/api/files/a1')).status).toBe(403)
    expect(f.get).not.toHaveBeenCalled()
    expect((await f.execute('/api/files/a1?workspace=alpha&projectId=foreign')).status).toBe(200)
  })
  it('rejects foreign workspace, ambiguous hint and malformed identifier before R2', async () => {
    const f = fixture()
    for (const [path, status] of [
      ['/api/files/a1?workspace=beta', 403],
      ['/api/files/a1?workspace=alpha&workspace=beta', 400],
      ['/api/files/%ZZ?workspace=alpha', 400],
      ['/api/files/missing?workspace=alpha', 404],
    ] as const)
      expect((await f.execute(path)).status).toBe(status)
    expect(f.get).not.toHaveBeenCalled()
  })
  it('rejects a foreign attachment even for an owner and does not look up its object', async () => {
    const f = fixture()
    f.sqlite.exec("UPDATE attachments SET workspace_id = 'w2' WHERE id = 'a1'")
    expect((await f.execute()).status).toBe(404)
    expect(f.get).not.toHaveBeenCalled()
  })
  it('default-denies an ungranted member but permits the archived granted owner project', async () => {
    const f = fixture()
    f.sqlite.exec("UPDATE workspace_members SET role = 'member' WHERE workspace_id = 'w1' AND user_id = 'u1'")
    expect((await f.execute()).status).toBe(404)
    expect(f.get).not.toHaveBeenCalled()
    f.sqlite.exec(`
      INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g1','w1','Readers',1);
      INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1);
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','viewer');
    `)
    expect((await f.execute()).status).toBe(200)
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('rejects bearer and invalid Access credentials rather than falling back to development auth', async () => {
    const f = fixture()
    expect((await f.execute(undefined, 'GET', { authorization: 'Bearer token' })).status).toBe(403)
    expect((await f.execute(undefined, 'GET', { cookie: 'CF_Authorization=invalid' })).status).toBe(401)
    expect(f.get).not.toHaveBeenCalled()
  })
  it('returns private safe failures and suppresses failed HEAD bodies', async () => {
    const f = fixture()
    f.get.mockRejectedValueOnce(new Error('private R2 diagnostic'))
    const response = await f.execute()
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('private R2 diagnostic')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const head = await f.execute('/api/files/missing?workspace=alpha', 'HEAD')
    expect(head.status).toBe(404)
    expect(await head.text()).toBe('')
    expect(head.headers.get('cache-control')).toBe('private, no-store')
  })
  it('maps a missing R2 object to 404 and refuses mutation verbs on the read route', async () => {
    const f = fixture()
    f.get.mockResolvedValueOnce(null)
    expect((await f.execute()).status).toBe(404)
    const response = await f.execute(undefined, 'POST')
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })
})
