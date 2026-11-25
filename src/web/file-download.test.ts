import { Effect } from 'effect'
import { FetchHttpClient, HttpServerResponse } from 'effect/http'
import { assert, describe, expect, test, vi } from 'vite-plus/test'

import { runTestEffect } from '#tests/run-effect.ts'

import { featureDatabase } from './features/planning/action-test-fixture.ts'
import { downloadFile } from './file-download.ts'
import { makeRequestServices, RequestServices } from './request.ts'
import { testEnvironment } from './server/test/resources.ts'

const fixture = function fixture(contentType = 'image/png', filename = 'diagram.png') {
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
  const consume = vi.fn<() => Promise<ArrayBuffer>>(async () => bytes.buffer)
  const get = vi.fn(async (): Promise<{ body: ReadableStream<Uint8Array>; arrayBuffer: typeof consume } | null> => {
    const { body } = new Response(bytes)
    assert.exists(body)
    return { arrayBuffer: consume, body }
  })
  const head = vi.fn<() => Promise<{ size: number }>>(async () => ({ size: bytes.length }))
  const r2 = { get, head } as unknown as R2Bucket
  const transport = vi.fn<typeof fetch>(async () => {
    throw new Error('Direct downloads must not use API HTTP.')
  })
  const env = testEnvironment(database.db, 'owner@example.test', {
    R2: r2,
    DEFAULT_WORKSPACE_SLUG: 'alpha',
    AUTO_JOIN_ROLE: 'none',
  })
  const execute = function execute(
    path = '/api/files/a1?workspace=alpha',
    method = 'GET',
    headers?: HeadersInit,
  ): Promise<Response> {
    const request = new Request(`https://front.example${path}`, { method, headers })
    return runTestEffect(
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
  return { ...database, get, head, consume, bytes, transport, execute, env }
}

describe('native Core authenticated Web file delivery', () => {
  test('delivers exact archived-owner bytes with protected browser headers and no API HTTP', async () => {
    const testFixture = fixture()
    const response = await testFixture.execute()
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(testFixture.bytes)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-disposition')).toBe('inline; filename="diagram.png"')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
    expect(testFixture.consume).not.toHaveBeenCalled()
    expect(testFixture.transport).not.toHaveBeenCalled()
  })

  test('forces SVG download and sanitizes dangerous filename characters', async () => {
    const testFixture = fixture('image/svg+xml', 'bad\r\n"\\.svg')
    const response = await testFixture.execute()
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="bad____.svg"')
  })

  test('returns HEAD headers through R2 metadata without opening the R2 body', async () => {
    const testFixture = fixture()
    const response = await testFixture.execute(undefined, 'HEAD')
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(testFixture.consume).not.toHaveBeenCalled()
    expect(testFixture.get).not.toHaveBeenCalled()
    expect(testFixture.head).toHaveBeenCalledOnce()
  })

  test('preserves hintless file links for a verified single-workspace member', async () => {
    const testFixture = fixture()
    const result = await testFixture.execute('/api/files/a1')
    expect(result.status).toBe(200)
    expect(testFixture.get).toHaveBeenCalledOnce()
  })

  test('never guesses a workspace for a multi-workspace member or treats the file ID as a page selector', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec(
      "INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w2','u1','owner',1)",
    )
    const resolvedValue = await testFixture.execute('/api/files/a1')
    expect(resolvedValue.status).toBe(403)
    expect(testFixture.get).not.toHaveBeenCalled()
    const response = await testFixture.execute('/api/files/a1?workspace=alpha&projectId=foreign')
    expect(response.status).toBe(200)
  })

  test('rejects foreign workspace, ambiguous hint and malformed identifier before R2', async () => {
    const testFixture = fixture()
    for (const [path, status] of [
      ['/api/files/a1?workspace=beta', 403],
      ['/api/files/a1?workspace=alpha&workspace=beta', 400],
      ['/api/files/%ZZ?workspace=alpha', 400],
      ['/api/files/missing?workspace=alpha', 404],
    ] as const) {
      const response = await testFixture.execute(path)
      expect(response.status).toBe(status)
    }
    expect(testFixture.get).not.toHaveBeenCalled()
  })

  test('rejects a foreign attachment even for an owner and does not look up its object', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec("UPDATE attachments SET workspace_id = 'w2' WHERE id = 'a1'")
    const response = await testFixture.execute()
    expect(response.status).toBe(404)
    expect(testFixture.get).not.toHaveBeenCalled()
  })

  test('default-denies an ungranted member but permits the archived granted owner project', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec("UPDATE workspace_members SET role = 'member' WHERE workspace_id = 'w1' AND user_id = 'u1'")
    const response = await testFixture.execute()
    expect(response.status).toBe(404)
    expect(testFixture.get).not.toHaveBeenCalled()
    testFixture.sqlite.exec(`
      INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g1','w1','Readers',1);
      INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1);
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','viewer');
    `)
    const apiResponse = await testFixture.execute()
    expect(apiResponse.status).toBe(200)
    expect(testFixture.transport).not.toHaveBeenCalled()
  })

  test('rejects bearer and invalid Access credentials rather than falling back to development auth', async () => {
    const testFixture = fixture()
    const response = await testFixture.execute(undefined, 'GET', { authorization: 'Bearer token' })
    expect(response.status).toBe(403)
    const apiResponse = await testFixture.execute(undefined, 'GET', { cookie: 'CF_Authorization=invalid' })
    expect(apiResponse.status).toBe(401)
    expect(testFixture.get).not.toHaveBeenCalled()
  })

  test('returns private safe failures and suppresses failed HEAD bodies', async () => {
    const testFixture = fixture()
    testFixture.get.mockRejectedValueOnce(new Error('private R2 diagnostic'))
    const response = await testFixture.execute()
    expect(response.status).toBe(500)
    await expect(response.text()).resolves.not.toContain('private R2 diagnostic')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const head = await testFixture.execute('/api/files/missing?workspace=alpha', 'HEAD')
    expect(head.status).toBe(404)
    await expect(head.text()).resolves.toBe('')
    expect(head.headers.get('cache-control')).toBe('private, no-store')
  })

  test('maps a missing R2 object to 404 and refuses mutation verbs on the read route', async () => {
    const testFixture = fixture()
    testFixture.get.mockResolvedValueOnce(null)
    const apiResponse = await testFixture.execute()
    expect(apiResponse.status).toBe(404)
    const response = await testFixture.execute(undefined, 'POST')
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })
})
