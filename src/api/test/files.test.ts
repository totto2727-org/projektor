import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { ApiResults } from '#contracts/api-results.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { SQL_NULL } from '#db/sql-null.ts'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  seedFixture,
  seedGroupGrant,
  seedIssue,
  seedMember,
  seedProject,
  seedToken,
  seedUser,
  seedWorkspaceRoles,
  toolError,
} from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'
import { stringifyOrderedFields, fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { resetRateLimits } from './rate-limit-reset.ts'
import { ErrorMessageResponse, IdAndSlugResponse, IdResponse, readNativeJson } from './response-json.ts'

const ENTITY_ID = crypto.randomUUID()

const mcpCall = async function mcpCall<T>(
  workspaceId: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
): Promise<JsonRpcResult<T> | JsonRpcError> {
  const res = await fetchNativeApi(
    `http://localhost/mcp/${workspaceId}`,
    requestOptionsWithBody('POST', headers, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })),
  )
  return res.json()
}

const mcpToolResult = async function mcpToolResult<T>(
  workspaceId: string,
  name: string,
  toolArgs: unknown,
  headers: Record<string, string>,
): Promise<T> {
  const res = await mcpCall<{ content: { text: string }[]; isError?: boolean }>(
    workspaceId,
    'tools/call',
    fieldsInOrder([
      ['name', name],
      ['arguments', toolArgs],
    ]),
    headers,
  )
  if ('error' in res) {
    throw new Error(`${name} failed: ${JSON.stringify(res.error)}`)
  }
  expect(res.result.isError, `${name}: ${JSON.stringify(res.result.content)}`).not.toBe(true)
  expect(res.result.content).toHaveLength(1)
  return JSON.parse(res.result.content[0].text) as T
}

const makeUploadRequest = function makeUploadRequest(
  token: string,
  slug: string,
  content = 'hello world',
  filename = 'test.txt',
): Promise<Response> {
  const form = new FormData()
  form.append('file', new File([content], filename, { type: 'text/plain' }))
  form.append('entityType', 'issue')
  form.append('entityId', ENTITY_ID)
  return fetchNativeApi('http://localhost/api/files', {
    body: form,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Workspace-Slug': slug,
    },
    method: 'POST',
  })
}

const seedFilesApiFixture = async function seedFilesApiFixture(): Promise<{
  slug: string
  token: string
  userId: string
  workspaceId: string
}> {
  const { token, workspace, user } = await seedFixture()
  return { slug: workspace.slug, token, userId: user.id, workspaceId: workspace.id }
}

describe('files API', () => {
  test('handles GET /api/files lists attachments for an entity', async () => {
    const { slug, token } = await seedFilesApiFixture()
    // Upload two files for the same entity
    await makeUploadRequest(token, slug, 'content a', 'a.txt')
    await makeUploadRequest(token, slug, 'content b', 'b.txt')

    const res = await fetchNativeApi(`http://localhost/api/files?entityType=issue&entityId=${ENTITY_ID}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const list = await readNativeJson(
      res,
      Schema.Array(
        Schema.Struct({
          contentType: Schema.String,
          createdAt: Schema.Number,
          filename: Schema.String,
          id: Schema.String,
          size: Schema.Number,
        }),
      ).pipe(Schema.mutable),
    )
    expect(list).toHaveLength(2)
    expect(list.map((attachment) => attachment.filename).toSorted()).toStrictEqual(['a.txt', 'b.txt'])
    expect(list[0]).toMatchObject({ contentType: 'text/plain' })
  })

  test('handles GET /api/files returns 400 for missing entityId', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const res = await fetchNativeApi('http://localhost/api/files?entityType=issue', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(400)
  })

  test('handles GET /api/files returns empty array when no attachments exist', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const res = await fetchNativeApi(`http://localhost/api/files?entityType=issue&entityId=${crypto.randomUUID()}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual([])
  })

  test('handles POST /api/files uploads and returns file metadata', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const res = await makeUploadRequest(token, slug)
    expect(res.status).toBe(201)
    const body = await readNativeJson(
      res,
      Schema.Struct({ contentType: Schema.String, filename: Schema.String, id: Schema.String, size: Schema.Number }),
    )
    expect(isNonEmptyText(body.id)).toBe(true)
    expect(body.filename).toBe('test.txt')
    expect(body.contentType).toBe('text/plain')
    expect(body.size).toBe('hello world'.length)
  })

  test('handles GET /api/files/:id returns the uploaded content', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const uploadRes = await makeUploadRequest(token, slug, 'round-trip content', 'data.txt')
    const { id } = await readNativeJson(uploadRes, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/files/${id}`, {
      headers: authHeaders(token, slug),
    })
    expect(getRes.status).toBe(200)
    // The text/plain media type is not in the inline allowlist — served as octet-stream to prevent XSS
    expect(getRes.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(getRes.headers.get('Content-Disposition')).toContain('attachment')
    expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const text = await getRes.text()
    expect(text).toBe('round-trip content')
  })

  test('handles GET /api/files/:id serves images inline with their original content type', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const form = new FormData()
    // 1x1 transparent GIF
    const gifBytes = new Uint8Array([
      71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 255, 255, 255, 0, 0, 0, 33, 249, 4, 0, 0, 0, 0, 0, 44, 0, 0, 0, 0,
      1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
    ])
    form.append('file', new File([gifBytes], 'img.gif', { type: 'image/gif' }))
    form.append('entityType', 'issue')
    form.append('entityId', ENTITY_ID)
    const uploadRes = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    const { id } = await readNativeJson(uploadRes, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/files/${id}`, {
      headers: authHeaders(token, slug),
    })
    expect(getRes.status).toBe(200)
    expect(getRes.headers.get('Content-Type')).toBe('image/gif')
    expect(getRes.headers.get('Content-Disposition')).toContain('inline')
  })

  test('handles GET /api/files/:id/metadata returns the attachment metadata', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const uploadRes = await makeUploadRequest(token, slug, 'meta content', 'meta.txt')
    const { id } = await readNativeJson(uploadRes, IdResponse)

    const res = await fetchNativeApi(`http://localhost/api/files/${id}/metadata`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(
      res,
      Schema.Struct({ contentType: Schema.String, filename: Schema.String, id: Schema.String }),
    )
    expect(body.id).toBe(id)
    expect(body.filename).toBe('meta.txt')
    expect(body.contentType).toBe('text/plain')
  })

  test('handles GET /api/files/:id/metadata returns 404 for an unknown id', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const res = await fetchNativeApi(`http://localhost/api/files/${crypto.randomUUID()}/metadata`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(404)
  })

  test('handles DELETE /api/files/:id removes the file', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const uploadRes = await makeUploadRequest(token, slug)
    const { id } = await readNativeJson(uploadRes, IdResponse)

    const delRes = await fetchNativeApi(`http://localhost/api/files/${id}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(delRes.status).toBe(204)

    const getRes = await fetchNativeApi(`http://localhost/api/files/${id}`, {
      headers: authHeaders(token, slug),
    })
    expect(getRes.status).toBe(404)
  })

  /*
   * PROJ-494: an inline <img> tag rendering an attachment in wiki content can't set a
   * custom X-Workspace-Slug header, so GET falls back to a `?workspace=` query param.
   */
  test('handles GET /api/files/:id resolves the workspace from a ?workspace= query param when no header is sent', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const uploadRes = await makeUploadRequest(token, slug, 'query-param content', 'q.txt')
    const { id } = await readNativeJson(uploadRes, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/files/${id}?workspace=${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(getRes.status).toBe(200)
    await expect(getRes.text()).resolves.toBe('query-param content')
  })

  test('handles GET /api/files/:id via ?workspace= still 404s for a file in a different workspace', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const uploadRes = await makeUploadRequest(token, slug, 'content', 'q2.txt')
    const { id } = await readNativeJson(uploadRes, IdResponse)

    const other = await seedFixture()
    const getRes = await fetchNativeApi(`http://localhost/api/files/${id}?workspace=${other.workspace.slug}`, {
      headers: { Authorization: `Bearer ${other.token}` },
    })
    expect(getRes.status).toBe(404)
  })

  test('handles POST /api/files does not honor ?workspace= — the header is still required', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const form = new FormData()
    form.append('file', new File(['data'], 'f.txt', { type: 'text/plain' }))
    form.append('entityType', 'issue')
    form.append('entityId', ENTITY_ID)
    const res = await fetchNativeApi(`http://localhost/api/files?workspace=${slug}`, {
      body: form,
      headers: { Authorization: `Bearer ${token}` },
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('handles GET /api/files/:id returns 404 for a different workspace', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const uploadRes = await makeUploadRequest(token, slug)
    const { id } = await readNativeJson(uploadRes, IdResponse)

    // Second workspace — different member
    const other = await seedFixture()

    const getRes = await fetchNativeApi(`http://localhost/api/files/${id}`, {
      headers: authHeaders(other.token, other.workspace.slug),
    })
    expect(getRes.status).toBe(404)
  })

  test('handles DELETE /api/files/:id returns 404 when accessed from a different workspace', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const uploadRes = await makeUploadRequest(token, slug)
    const { id } = await readNativeJson(uploadRes, IdResponse)

    const other = await seedFixture()

    const delRes = await fetchNativeApi(`http://localhost/api/files/${id}`, {
      headers: authHeaders(other.token, other.workspace.slug),
      method: 'DELETE',
    })
    expect(delRes.status).toBe(404)
  })

  test('handles POST /api/files rejects unauthenticated requests', async () => {
    await seedFilesApiFixture()
    const form = new FormData()
    form.append('file', new File(['data'], 'f.txt', { type: 'text/plain' }))
    form.append('entityType', 'issue')
    form.append('entityId', ENTITY_ID)
    const res = await fetchNativeApi('http://localhost/api/files', { body: form, method: 'POST' })
    expect(res.status).toBe(401)
  })

  test('handles POST /api/files rejects invalid entityType', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const form = new FormData()
    form.append('file', new File(['data'], 'f.txt', { type: 'text/plain' }))
    form.append('entityType', 'project')
    form.append('entityId', ENTITY_ID)
    const res = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Workspace-Slug': slug,
      },
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('handles POST /api/files rejects disallowed content type (text/html) → 415', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const form = new FormData()
    form.append('file', new File(['<html>evil</html>'], 'evil.html', { type: 'text/html' }))
    form.append('entityType', 'issue')
    form.append('entityId', ENTITY_ID)
    const res = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    expect(res.status).toBe(415)
    const body = await readNativeJson(res, ErrorMessageResponse)
    expect(body.error).toBe('File type not allowed')
  })

  test('handles POST /api/files rejects empty content type → 415', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const form = new FormData()
    form.append('file', new File(['data'], 'noext', { type: '' }))
    form.append('entityType', 'issue')
    form.append('entityId', ENTITY_ID)
    const res = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    expect(res.status).toBe(415)
    const body = await readNativeJson(res, ErrorMessageResponse)
    expect(body.error).toBe('File type not allowed')
  })

  test('handles POST /api/files rejects a file over 50 MB → 413', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const big = new Uint8Array(50 * 1024 * 1024 + 1)
    const form = new FormData()
    form.append('file', new File([big], 'big.png', { type: 'image/png' }))
    form.append('entityType', 'issue')
    form.append('entityId', ENTITY_ID)
    const res = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    expect(res.status).toBe(413)
    const body = await readNativeJson(res, ErrorMessageResponse)
    expect(body.error).toBe('File too large (max 50 MB)')
  })

  test('handles POST /api/files accepts wiki_page entityType', async () => {
    const { slug, token } = await seedFilesApiFixture()
    const wikiPageId = crypto.randomUUID()
    const form = new FormData()
    form.append('file', new File(['wiki content'], 'wiki.txt', { type: 'text/plain' }))
    form.append('entityType', 'wiki_page')
    form.append('entityId', wikiPageId)
    const res = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const body = await readNativeJson(res, Schema.Struct({ filename: Schema.String, id: Schema.String }))
    expect(body.filename).toBe('wiki.txt')

    // Can list the attachment back
    const listRes = await fetchNativeApi(`http://localhost/api/files?entityType=wiki_page&entityId=${wikiPageId}`, {
      headers: authHeaders(token, slug),
    })
    expect(listRes.status).toBe(200)
    const list = await readNativeJson(
      listRes,
      Schema.Array(Schema.Struct({ filename: Schema.String })).pipe(Schema.mutable),
    )
    expect(list).toHaveLength(1)
    expect(list[0].filename).toBe('wiki.txt')
  })

  test('handles POST /api/files rejects when workspace quota would be exceeded → 413', async () => {
    const { slug, token, userId, workspaceId } = await seedFilesApiFixture()
    // 1 GB
    const QUOTA = 1024 * 1024 * 1024
    const now = currentEpochSeconds()
    // Insert a fake attachment that consumes all but 1 byte of the quota
    await env.DB.prepare(
      `INSERT INTO attachments (id, workspace_id, r2_key, filename, content_type, size, entity_type,
       entity_id, created_by_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        workspaceId,
        'fake/r2key',
        'existing.png',
        'image/png',
        QUOTA - 1,
        'issue',
        ENTITY_ID,
        userId,
        now,
      )
      .run()

    // A 2-byte upload pushes total to QUOTA + 1, exceeding the limit
    const form = new FormData()
    form.append('file', new File(['xy'], 'tiny.png', { type: 'image/png' }))
    form.append('entityType', 'issue')
    form.append('entityId', ENTITY_ID)
    const res = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    expect(res.status).toBe(413)
    const body = await readNativeJson(res, ErrorMessageResponse)
    expect(body.error).toBe('Workspace storage quota exceeded (1024 MB)')
  })

  describe('handles POST /api/files/links (wiki_ref and url attachment kinds)', () => {
    const createWikiPage = async function createWikiPage(headers: Record<string, string>): Promise<string> {
      const res = await fetchNativeApi(
        'http://localhost/api/wiki',
        requestOptionsWithBody(
          'POST',
          { ...headers, 'Content-Type': 'application/json' },
          JSON.stringify({ content: 'hello', title: 'Linked page' }),
        ),
      )
      const body = await readNativeJson(res, IdResponse)
      return body.id
    }

    test('attaches a wiki page reference and lists it with title/url', async () => {
      const { slug, token } = await seedFilesApiFixture()
      const headers = { ...authHeaders(token, slug), 'Content-Type': 'application/json' }
      const wikiPageId = await createWikiPage(headers)

      const res = await fetchNativeApi(
        'http://localhost/api/files/links',
        requestOptionsWithBody(
          'POST',
          headers,
          JSON.stringify({
            entityId: ENTITY_ID,
            entityType: 'issue',
            kind: 'wiki_ref',
            wikiPageId,
          }),
        ),
      )
      expect(res.status).toBe(201)
      await expect(res.json()).resolves.toMatchObject({ id: expect.any(String), kind: 'wiki_ref' })

      const listRes = await fetchNativeApi(`http://localhost/api/files?entityType=issue&entityId=${ENTITY_ID}`, {
        headers: authHeaders(token, slug),
      })
      const listShape = Schema.Array(
        Schema.Struct({
          kind: Schema.String,
          wikiPage: Schema.Union([
            Schema.Struct({ id: Schema.String, title: Schema.String, url: Schema.String }),
            Schema.Null,
          ]),
        }),
      ).pipe(Schema.mutable)
      const list = await readNativeJson(listRes, listShape)
      const entry = list.find((link) => link.kind === 'wiki_ref')
      expect(entry?.wikiPage?.title).toBe('Linked page')
      expect(entry?.wikiPage?.id).toBe(wikiPageId)
    })

    test('rejects a wiki_ref for a non-existent wiki page → 404', async () => {
      const { slug, token } = await seedFilesApiFixture()
      const requestOptions = requestOptionsWithBody(
        'POST',
        { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
        stringifyOrderedFields([
          ['kind', 'wiki_ref'],
          ['entityType', 'issue'],
          ['entityId', ENTITY_ID],
          ['wikiPageId', crypto.randomUUID()],
        ]),
      )
      const res = await fetchNativeApi('http://localhost/api/files/links', requestOptions)
      expect(res.status).toBe(404)
    })

    test('attaches a URL with a label and lists it', async () => {
      const { slug, token } = await seedFilesApiFixture()
      const res = await fetchNativeApi(
        'http://localhost/api/files/links',
        requestOptionsWithBody(
          'POST',
          { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
          stringifyOrderedFields([
            ['kind', 'url'],
            ['entityType', 'issue'],
            ['entityId', ENTITY_ID],
            ['url', 'https://example.com/doc'],
            ['label', 'Design doc'],
          ]),
        ),
      )
      expect(res.status).toBe(201)
      await expect(res.json()).resolves.toMatchObject({ id: expect.any(String), kind: 'url' })

      const listRes = await fetchNativeApi(`http://localhost/api/files?entityType=issue&entityId=${ENTITY_ID}`, {
        headers: authHeaders(token, slug),
      })
      const listShape = Schema.Array(
        Schema.Struct({
          filename: Schema.String,
          kind: Schema.String,
          url: Schema.Union([Schema.String, Schema.Null]),
        }),
      ).pipe(Schema.mutable)
      const list = await readNativeJson(listRes, listShape)
      const entry = list.find((link) => link.kind === 'url')
      expect(entry?.filename).toBe('Design doc')
      expect(entry?.url).toBe('https://example.com/doc')
    })

    test.each(['not-a-url', 'https://[broken', '/relative/path'])('rejects a malformed URL → 400: %s', async (url) => {
      const { slug, token } = await seedFilesApiFixture()
      const res = await fetchNativeApi(
        'http://localhost/api/files/links',
        requestOptionsWithBody(
          'POST',
          { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
          JSON.stringify({
            entityId: ENTITY_ID,
            entityType: 'issue',
            kind: 'url',
            url,
          }),
        ),
      )
      expect(res.status).toBe(400)
    })

    test.each(['http://example.com/doc', 'mailto:review@example.com'])(
      'accepts URLs supported by the standard validator: %s',
      async (url) => {
        const { slug, token } = await seedFilesApiFixture()
        const res = await fetchNativeApi(
          'http://localhost/api/files/links',
          requestOptionsWithBody(
            'POST',
            { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
            JSON.stringify({
              entityId: ENTITY_ID,
              entityType: 'issue',
              kind: 'url',
              url,
            }),
          ),
        )
        expect(res.status).toBe(201)
      },
    )

    test('handles DELETE removes a link attachment without touching R2', async () => {
      const { slug, token } = await seedFilesApiFixture()
      const headers = { ...authHeaders(token, slug), 'Content-Type': 'application/json' }
      const createRes = await fetchNativeApi(
        'http://localhost/api/files/links',
        requestOptionsWithBody(
          'POST',
          headers,
          stringifyOrderedFields([
            ['kind', 'url'],
            ['entityType', 'issue'],
            ['entityId', ENTITY_ID],
            ['url', 'https://example.com'],
          ]),
        ),
      )
      const { id } = await readNativeJson(createRes, IdResponse)

      const delRes = await fetchNativeApi(`http://localhost/api/files/${id}`, {
        headers: authHeaders(token, slug),
        method: 'DELETE',
      })
      expect(delRes.status).toBe(204)
    })

    test('rejects attaching a project-scoped wiki page the caller cannot see → 404', async () => {
      const { slug, token, workspaceId } = await seedFilesApiFixture()
      /*
       * The default fixture user is a plain member with no group grant, so a
       * freshly created project-scoped page is invisible to them (PROJ-311
       * default-deny). Bootstrap an admin in the same workspace to create it.
       */
      const adminUser = await seedUser(`admin-${crypto.randomUUID()}@example.com`)
      await seedMember(workspaceId, adminUser.id, 'admin')
      const adminToken = await seedToken(workspaceId, adminUser.id)

      const project = await seedProject(workspaceId)
      const pageRes = await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({
          content: 'secret',
          projectId: project.id,
          title: 'Restricted page',
        }),
        headers: authHeaders(adminToken, slug),
        method: 'POST',
      })
      const { id: restrictedPageId } = await readNativeJson(pageRes, IdResponse)

      const res = await fetchNativeApi(
        'http://localhost/api/files/links',
        requestOptionsWithBody(
          'POST',
          { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
          JSON.stringify({
            entityId: ENTITY_ID,
            entityType: 'issue',
            kind: 'wiki_ref',
            wikiPageId: restrictedPageId,
          }),
        ),
      )
      expect(res.status).toBe(404)
    })

    test("does not leak a project-scoped wiki page's title to a caller without project access", async () => {
      const { slug, token, workspaceId } = await seedFilesApiFixture()
      const adminUser = await seedUser(`admin-${crypto.randomUUID()}@example.com`)
      await seedMember(workspaceId, adminUser.id, 'admin')
      const adminToken = await seedToken(workspaceId, adminUser.id)
      const adminHeaders = { ...authHeaders(adminToken, slug), 'Content-Type': 'application/json' }

      const project = await seedProject(workspaceId)
      const pageRes = await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({
          content: 'secret',
          projectId: project.id,
          title: 'Secret project page',
        }),
        headers: adminHeaders,
        method: 'POST',
      })
      const { id: restrictedPageId } = await readNativeJson(pageRes, IdResponse)

      /*
       * Admin attaches it to an entity — the attachment itself is workspace-visible,
       * only the joined wiki page details should be gated.
       */
      const entityId = crypto.randomUUID()
      const linkRes = await fetchNativeApi('http://localhost/api/files/links', {
        body: JSON.stringify({
          entityId,
          entityType: 'issue',
          kind: 'wiki_ref',
          wikiPageId: restrictedPageId,
        }),
        headers: adminHeaders,
        method: 'POST',
      })
      expect(linkRes.status).toBe(201)

      const listRes = await fetchNativeApi(`http://localhost/api/files?entityType=issue&entityId=${entityId}`, {
        headers: authHeaders(token, slug),
      })
      const list = await readNativeJson(
        listRes,
        Schema.Array(Schema.Struct({ kind: Schema.String, wikiPage: Schema.Unknown })).pipe(Schema.mutable),
      )
      const entry = list.find((link) => link.kind === 'wiki_ref')
      expect(entry?.wikiPage).toBeNull()
    })

    test('trashing the linked wiki page leaves the wiki_ref attachment in place until purge (PROJ-496)', async () => {
      const { slug, workspaceId } = await seedFilesApiFixture()
      /*
       * Deleting a workspace-level page requires admin/owner, so create+delete
       * through a dedicated admin rather than the default member fixture.
       */
      const adminUser = await seedUser(`admin-${crypto.randomUUID()}@example.com`)
      await seedMember(workspaceId, adminUser.id, 'admin')
      const adminToken = await seedToken(workspaceId, adminUser.id)
      const adminHeaders = { ...authHeaders(adminToken, slug), 'Content-Type': 'application/json' }

      const pageRes = await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({ content: 'will be deleted', title: 'Doomed page' }),
        headers: adminHeaders,
        method: 'POST',
      })
      const { id: wikiPageId, slug: wikiPageSlug } = await readNativeJson(pageRes, IdAndSlugResponse)

      const entityId = crypto.randomUUID()
      const linkRes = await fetchNativeApi('http://localhost/api/files/links', {
        body: JSON.stringify({ entityId, entityType: 'issue', kind: 'wiki_ref', wikiPageId }),
        headers: adminHeaders,
        method: 'POST',
      })
      expect(linkRes.status).toBe(201)

      const delRes = await fetchNativeApi(`http://localhost/api/wiki/${wikiPageSlug}`, {
        headers: adminHeaders,
        method: 'DELETE',
      })
      expect(delRes.status).toBe(200)

      /*
       * PROJ-496: wiki attachment/wiki_ref cleanup (deleteWikiPageAttachments) moved
       * from delete time to purge time — the pointer attachment must still exist right
       * after the page is trashed.
       */
      const listRes = await fetchNativeApi(`http://localhost/api/files?entityType=issue&entityId=${entityId}`, {
        headers: adminHeaders,
      })
      const list = await readNativeJson(
        listRes,
        Schema.Array(Schema.Struct({ id: Schema.String, kind: Schema.String, wikiPage: Schema.Unknown })).pipe(
          Schema.mutable,
        ),
      )
      const trashedEntry = list.find((link) => link.kind === 'wiki_ref')
      expect(trashedEntry).toBeDefined()
      /*
       * The page still exists (not yet purged) but is trashed — it must behave like the
       * existing "unavailable ref" case (a non-visible/deleted page), not resolve full
       * title/url details for a page the user can no longer see live.
       */
      expect(trashedEntry?.wikiPage).toBeNull()

      await resetRateLimits()
      const metadata = await mcpToolResult<{ wikiPage: unknown }>(
        workspaceId,
        'get_attachment',
        { id: trashedEntry?.id },
        adminHeaders,
      )
      expect(metadata.wikiPage).toBeNull()

      await env.DB.prepare('UPDATE wiki_pages SET deleted_at = ? WHERE id = ?')
        .bind(currentEpochSeconds() - 31 * 24 * 60 * 60, wikiPageId)
        .run()
      await resetRateLimits()
      const purgeRes = await fetchNativeApi('http://localhost/api/wiki/purge-trash', {
        headers: adminHeaders,
        method: 'POST',
      })
      expect(purgeRes.status).toBe(200)

      await resetRateLimits()
      const listAfterPurge = await fetchNativeApi(`http://localhost/api/files?entityType=issue&entityId=${entityId}`, {
        headers: adminHeaders,
      })
      const listAfter = await readNativeJson(
        listAfterPurge,
        Schema.Array(Schema.Struct({ kind: Schema.String })).pipe(Schema.mutable),
      )
      expect(listAfter.find((link) => link.kind === 'wiki_ref')).toBeUndefined()
    })
  })

  describe('covers PROJ-425: viewer role is denied write access', () => {
    test('handles POST /api/files rejects a viewer upload → 403', async () => {
      await seedFilesApiFixture()
      const { workspace, viewer } = await seedWorkspaceRoles()
      const form = new FormData()
      form.append('file', new File(['data'], 'f.txt', { type: 'text/plain' }))
      form.append('entityType', 'issue')
      form.append('entityId', crypto.randomUUID())
      const res = await fetchNativeApi('http://localhost/api/files', {
        body: form,
        headers: { Authorization: `Bearer ${viewer.token}`, 'X-Workspace-Slug': workspace.slug },
        method: 'POST',
      })
      expect(res.status).toBe(403)
    })

    test('handles POST /api/files/links rejects a viewer → 403', async () => {
      await seedFilesApiFixture()
      const { workspace, viewer } = await seedWorkspaceRoles()
      const viewerRequestOptions = requestOptionsWithBody(
        'POST',
        {
          ...authHeaders(viewer.token, workspace.slug),
          'Content-Type': 'application/json',
        },
        stringifyOrderedFields([
          ['kind', 'url'],
          ['entityType', 'issue'],
          ['entityId', crypto.randomUUID()],
          ['url', 'https://example.com'],
        ]),
      )
      const res = await fetchNativeApi('http://localhost/api/files/links', viewerRequestOptions)
      expect(res.status).toBe(403)
    })

    test('handles DELETE /api/files/:id rejects a viewer → 403', async () => {
      await seedFilesApiFixture()
      const { workspace, owner, viewer } = await seedWorkspaceRoles()
      const form = new FormData()
      form.append('file', new File(['data'], 'f.txt', { type: 'text/plain' }))
      form.append('entityType', 'issue')
      form.append('entityId', crypto.randomUUID())
      const uploadRes = await fetchNativeApi('http://localhost/api/files', {
        body: form,
        headers: { Authorization: `Bearer ${owner.token}`, 'X-Workspace-Slug': workspace.slug },
        method: 'POST',
      })
      const { id } = await readNativeJson(uploadRes, IdResponse)

      const delRes = await fetchNativeApi(`http://localhost/api/files/${id}`, {
        headers: authHeaders(viewer.token, workspace.slug),
        method: 'DELETE',
      })
      expect(delRes.status).toBe(403)
    })
  })
})

/*
 * PROJ-234: attachments previously had no MCP surface at all. list/get/create-link/delete
 * are metadata-only (no binary), so they get full MCP parity; upload/download remain
 * REST-only (AGENTS.md exception).
 */
describe('files MCP tools', () => {
  type TestData = Readonly<{
    slug: string
    token: string
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedFixture()
    const { token } = fixture
    const { slug } = fixture.workspace
    const workspaceId = fixture.workspace.id
    return { slug, token, workspaceId }
  }

  test('create_link_attachment + list_attachments + get_attachment + delete_attachment round-trip', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const headers = authHeaders(token, slug)
    const entityId = crypto.randomUUID()

    const created = await mcpToolResult<{ id: string; kind: string }>(
      workspaceId,
      'create_link_attachment',
      { kind: 'url', entityType: 'issue', entityId, url: 'https://example.com', label: 'Docs' },
      headers,
    )
    expect(created.kind).toBe('url')

    const list = await mcpToolResult<{ id: string; filename: string; url: string | null }[]>(
      workspaceId,
      'list_attachments',
      { entityType: 'issue', entityId },
      headers,
    )
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].url).toBe('https://example.com')

    const meta = await mcpToolResult<{ id: string; filename: string }>(
      workspaceId,
      'get_attachment',
      { id: created.id },
      headers,
    )
    expect(meta.filename).toBe('Docs')

    await mcpToolResult<{ ok: true }>(workspaceId, 'delete_attachment', { id: created.id }, headers)

    const afterDelete = await mcpToolResult<unknown[]>(
      workspaceId,
      'list_attachments',
      { entityType: 'issue', entityId },
      headers,
    )
    expect(afterDelete).toHaveLength(0)
  })

  test('get_attachment returns a not_found tool error for an unknown id', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const res = await mcpCall(
      workspaceId,
      'tools/call',
      fieldsInOrder([
        ['name', 'get_attachment'],
        ['arguments', { id: crypto.randomUUID() }],
      ]),
      authHeaders(token, slug),
    )
    expect('error' in (res as object)).toBe(false)
    expect(toolError(res)?.code).toBe('not_found')
  })

  test('create_link_attachment rejects a wiki_ref for a non-existent page', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const res = await mcpCall(
      workspaceId,
      'tools/call',
      fieldsInOrder([
        ['name', 'create_link_attachment'],
        [
          'arguments',
          {
            kind: 'wiki_ref',
            entityType: 'issue',
            entityId: crypto.randomUUID(),
            wikiPageId: crypto.randomUUID(),
          },
        ],
      ]),
      authHeaders(token, slug),
    )
    expect('error' in (res as object)).toBe(false)
    expect(toolError(res)?.code).toBe('not_found')
  })

  test('delete_attachment via MCP also removes the underlying R2 object for uploaded files', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const form = new FormData()
    form.append('file', new File(['mcp delete test'], 'mcp.txt', { type: 'text/plain' }))
    form.append('entityType', 'issue')
    form.append('entityId', crypto.randomUUID())
    const uploadRes = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    const { id } = await readNativeJson(uploadRes, IdResponse)

    const row = await env.DB.prepare('SELECT r2_key FROM attachments WHERE id = ?').bind(id).first<{ r2_key: string }>()
    await expect(env.R2.get(row?.r2_key ?? '')).resolves.not.toBeNull()

    await mcpToolResult<{ ok: true }>(workspaceId, 'delete_attachment', { id }, authHeaders(token, slug))

    await expect(env.R2.get(row?.r2_key ?? '')).resolves.toBeNull()
  })

  test('list_attachments scopes by workspace — another workspace sees no rows for the same entityId', async () => {
    await seedTestData()
    const other = await seedFixture()
    const result = await mcpToolResult<unknown[]>(
      other.workspace.id,
      'list_attachments',
      { entityType: 'issue', entityId: ENTITY_ID },
      authHeaders(other.token, other.workspace.slug),
    )
    expect(result).toStrictEqual([])
  })

  test('create_link_attachment via MCP rejects a viewer session with a forbidden tool error', async () => {
    await seedTestData()
    const { workspace, viewer } = await seedWorkspaceRoles()
    const res = await mcpCall(
      workspace.id,
      'tools/call',
      fieldsInOrder([
        ['name', 'create_link_attachment'],
        [
          'arguments',
          {
            kind: 'url',
            entityType: 'issue',
            entityId: crypto.randomUUID(),
            url: 'https://example.com',
          },
        ],
      ]),
      authHeaders(viewer.token, workspace.slug),
    )
    expect('error' in (res as object)).toBe(false)
    expect(toolError(res)?.code).toBe('forbidden')
  })

  test('delete_attachment via MCP rejects a viewer session with a forbidden tool error', async () => {
    await seedTestData()
    const { workspace, owner, viewer } = await seedWorkspaceRoles()
    const created = await mcpToolResult<{ id: string }>(
      workspace.id,
      'create_link_attachment',
      {
        kind: 'url',
        entityType: 'issue',
        entityId: crypto.randomUUID(),
        url: 'https://example.com',
      },
      authHeaders(owner.token, workspace.slug),
    )

    const res = await mcpCall(
      workspace.id,
      'tools/call',
      fieldsInOrder([
        ['name', 'delete_attachment'],
        ['arguments', { id: created.id }],
      ]),
      authHeaders(viewer.token, workspace.slug),
    )
    expect('error' in (res as object)).toBe(false)
    expect(toolError(res)?.code).toBe('forbidden')
  })
})

type AttachmentVisibilityFixture = Readonly<{
  adminToken: string
  grantedProjectId: string
  hiddenAttachmentId: string
  hiddenIssueId: string
  hiddenR2Key: string
  memberId: string
  memberToken: string
  slug: string
  workspaceId: string
}>

const seedAttachment = async function seedAttachment(
  { workspaceId, memberId }: Pick<AttachmentVisibilityFixture, 'memberId' | 'workspaceId'>,
  { entityType, entityId, filename }: Readonly<{ entityType: string; entityId: string; filename: string }>,
): Promise<{ id: string; r2Key: string }> {
  const id = crypto.randomUUID()
  const r2Key = `${workspaceId}/${crypto.randomUUID()}`
  await env.R2.put(r2Key, 'secret bytes')
  await env.DB.prepare(
    `INSERT INTO attachments (id, workspace_id, kind, r2_key, filename, content_type, size,
	       entity_type, entity_id, created_by_id, created_at)
	     VALUES (?, ?, 'file', ?, ?, 'text/plain', 12, ?, ?, ?, ?)`,
  )
    .bind(id, workspaceId, r2Key, filename, entityType, entityId, memberId, currentEpochSeconds())
    .run()
  return { id, r2Key }
}

const seedAttachmentVisibilityFixture =
  async function seedAttachmentVisibilityFixture(): Promise<AttachmentVisibilityFixture> {
    const { workspace, token: memberToken, user } = await seedFixture()
    const { slug, id: workspaceId } = workspace
    const memberId = user.id

    const admin = await seedUser(`admin-${crypto.randomUUID().slice(0, 8)}@example.com`)
    await seedMember(workspaceId, admin.id, 'admin')
    const adminToken = await seedToken(workspaceId, admin.id)

    const granted = await seedProject(workspaceId, 'OPEN')
    await seedGroupGrant(workspaceId, memberId, granted.id, 'member')

    const hidden = await seedProject(workspaceId, 'SECRET')
    const issue = await seedIssue(workspaceId, hidden.id, admin.id, { title: 'Hidden issue' })
    const attachment = await seedAttachment(
      { memberId, workspaceId },
      { entityId: issue.id, entityType: 'issue', filename: 'confidential.txt' },
    )
    return {
      adminToken,
      grantedProjectId: granted.id,
      hiddenAttachmentId: attachment.id,
      hiddenIssueId: issue.id,
      hiddenR2Key: attachment.r2Key,
      memberId,
      memberToken,
      slug,
      workspaceId,
    }
  }

const asMember = ({
  memberToken,
  slug,
}: Pick<AttachmentVisibilityFixture, 'memberToken' | 'slug'>): {
  Authorization: string
  'X-Workspace-Slug': string
  'Content-Type': string
} => authHeaders(memberToken, slug)

/*
 * PROJ-639: an attachment hangs off an issue or a wiki page, and those live in projects
 * that are default-deny. Nothing resolved that chain, so workspace membership alone got
 * you the filename, size and bytes of every attachment in the workspace.
 */
describe('attachment project visibility', () => {
  // A project the member holds no grant on, with an issue and an attachment on it.
  // A project the member can write.

  test('hides attachments on an issue in a project the member has no grant on', async () => {
    const visibilityFixture = await seedAttachmentVisibilityFixture()
    const { hiddenIssueId } = visibilityFixture
    const res = await fetchNativeApi(`http://localhost/api/files?entityType=issue&entityId=${hiddenIssueId}`, {
      headers: asMember(visibilityFixture),
    })
    expect(res.status).toBe(200)
    /*
     * The filename alone is the leak this closes — "acquisition-terms.pdf" on a ticket
     * you cannot see tells you plenty without the bytes.
     */
    await expect(res.json()).resolves.toStrictEqual([])
  })

  test('404s the metadata read for an attachment on an invisible issue', async () => {
    const visibilityFixture = await seedAttachmentVisibilityFixture()
    const { hiddenAttachmentId } = visibilityFixture
    const res = await fetchNativeApi(`http://localhost/api/files/${hiddenAttachmentId}/metadata`, {
      headers: asMember(visibilityFixture),
    })
    expect(res.status).toBe(404)
  })

  test('404s the download rather than streaming the bytes', async () => {
    const visibilityFixture = await seedAttachmentVisibilityFixture()
    const { hiddenAttachmentId } = visibilityFixture
    const res = await fetchNativeApi(`http://localhost/api/files/${hiddenAttachmentId}`, {
      headers: asMember(visibilityFixture),
    })
    expect(res.status).toBe(404)
    /*
     * Assert on the body too: the route 404s separately when the R2 object is missing,
     * so a status check alone would pass even if authz were bypassed and the object
     * simply absent. This proves the row was never handed over.
     */
    await expect(res.text()).resolves.not.toContain('secret bytes')
  })

  test('404s the delete and leaves the R2 object intact', async () => {
    const visibilityFixture = await seedAttachmentVisibilityFixture()
    const { hiddenAttachmentId, hiddenR2Key } = visibilityFixture
    const res = await fetchNativeApi(`http://localhost/api/files/${hiddenAttachmentId}`, {
      headers: asMember(visibilityFixture),
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
    await expect(env.R2.get(hiddenR2Key)).resolves.not.toBeNull()
    const row = await env.DB.prepare('SELECT id FROM attachments WHERE id = ?').bind(hiddenAttachmentId).first()
    expect(row).not.toBeNull()
  })

  test('hides attachments on a wiki page in an invisible project, but not workspace-level ones', async () => {
    const visibilityFixture = await seedAttachmentVisibilityFixture()
    const { memberId, workspaceId } = visibilityFixture
    const now = currentEpochSeconds()
    const hiddenProject = await env.DB.prepare("SELECT id FROM projects WHERE workspace_id = ? AND key = 'SECRET'")
      .bind(workspaceId)
      .first<{ id: string }>()

    const pages: Record<string, string> = {
      scoped: crypto.randomUUID(),
      global: crypto.randomUUID(),
    }
    for (const [name, id] of Object.entries(pages)) {
      await env.DB.prepare(
        `INSERT INTO wiki_pages (id, workspace_id, project_id, slug, title, content,
		       parent_id, created_by_id, updated_by_id, created_at, updated_at)
		     VALUES (?, ?, ?, ?, ?, '', NULL, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          workspaceId,
          name === 'scoped' ? hiddenProject?.id : SQL_NULL,
          `page-${name}-${id.slice(0, 8)}`,
          name,
          memberId,
          memberId,
          now,
          now,
        )
        .run()
      await seedAttachment(visibilityFixture, { entityId: id, entityType: 'wiki_page', filename: `${name}.txt` })
    }

    const scoped = await fetchNativeApi(`http://localhost/api/files?entityType=wiki_page&entityId=${pages.scoped}`, {
      headers: asMember(visibilityFixture),
    })
    await expect(scoped.json()).resolves.toStrictEqual([])

    /*
     * A null project_id is a workspace-level page. Filtering these out too would be a
     * silent regression that the invisible-project assertions above cannot catch.
     */
    const global = await fetchNativeApi(`http://localhost/api/files?entityType=wiki_page&entityId=${pages.global}`, {
      headers: asMember(visibilityFixture),
    })
    const visibleAttachments = await readNativeJson(global, ApiResults.apiListAttachments)
    expect(visibleAttachments).toHaveLength(1)
  })

  test('still shows the attachment to a workspace admin', async () => {
    const { adminToken, hiddenAttachmentId, hiddenIssueId, slug } = await seedAttachmentVisibilityFixture()
    /*
     * The filter must be scoped to grant-less members; an admin losing access would be
     * this fix overshooting into a denial of service.
     */
    const list = await fetchNativeApi(`http://localhost/api/files?entityType=issue&entityId=${hiddenIssueId}`, {
      headers: authHeaders(adminToken, slug),
    })
    const attachments = await readNativeJson(list, ApiResults.apiListAttachments)
    expect(attachments).toHaveLength(1)

    const meta = await fetchNativeApi(`http://localhost/api/files/${hiddenAttachmentId}/metadata`, {
      headers: authHeaders(adminToken, slug),
    })
    expect(meta.status).toBe(200)
  })

  test('still lists an attachment whose entity_id resolves to nothing', async () => {
    const visibilityFixture = await seedAttachmentVisibilityFixture()
    /* The entity_id column is not a foreign key, so free-floating attachments are legal and have no
     * project to authorise against. Requiring a *visible* owner rather than the absence
     * of an invisible one would make these vanish from their own uploader's view. */
    const orphanId = crypto.randomUUID()
    await seedAttachment(visibilityFixture, { entityId: orphanId, entityType: 'issue', filename: 'orphan.txt' })

    const res = await fetchNativeApi(`http://localhost/api/files?entityType=issue&entityId=${orphanId}`, {
      headers: asMember(visibilityFixture),
    })
    const attachments = await readNativeJson(res, ApiResults.apiListAttachments)
    expect(attachments.map((attachment) => attachment.filename)).toStrictEqual(['orphan.txt'])
  })

  test('rejects uploading onto an issue in an invisible project without orphaning the R2 object', async () => {
    const { hiddenIssueId, hiddenR2Key, memberToken, slug, workspaceId } = await seedAttachmentVisibilityFixture()
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM attachments WHERE workspace_id = ?')
      .bind(workspaceId)
      .first<{ n: number }>()

    const form = new FormData()
    form.append('file', new File(['planted'], 'planted.txt', { type: 'text/plain' }))
    form.append('entityType', 'issue')
    form.append('entityId', hiddenIssueId)
    const res = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: { Authorization: `Bearer ${memberToken}`, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    /*
     * 404, not 403: an invisible project 404s so its existence never leaks (see
     * requireProjectAccess).
     */
    expect(res.status).toBe(404)

    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM attachments WHERE workspace_id = ?')
      .bind(workspaceId)
      .first<{ n: number }>()
    expect(after?.n).toBe(before?.n)

    /*
     * The route puts bytes in R2 before recordUpload can reject, so it must clean up or
     * every rejected upload leaves a billable orphan.
     */
    const keys = await env.R2.list({ prefix: `${workspaceId}/` })
    expect(keys.objects.map((object) => object.key)).toStrictEqual([hiddenR2Key])
  })

  test('rejects a link attachment onto an issue in an invisible project', async () => {
    const visibilityFixture = await seedAttachmentVisibilityFixture()
    const { hiddenIssueId } = visibilityFixture
    const res = await fetchNativeApi(
      'http://localhost/api/files/links',
      requestOptionsWithBody(
        'POST',
        asMember(visibilityFixture),
        stringifyOrderedFields([
          ['kind', 'url'],
          ['entityType', 'issue'],
          ['entityId', hiddenIssueId],
          ['url', 'https://example.com'],
        ]),
      ),
    )
    expect(res.status).toBe(404)
  })

  test("rejects an upload onto a project where the member's grant is viewer-only", async () => {
    const { grantedProjectId, memberId, slug, workspaceId } = await seedAttachmentVisibilityFixture()
    const viewerUser = await seedUser(`viewer-${crypto.randomUUID().slice(0, 8)}@example.com`)
    await seedMember(workspaceId, viewerUser.id, 'member')
    await seedGroupGrant(workspaceId, viewerUser.id, grantedProjectId, 'viewer')
    const viewerToken = await seedToken(workspaceId, viewerUser.id)
    const issue = await seedIssue(workspaceId, grantedProjectId, memberId, { title: 'Open issue' })

    const form = new FormData()
    form.append('file', new File(['nope'], 'nope.txt', { type: 'text/plain' }))
    form.append('entityType', 'issue')
    form.append('entityId', issue.id)
    const res = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: { Authorization: `Bearer ${viewerToken}`, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    /*
     * 403, not 404: the project is visible to them, the write is what's refused. Their
     * workspace role is `member`, so the flat requireAttachmentWrite guard passes and only
     * the per-project grant can reject this.
     */
    expect(res.status).toBe(403)
  })

  test('still allows an upload onto an issue in a project the member can write', async () => {
    const { grantedProjectId, memberId, memberToken, slug, workspaceId } = await seedAttachmentVisibilityFixture()
    const issue = await seedIssue(workspaceId, grantedProjectId, memberId, { title: 'Open issue' })
    const form = new FormData()
    form.append('file', new File(['fine'], 'fine.txt', { type: 'text/plain' }))
    form.append('entityType', 'issue')
    form.append('entityId', issue.id)
    const res = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: { Authorization: `Bearer ${memberToken}`, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    expect(res.status).toBe(201)
  })

  test('hides the attachment from the MCP surface too', async () => {
    const visibilityFixture = await seedAttachmentVisibilityFixture()
    const { hiddenAttachmentId, workspaceId } = visibilityFixture
    const res = await mcpCall(
      workspaceId,
      'tools/call',
      fieldsInOrder([
        ['name', 'get_attachment'],
        ['arguments', { id: hiddenAttachmentId }],
      ]),
      asMember(visibilityFixture),
    )
    expect('error' in (res as object)).toBe(false)
    expect(toolError(res)?.code).toBe('not_found')
  })
})
