import { Schema } from 'effect'
import { assert, describe, expect, test } from 'vite-plus/test'

import { hashFeedbackToken } from '#commands/feedback.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { currentEpochSeconds } from '#contracts/time.ts'

import { configureCore, env, getCoreLimiterCalls } from './fixture-api.ts'
import {
  authHeaders,
  seedGroupGrant,
  seedProject,
  seedProjectFixture,
  seedWorkspaceRoles,
  toolError,
} from './helpers.ts'
import { stringifyOrderedFields, fetchNativeApi, fetchNativeMcpTool, requestOptionsWithBody } from './native-fetch.ts'
import type { McpToolRequest } from './native-fetch.ts'
import { seedRateLimitCounter } from './rate-limit-reset.ts'
import {
  ErrorMessageResponse,
  IdListResponse,
  IdResponse,
  JsonListResponse,
  RpcTextResponse,
  TokenResponse,
  parseNativeMcpText,
  readNativeJson,
  readNativeMcpResultText,
} from './response-json.ts'

describe('feedback migration', () => {
  test('creates feedback_sources and feedback tables', async () => {
    const src = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='feedback_sources'",
    ).first<{ name: string }>()
    expect(src?.name).toBe('feedback_sources')

    const fb = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='feedback'").first<{
      name: string
    }>()
    expect(fb?.name).toBe('feedback')
  })
})

describe('feedback sources REST', () => {
  test('creates a source (owner) and returns a one-time token', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback-sources`,
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        stringifyOrderedFields([
          ['name', 'Onboarding survey'],
          ['allowedOrigins', ['https://acme.test']],
        ]),
      ),
    )
    expect(res.status).toBe(201)
    const body = await readNativeJson(res, Schema.Struct({ id: Schema.String, token: Schema.String }))
    expect(isNonEmptyText(body.id)).toBe(true)
    expect(isNonEmptyText(body.token)).toBe(true)
  })

  test('rejects source creation by a member (403)', async () => {
    const testFixture = await seedProjectFixture({ role: 'member' })
    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback-sources`,
      requestOptionsWithBody('POST', authHeaders(testFixture.token, testFixture.slug), JSON.stringify({ name: 'X' })),
    )
    expect(res.status).toBe(403)
  })

  test('lists sources with a truncated token preview, never the raw token', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const created = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback-sources`,
      requestOptionsWithBody('POST', authHeaders(testFixture.token, testFixture.slug), JSON.stringify({ name: 'NPS' })),
    )
    const { token } = await readNativeJson(created, TokenResponse)

    const res = await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback-sources`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    expect(res.status).toBe(200)
    const list = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ isActive: Schema.Boolean, name: Schema.String, tokenPreview: Schema.String })).pipe(
        Schema.mutable,
      ),
    )
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ isActive: true, name: 'NPS' })
    expect(list[0].tokenPreview.length).toBeLessThan(token.length)
    expect(JSON.stringify(list)).not.toContain(token)
  })

  test('updates name/description/isActive (owner)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const created = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback-sources`,
      requestOptionsWithBody('POST', authHeaders(testFixture.token, testFixture.slug), JSON.stringify({ name: 'Old' })),
    )
    const { id } = await readNativeJson(created, IdResponse)

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback-sources/${id}`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ isActive: false, name: 'New' }),
      ),
    )
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT name, is_active FROM feedback_sources WHERE id = ?')
      .bind(id)
      .first<{ name: string; is_active: number }>()
    expect(row?.name).toBe('New')
    expect(row?.is_active).toBe(0)
  })

  test('revoke stamps revoked_at (owner); member is 403', async () => {
    const roles = await seedWorkspaceRoles()
    const proj = await seedProject(roles.workspace.id, 'FBK')
    const create = await fetchNativeApi(
      `http://localhost/api/projects/${proj.id}/feedback-sources`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ name: 'S' }),
      ),
    )
    const { id } = await readNativeJson(create, IdResponse)

    const memberRes = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback-sources/${id}`, {
      headers: authHeaders(roles.member.token, roles.workspace.slug),
      method: 'DELETE',
    })
    expect(memberRes.status).toBe(403)

    const ownerRes = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback-sources/${id}`, {
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      method: 'DELETE',
    })
    expect(ownerRes.status).toBe(200)
    const row = await env.DB.prepare('SELECT revoked_at FROM feedback_sources WHERE id = ?')
      .bind(id)
      .first<{ revoked_at: number | null }>()
    expect(row?.revoked_at).not.toBeNull()
  })
})

type FeedbackSourceFixture = Readonly<{ projectId: string; token: string; slug: string }>

const postSource = async function postSource(
  fixture: FeedbackSourceFixture,
  body: Record<string, unknown> = { name: 'Widget' },
): Promise<Response> {
  return fetchNativeApi(
    `http://localhost/api/projects/${fixture.projectId}/feedback-sources`,
    requestOptionsWithBody('POST', authHeaders(fixture.token, fixture.slug), JSON.stringify(body)),
  )
}

const mintSource = async function mintSource(
  fixture: FeedbackSourceFixture,
  body?: Record<string, unknown>,
): Promise<string> {
  const res = await postSource(fixture, body)
  const source = await readNativeJson(res, TokenResponse)
  return source.token
}

// RATE_LIMIT_FEEDBACK_MAX and _IP_MAX are both 5 in vite.config.ts — seed to the cap.
// (seedRateLimitCounter waits out the tail of a window first — PROJ-637.)
const seedRateLimitAtCap = async function seedRateLimitAtCap(key: string): Promise<void> {
  await seedRateLimitCounter(key, 5)
}

describe('feedback submit (public)', () => {
  test('fails open (201, not 500) when the rate limiter is unavailable (PROJ-867)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(testFixture)
    await configureCore({ FIXTURE_LIMITER_MODE: 'reject' })
    try {
      const res = await fetchNativeApi(
        'http://localhost/api/feedback/submit',
        requestOptionsWithBody(
          'POST',
          { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          JSON.stringify({ body: 'Still works' }),
        ),
      )
      const calls = await getCoreLimiterCalls()
      expect(calls).toBe(2)
      expect(res.status).toBe(201)
    } finally {
      await configureCore()
    }
  })

  test('accepts a body-only submission and returns { id } only', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(testFixture)
    const res = await fetchNativeApi(
      'http://localhost/api/feedback/submit',
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        JSON.stringify({ body: 'Love it' }),
      ),
    )
    expect(res.status).toBe(201)
    const data = await readNativeJson(res, Schema.Record(Schema.String, Schema.Unknown))
    expect(Object.keys(data)).toStrictEqual(['id'])

    const row = await env.DB.prepare('SELECT project_id, workspace_id, source_id, status FROM feedback WHERE id = ?')
      .bind(data.id)
      .first<{ project_id: string; workspace_id: string; source_id: string; status: string }>()
    expect(row?.project_id).toBe(testFixture.projectId)
    expect(row?.status).toBe('new')
  })

  test('resolves project/workspace from the source, ignoring body-supplied ids', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(testFixture)
    const res = await fetchNativeApi(
      'http://localhost/api/feedback/submit',
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        JSON.stringify({ body: 'x', projectId: '00000000-0000-0000-0000-000000000000' }),
      ),
    )
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)
    const row = await env.DB.prepare('SELECT project_id FROM feedback WHERE id = ?')
      .bind(id)
      .first<{ project_id: string }>()
    expect(row?.project_id).toBe(testFixture.projectId)
  })

  test('rejects an unknown token with 401', async () => {
    const res = await fetchNativeApi('http://localhost/api/feedback/submit', {
      body: JSON.stringify({ body: 'x' }),
      headers: { Authorization: 'Bearer nope', 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(res.status).toBe(401)
  })

  test('rejects a revoked source with 401', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(testFixture)
    const list = await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback-sources`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    const [{ id }] = await readNativeJson(list, IdListResponse)
    await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback-sources/${id}`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
      method: 'DELETE',
    })
    const res = await fetchNativeApi(
      'http://localhost/api/feedback/submit',
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        JSON.stringify({ body: 'x' }),
      ),
    )
    expect(res.status).toBe(401)
  })

  test('rejects an inactive source with 403', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(testFixture)
    const list = await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback-sources`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    const [{ id }] = await readNativeJson(list, IdListResponse)
    await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback-sources/${id}`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ isActive: false }),
      ),
    )
    const res = await fetchNativeApi(
      'http://localhost/api/feedback/submit',
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        JSON.stringify({ body: 'x' }),
      ),
    )
    expect(res.status).toBe(403)
  })

  test('400s an empty submission (neither rating nor body)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(testFixture)
    const res = await fetchNativeApi(
      'http://localhost/api/feedback/submit',
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        JSON.stringify({}),
      ),
    )
    expect(res.status).toBe(400)
  })

  test('sets Access-Control-Allow-Origin only for a listed origin', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(testFixture, { name: 'W', allowedOrigins: ['https://acme.test'] })

    const allowed = await fetchNativeApi(
      'http://localhost/api/feedback/submit',
      requestOptionsWithBody(
        'POST',
        {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Origin: 'https://acme.test',
        },
        JSON.stringify({ body: 'x' }),
      ),
    )
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://acme.test')

    const other = await fetchNativeApi(
      'http://localhost/api/feedback/submit',
      requestOptionsWithBody(
        'POST',
        {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Origin: 'https://evil.test',
        },
        JSON.stringify({ body: 'x' }),
      ),
    )
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  test('answers OPTIONS preflight with 204 and permissive CORS headers', async () => {
    const res = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'OPTIONS',
      headers: { Origin: 'https://acme.test', 'Access-Control-Request-Method': 'POST' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://acme.test')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })

  test('429s once the per-token limit (RATE_LIMIT_FEEDBACK_MAX) is exceeded', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(testFixture)
    const tokenHash = await hashFeedbackToken(token)
    await seedRateLimitAtCap(`feedback:${tokenHash}`)

    const res = await fetchNativeApi(
      'http://localhost/api/feedback/submit',
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        JSON.stringify({ body: 'x' }),
      ),
    )
    expect(res.status).toBe(429)
  })

  test('429s once the per-IP limit (RATE_LIMIT_FEEDBACK_IP_MAX) is exceeded', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(testFixture)
    // No CF-Connecting-IP header in tests, so the route falls back to the fixed
    // '127.0.0.1' key.
    await seedRateLimitAtCap('feedback-ip:127.0.0.1')

    const res = await fetchNativeApi(
      'http://localhost/api/feedback/submit',
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        JSON.stringify({ body: 'x' }),
      ),
    )
    expect(res.status).toBe(429)
  })
})

const seedFeedbackRow = async function seedFeedbackRow(
  sourceId: string,
  workspaceId: string,
  projectId: string,
  opts: Readonly<{ body?: string; status?: string }> = {},
): Promise<string> {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await env.DB.prepare(
    `INSERT INTO feedback (id, source_id, workspace_id, project_id, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, sourceId, workspaceId, projectId, opts.body ?? 'seed', opts.status ?? 'new', now)
    .run()
  return id
}

describe('feedback triage read/patch', () => {
  test('handles GET lists feedback with the source name, filtered by status', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture, { name: 'Onboarding' })
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    assert.exists(src)
    await seedFeedbackRow(src.id, testFixture.workspaceId, testFixture.projectId, { body: 'a', status: 'new' })
    await seedFeedbackRow(src.id, testFixture.workspaceId, testFixture.projectId, { body: 'b', status: 'reviewed' })

    const all = await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    const allRows = await readNativeJson(
      all,
      Schema.Array(Schema.Struct({ sourceName: Schema.String, status: Schema.String })).pipe(Schema.mutable),
    )
    expect(allRows).toHaveLength(2)
    expect(allRows[0].sourceName).toBe('Onboarding')

    const filtered = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback?status=new`,
      {
        headers: authHeaders(testFixture.token, testFixture.slug),
      },
    )
    const rows = await readNativeJson(
      filtered,
      Schema.Array(Schema.Struct({ status: Schema.String })).pipe(Schema.mutable),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('new')
  })

  test('handles GET 404s for a caller with no project access', async () => {
    const owner = await seedProjectFixture({ role: 'owner' })
    await mintSource(owner)
    // Different workspace
    const stranger = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi(`http://localhost/api/projects/${owner.projectId}/feedback`, {
      headers: authHeaders(stranger.token, stranger.slug),
    })
    expect(res.status).toBe(404)
  })

  test('handles PATCH updates status for member+, 403 for viewer', async () => {
    const roles = await seedWorkspaceRoles()
    const proj = await seedProject(roles.workspace.id, 'TRI')
    await seedGroupGrant(roles.workspace.id, roles.member.user.id, proj.id, 'member')
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, proj.id, 'viewer')
    const create = await fetchNativeApi(
      `http://localhost/api/projects/${proj.id}/feedback-sources`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ name: 'S' }),
      ),
    )
    await create.json()
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(proj.id)
      .first<{ id: string }>()
    assert.exists(src)
    const fbId = await seedFeedbackRow(src.id, roles.workspace.id, proj.id)

    const viewerRes = await fetchNativeApi(
      `http://localhost/api/projects/${proj.id}/feedback/${fbId}`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(roles.viewer.token, roles.workspace.slug),
        JSON.stringify({ status: 'reviewed' }),
      ),
    )
    expect(viewerRes.status).toBe(403)

    const memberRes = await fetchNativeApi(
      `http://localhost/api/projects/${proj.id}/feedback/${fbId}`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(roles.member.token, roles.workspace.slug),
        JSON.stringify({ status: 'reviewed' }),
      ),
    )
    expect(memberRes.status).toBe(200)
    const row = await env.DB.prepare('SELECT status FROM feedback WHERE id = ?').bind(fbId).first<{ status: string }>()
    expect(row?.status).toBe('reviewed')
  })

  test('handles GET is readable by a viewer (read visibility, not a write action)', async () => {
    const testFixture = await seedProjectFixture({ role: 'viewer' })
    const rejected = await postSource(testFixture)
    expect(rejected.status).toBe(403)
    await readNativeJson(rejected, ErrorMessageResponse)
    const res = await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    expect(res.status).toBe(200)
  })

  test('filters by sourceId', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture, { name: 'A' })
    await mintSource(testFixture, { name: 'B' })
    const sources = await env.DB.prepare('SELECT id, name FROM feedback_sources WHERE project_id = ? ORDER BY name')
      .bind(testFixture.projectId)
      .all<{ id: string; name: string }>()
    const [srcA, srcB] = sources.results
    await seedFeedbackRow(srcA.id, testFixture.workspaceId, testFixture.projectId, { body: 'from a' })
    await seedFeedbackRow(srcB.id, testFixture.workspaceId, testFixture.projectId, { body: 'from b' })

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback?sourceId=${srcA.id}`,
      {
        headers: authHeaders(testFixture.token, testFixture.slug),
      },
    )
    const rows = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ sourceId: Schema.String })).pipe(Schema.mutable),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].sourceId).toBe(srcA.id)
  })

  test('handles PATCH rejects an invalid status value', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    assert.exists(src)
    const fbId = await seedFeedbackRow(src.id, testFixture.workspaceId, testFixture.projectId)

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/${fbId}`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ status: 'bogus' }),
      ),
    )
    expect(res.status).toBe(400)
  })
})

const callMcpTool = async function callMcpTool(
  workspaceId: string,
  params: McpToolRequest,
  headers: Record<string, string>,
): Promise<typeof RpcTextResponse.Type> {
  const response = await fetchNativeMcpTool(workspaceId, params, headers)
  return readNativeJson(response, RpcTextResponse)
}

const mcpCall = async function mcpCall(
  workspaceId: string,
  params: McpToolRequest,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await fetchNativeMcpTool(workspaceId, params, headers)
  return response.json()
}

const FeedbackSourceTokenResponse = Schema.Struct({ id: Schema.String, token: Schema.String })
const FeedbackListResponse = Schema.Array(Schema.Struct({ sourceId: Schema.String, status: Schema.String }))

const mcpText = function mcpText<Output extends Schema.Constraint>(
  response: typeof RpcTextResponse.Type,
  schema: Output,
): Output['Type'] {
  const text = readNativeMcpResultText(response.result)
  return parseNativeMcpText(text, schema)
}

describe('feedback source MCP tools', () => {
  test('create_feedback_source returns a one-time token (owner)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const res = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { projectId: testFixture.projectId, name: 'Onboarding' }, name: 'create_feedback_source' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    const out = mcpText(res, FeedbackSourceTokenResponse)
    expect(isNonEmptyText(out.id)).toBe(true)
    expect(isNonEmptyText(out.token)).toBe(true)
  })

  test('create_feedback_source is forbidden for a member (forbidden)', async () => {
    const testFixture = await seedProjectFixture({ role: 'member' })
    const res = await mcpCall(
      testFixture.workspaceId,
      { arguments: { projectId: testFixture.projectId, name: 'X' }, name: 'create_feedback_source' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    expect(toolError(res)?.code).toBe('forbidden')
  })

  test('list_feedback_sources never leaks a raw token', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const created = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { projectId: testFixture.projectId, name: 'NPS' }, name: 'create_feedback_source' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    const { token } = mcpText(created, FeedbackSourceTokenResponse)

    const listed = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { projectId: testFixture.projectId }, name: 'list_feedback_sources' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    expect(listed.result.content[0].text).not.toContain(token)
  })

  test('update_feedback_source updates fields via MCP (owner)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const created = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { projectId: testFixture.projectId, name: 'Old' }, name: 'create_feedback_source' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    const { id } = mcpText(created, IdResponse)

    const res = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { isActive: false, name: 'New', sourceId: id }, name: 'update_feedback_source' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    expect(res.result).toBeDefined()

    const row = await env.DB.prepare('SELECT name, is_active FROM feedback_sources WHERE id = ?')
      .bind(id)
      .first<{ name: string; is_active: number }>()
    expect(row?.name).toBe('New')
    expect(row?.is_active).toBe(0)
  })

  test('revoke_feedback_source stamps revoked_at via MCP (owner)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const created = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { projectId: testFixture.projectId, name: 'S' }, name: 'create_feedback_source' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    const { id } = mcpText(created, IdResponse)

    const res = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { sourceId: id }, name: 'revoke_feedback_source' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    expect(res.result).toBeDefined()

    const row = await env.DB.prepare('SELECT revoked_at FROM feedback_sources WHERE id = ?')
      .bind(id)
      .first<{ revoked_at: number | null }>()
    expect(row?.revoked_at).not.toBeNull()
  })

  test('rotate_feedback_source_token invalidates the old token, keeps id + history', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const created = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { projectId: testFixture.projectId, name: 'R' }, name: 'create_feedback_source' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    const { id, token: oldToken } = mcpText(created, FeedbackSourceTokenResponse)
    // Existing feedback under this source
    const fbId = await seedFeedbackRow(id, testFixture.workspaceId, testFixture.projectId, { body: 'keep me' })

    const rotated = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { sourceId: id }, name: 'rotate_feedback_source_token' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    const { token: newToken } = mcpText(rotated, TokenResponse)
    expect(newToken).not.toBe(oldToken)

    // Old token now rejected
    const oldRes = await fetchNativeApi(
      'http://localhost/api/feedback/submit',
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${oldToken}`, 'Content-Type': 'application/json' },
        JSON.stringify({ body: 'x' }),
      ),
    )
    expect(oldRes.status).toBe(401)
    // New token works
    const newRes = await fetchNativeApi(
      'http://localhost/api/feedback/submit',
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${newToken}`, 'Content-Type': 'application/json' },
        JSON.stringify({ body: 'y' }),
      ),
    )
    expect(newRes.status).toBe(201)
    // Id + history intact
    const stillThere = await env.DB.prepare('SELECT id FROM feedback WHERE id = ? AND source_id = ?')
      .bind(fbId, id)
      .first<{ id: string }>()
    expect(stillThere?.id).toBe(fbId)
  })
})

describe('feedback convert-to-issue', () => {
  test('creates an issue, links it, marks feedback actioned (member+)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    assert.exists(src)
    const fbId = await seedFeedbackRow(src.id, testFixture.workspaceId, testFixture.projectId, {
      body: 'The export button is broken',
    })

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/${fbId}/convert-to-issue`,
      {
        headers: authHeaders(testFixture.token, testFixture.slug),
        method: 'POST',
      },
    )
    expect(res.status).toBe(201)
    const issue = await readNativeJson(res, IdResponse)
    expect(isNonEmptyText(issue.id)).toBe(true)

    const row = await env.DB.prepare('SELECT status, linked_issue_id FROM feedback WHERE id = ?')
      .bind(fbId)
      .first<{ status: string; linked_issue_id: string | null }>()
    expect(row?.status).toBe('actioned')
    expect(row?.linked_issue_id).toBe(issue.id)
  })

  test('403s for a viewer', async () => {
    const roles = await seedWorkspaceRoles()
    const proj = await seedProject(roles.workspace.id, 'CVT')
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, proj.id, 'viewer')
    const create = await fetchNativeApi(
      `http://localhost/api/projects/${proj.id}/feedback-sources`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ name: 'S' }),
      ),
    )
    await create.json()
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(proj.id)
      .first<{ id: string }>()
    assert.exists(src)
    const fbId = await seedFeedbackRow(src.id, roles.workspace.id, proj.id)

    const res = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback/${fbId}/convert-to-issue`, {
      headers: authHeaders(roles.viewer.token, roles.workspace.slug),
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })

  test('allows a member (write role, not just owner) to convert', async () => {
    const roles = await seedWorkspaceRoles()
    const proj = await seedProject(roles.workspace.id, 'CVM')
    await seedGroupGrant(roles.workspace.id, roles.member.user.id, proj.id, 'member')
    const create = await fetchNativeApi(
      `http://localhost/api/projects/${proj.id}/feedback-sources`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ name: 'S' }),
      ),
    )
    await create.json()
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(proj.id)
      .first<{ id: string }>()
    assert.exists(src)
    const fbId = await seedFeedbackRow(src.id, roles.workspace.id, proj.id, { body: 'Fix this' })

    const res = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback/${fbId}/convert-to-issue`, {
      headers: authHeaders(roles.member.token, roles.workspace.slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
  })

  test('falls back to a rating-based title when there is no body', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    const id = crypto.randomUUID()
    const now = currentEpochSeconds()
    assert.exists(src)
    await env.DB.prepare(
      `INSERT INTO feedback (id, source_id, workspace_id, project_id, rating, rating_scale, body, status, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, NULL, 'new', ?)`,
    )
      .bind(id, src.id, testFixture.workspaceId, testFixture.projectId, 1, 'thumbs', now)
      .run()

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/${id}/convert-to-issue`,
      {
        headers: authHeaders(testFixture.token, testFixture.slug),
        method: 'POST',
      },
    )
    expect(res.status).toBe(201)
    const issue = await readNativeJson(res, IdResponse)
    const issueRow = await env.DB.prepare('SELECT title FROM issues WHERE id = ?')
      .bind(issue.id)
      .first<{ title: string }>()
    expect(issueRow?.title).toBe('👍 Positive feedback')
  })

  test('rejects re-conversion of an already-actioned feedback row (409)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    assert.exists(src)
    const fbId = await seedFeedbackRow(src.id, testFixture.workspaceId, testFixture.projectId, { body: 'Repeat me' })

    const first = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/${fbId}/convert-to-issue`,
      {
        headers: authHeaders(testFixture.token, testFixture.slug),
        method: 'POST',
      },
    )
    expect(first.status).toBe(201)

    const second = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/${fbId}/convert-to-issue`,
      {
        headers: authHeaders(testFixture.token, testFixture.slug),
        method: 'POST',
      },
    )
    expect(second.status).toBe(409)
  })
})

describe('covers PROJ-390: path params win over body-supplied ids', () => {
  test('handles PATCH feedback status ignores a body-supplied projectId/feedbackId', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    assert.exists(src)
    const fbId = await seedFeedbackRow(src.id, testFixture.workspaceId, testFixture.projectId)

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/${fbId}`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({
          feedbackId: '00000000-0000-0000-0000-000000000000',
          projectId: '00000000-0000-0000-0000-000000000000',
          status: 'reviewed',
        }),
      ),
    )
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT status FROM feedback WHERE id = ?').bind(fbId).first<{ status: string }>()
    expect(row?.status).toBe('reviewed')
  })

  test('handles POST feedback-sources ignores a body-supplied projectId', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback-sources`,
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ name: 'X', projectId: '00000000-0000-0000-0000-000000000000' }),
      ),
    )
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)
    const row = await env.DB.prepare('SELECT project_id FROM feedback_sources WHERE id = ?')
      .bind(id)
      .first<{ project_id: string }>()
    expect(row?.project_id).toBe(testFixture.projectId)
  })

  test('handles PATCH feedback-sources ignores a body-supplied projectId/sourceId', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const source = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    assert.exists(source)
    const { id } = source

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback-sources/${id}`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({
          name: 'Renamed',
          projectId: '00000000-0000-0000-0000-000000000000',
          sourceId: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    )
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT name FROM feedback_sources WHERE id = ?')
      .bind(id)
      .first<{ name: string }>()
    expect(row?.name).toBe('Renamed')
  })
})

describe('covers PROJ-390: cross-project feedback source mutation is rejected', () => {
  const seedTwoProjectsSameWorkspace = async function seedTwoProjectsSameWorkspace() {
    const roles = await seedWorkspaceRoles()
    const projA = await seedProject(roles.workspace.id, 'PA')
    const projB = await seedProject(roles.workspace.id, 'PB')
    const created = await fetchNativeApi(
      `http://localhost/api/projects/${projA.id}/feedback-sources`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ name: "A's source" }),
      ),
    )
    const { id: sourceId } = await readNativeJson(created, IdResponse)
    return { roles, projA, projB, sourceId }
  }

  test("handles PATCH via project B's path 404s on project A's source", async () => {
    const { roles, projB, sourceId } = await seedTwoProjectsSameWorkspace()
    const res = await fetchNativeApi(
      `http://localhost/api/projects/${projB.id}/feedback-sources/${sourceId}`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ name: 'Hijacked' }),
      ),
    )
    expect(res.status).toBe(404)
  })

  test("rotate via project B's path 404s on project A's source", async () => {
    const { roles, projB, sourceId } = await seedTwoProjectsSameWorkspace()
    const res = await fetchNativeApi(`http://localhost/api/projects/${projB.id}/feedback-sources/${sourceId}/rotate`, {
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  test("revoke via project B's path 404s on project A's source", async () => {
    const { roles, projB, sourceId } = await seedTwoProjectsSameWorkspace()
    const res = await fetchNativeApi(`http://localhost/api/projects/${projB.id}/feedback-sources/${sourceId}`, {
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })
})

describe('covers PROJ-390: mutating a revoked feedback source', () => {
  const seedRevokedSource = async function seedRevokedSource(
    f: Readonly<{ projectId: string; token: string; slug: string }>,
  ): Promise<string> {
    const created = await fetchNativeApi(
      `http://localhost/api/projects/${f.projectId}/feedback-sources`,
      requestOptionsWithBody('POST', authHeaders(f.token, f.slug), JSON.stringify({ name: 'Doomed' })),
    )
    const { id } = await readNativeJson(created, IdResponse)
    await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources/${id}`, {
      headers: authHeaders(f.token, f.slug),
      method: 'DELETE',
    })
    return id
  }

  test('handles PATCH on an already-revoked source 409s', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const id = await seedRevokedSource(testFixture)
    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback-sources/${id}`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ name: 'Resurrected' }),
      ),
    )
    expect(res.status).toBe(409)
  })

  test('rotate on an already-revoked source 409s', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const id = await seedRevokedSource(testFixture)
    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback-sources/${id}/rotate`,
      {
        headers: authHeaders(testFixture.token, testFixture.slug),
        method: 'POST',
      },
    )
    expect(res.status).toBe(409)
  })

  test('revoke on an already-revoked source stays idempotent (200)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const id = await seedRevokedSource(testFixture)
    const res = await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback-sources/${id}`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
  })
})

describe('feedback read/triage MCP tools', () => {
  test('list_feedback matches REST shape and supports status/sourceId filters', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture, { name: 'Onboarding' })
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    assert.exists(src)
    await seedFeedbackRow(src.id, testFixture.workspaceId, testFixture.projectId, { body: 'new one' })
    await seedFeedbackRow(src.id, testFixture.workspaceId, testFixture.projectId, {
      body: 'reviewed one',
      status: 'reviewed',
    })

    const res = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { projectId: testFixture.projectId }, name: 'list_feedback' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    const all = mcpText(res, FeedbackListResponse)
    expect(all).toHaveLength(2)

    const filtered = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { projectId: testFixture.projectId, status: 'reviewed' }, name: 'list_feedback' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    const reviewed = mcpText(filtered, FeedbackListResponse)
    expect(reviewed).toHaveLength(1)
    expect(reviewed[0].status).toBe('reviewed')

    const bySource = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { projectId: testFixture.projectId, sourceId: src.id }, name: 'list_feedback' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    expect(mcpText(bySource, JsonListResponse)).toHaveLength(2)
  })

  test('list_feedback is readable by a viewer', async () => {
    const roles = await seedWorkspaceRoles()
    const proj = await seedProject(roles.workspace.id, 'LFV')
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, proj.id, 'viewer')
    const create = await fetchNativeApi(
      `http://localhost/api/projects/${proj.id}/feedback-sources`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ name: 'S' }),
      ),
    )
    const { id: sourceId } = await readNativeJson(create, IdResponse)
    await seedFeedbackRow(sourceId, roles.workspace.id, proj.id)

    const res = await callMcpTool(
      roles.workspace.id,
      { arguments: { projectId: proj.id }, name: 'list_feedback' },
      authHeaders(roles.viewer.token, roles.workspace.slug),
    )
    expect(res.result).toBeDefined()
  })

  test('update_feedback_status updates the row without a projectId argument (member+)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    assert.exists(src)
    const fbId = await seedFeedbackRow(src.id, testFixture.workspaceId, testFixture.projectId)

    const res = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { feedbackId: fbId, status: 'reviewed' }, name: 'update_feedback_status' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    expect(res.result).toBeDefined()

    const row = await env.DB.prepare('SELECT status FROM feedback WHERE id = ?').bind(fbId).first<{ status: string }>()
    expect(row?.status).toBe('reviewed')
  })

  test('update_feedback_status is forbidden for a viewer (forbidden)', async () => {
    const roles = await seedWorkspaceRoles()
    const proj = await seedProject(roles.workspace.id, 'UFV')
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, proj.id, 'viewer')
    const create = await fetchNativeApi(
      `http://localhost/api/projects/${proj.id}/feedback-sources`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ name: 'S' }),
      ),
    )
    const { id: sourceId } = await readNativeJson(create, IdResponse)
    const fbId = await seedFeedbackRow(sourceId, roles.workspace.id, proj.id)

    const res = await mcpCall(
      roles.workspace.id,
      { arguments: { feedbackId: fbId, status: 'reviewed' }, name: 'update_feedback_status' },
      authHeaders(roles.viewer.token, roles.workspace.slug),
    )
    expect(toolError(res)?.code).toBe('forbidden')
  })

  test('convert_feedback_to_issue creates and links an issue without a projectId argument (member+)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    assert.exists(src)
    const fbId = await seedFeedbackRow(src.id, testFixture.workspaceId, testFixture.projectId, {
      body: 'The export button is broken',
    })

    const res = await callMcpTool(
      testFixture.workspaceId,
      { arguments: { feedbackId: fbId }, name: 'convert_feedback_to_issue' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    const issue = mcpText(res, IdResponse)
    expect(isNonEmptyText(issue.id)).toBe(true)

    const row = await env.DB.prepare('SELECT status, linked_issue_id FROM feedback WHERE id = ?')
      .bind(fbId)
      .first<{ status: string; linked_issue_id: string | null }>()
    expect(row?.status).toBe('actioned')
    expect(row?.linked_issue_id).toBe(issue.id)
  })

  test('convert_feedback_to_issue rejects re-conversion (conflict)', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    assert.exists(src)
    const fbId = await seedFeedbackRow(src.id, testFixture.workspaceId, testFixture.projectId, { body: 'Repeat me' })

    await mcpCall(
      testFixture.workspaceId,
      { arguments: { feedbackId: fbId }, name: 'convert_feedback_to_issue' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    const second = await mcpCall(
      testFixture.workspaceId,
      { arguments: { feedbackId: fbId }, name: 'convert_feedback_to_issue' },
      authHeaders(testFixture.token, testFixture.slug),
    )
    expect(toolError(second)?.code).toBe('conflict')
  })

  test('convert_feedback_to_issue is forbidden for a viewer (forbidden)', async () => {
    const roles = await seedWorkspaceRoles()
    const proj = await seedProject(roles.workspace.id, 'CFV')
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, proj.id, 'viewer')
    const create = await fetchNativeApi(
      `http://localhost/api/projects/${proj.id}/feedback-sources`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ name: 'S' }),
      ),
    )
    const { id: sourceId } = await readNativeJson(create, IdResponse)
    const fbId = await seedFeedbackRow(sourceId, roles.workspace.id, proj.id, { body: 'x' })

    const res = await mcpCall(
      roles.workspace.id,
      { arguments: { feedbackId: fbId }, name: 'convert_feedback_to_issue' },
      authHeaders(roles.viewer.token, roles.workspace.slug),
    )
    expect(toolError(res)?.code).toBe('forbidden')
  })
})
