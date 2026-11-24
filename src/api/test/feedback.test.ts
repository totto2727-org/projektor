import { describe, expect, test } from 'vite-plus/test'

import { hashFeedbackToken } from '#commands/feedback.ts'

import { configureCore, env, getCoreLimiterCalls } from './fixture-api.ts'
import {
  authHeaders,
  seedGroupGrant,
  seedProject,
  seedProjectFixture,
  seedWorkspaceRoles,
  toolError,
} from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { seedRateLimitCounter } from './rate-limit-reset.ts'

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
    const f = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({ name: 'Onboarding survey', allowedOrigins: ['https://acme.test'] }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; token: string }
    expect(body.id).toBeTruthy()
    expect(body.token).toBeTruthy()
  })

  test('rejects source creation by a member (403)', async () => {
    const f = await seedProjectFixture({ role: 'member' })
    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({ name: 'X' }),
    })
    expect(res.status).toBe(403)
  })

  test('lists sources with a truncated token preview, never the raw token', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const created = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({ name: 'NPS' }),
    })
    const { token } = (await created.json()) as { token: string }

    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources`, {
      headers: authHeaders(f.token, f.slug),
    })
    expect(res.status).toBe(200)
    const list = (await res.json()) as {
      name: string
      tokenPreview: string
      isActive: boolean
    }[]
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('NPS')
    expect(list[0].isActive).toBe(true)
    expect(list[0].tokenPreview.length).toBeLessThan(token.length)
    expect(JSON.stringify(list)).not.toContain(token)
  })

  test('updates name/description/isActive (owner)', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const created = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({ name: 'Old' }),
    })
    const { id } = (await created.json()) as { id: string }

    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources/${id}`, {
      method: 'PATCH',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({ name: 'New', isActive: false }),
    })
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
    const create = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      body: JSON.stringify({ name: 'S' }),
    })
    const { id } = (await create.json()) as { id: string }

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

const mintSource = async function mintSource(
  f: Readonly<{ projectId: string; token: string; slug: string }>,
  body: Record<string, unknown> = { name: 'Widget' },
): Promise<string> {
  const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources`, {
    method: 'POST',
    headers: authHeaders(f.token, f.slug),
    body: JSON.stringify(body),
  })
  return ((await res.json()) as { token: string }).token
}

describe('feedback submit (public)', () => {
  test('fails open (201, not 500) when the rate limiter is unavailable (PROJ-867)', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(f)
    await configureCore({ FIXTURE_LIMITER_MODE: 'reject' })
    try {
      const res = await fetchNativeApi('http://localhost/api/feedback/submit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Still works' }),
      })
      const calls = await getCoreLimiterCalls()
      expect(calls).toBe(2)
      expect(res.status).toBe(201)
    } finally {
      await configureCore()
    }
  })

  test('accepts a body-only submission and returns { id } only', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(f)
    const res = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Love it' }),
    })
    expect(res.status).toBe(201)
    const data = (await res.json()) as Record<string, unknown>
    expect(Object.keys(data)).toEqual(['id'])

    const row = await env.DB.prepare('SELECT project_id, workspace_id, source_id, status FROM feedback WHERE id = ?')
      .bind(data.id)
      .first<{ project_id: string; workspace_id: string; source_id: string; status: string }>()
    expect(row?.project_id).toBe(f.projectId)
    expect(row?.status).toBe('new')
  })

  test('resolves project/workspace from the source, ignoring body-supplied ids', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(f)
    const res = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x', projectId: '00000000-0000-0000-0000-000000000000' }),
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    const row = await env.DB.prepare('SELECT project_id FROM feedback WHERE id = ?')
      .bind(id)
      .first<{ project_id: string }>()
    expect(row?.project_id).toBe(f.projectId)
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
    const f = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(f)
    const list = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources`, {
      headers: authHeaders(f.token, f.slug),
    })
    const [{ id }] = (await list.json()) as { id: string }[]
    await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources/${id}`, {
      headers: authHeaders(f.token, f.slug),
      method: 'DELETE',
    })
    const res = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  test('rejects an inactive source with 403', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(f)
    const list = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources`, {
      headers: authHeaders(f.token, f.slug),
    })
    const [{ id }] = (await list.json()) as { id: string }[]
    await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources/${id}`, {
      method: 'PATCH',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({ isActive: false }),
    })
    const res = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    })
    expect(res.status).toBe(403)
  })

  test('400s an empty submission (neither rating nor body)', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(f)
    const res = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  test('sets Access-Control-Allow-Origin only for a listed origin', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(f, { name: 'W', allowedOrigins: ['https://acme.test'] })

    const allowed = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Origin: 'https://acme.test',
      },
      body: JSON.stringify({ body: 'x' }),
    })
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://acme.test')

    const other = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Origin: 'https://evil.test',
      },
      body: JSON.stringify({ body: 'x' }),
    })
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
    const f = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(f)
    const tokenHash = await hashFeedbackToken(token)
    await seedRateLimitAtCap(`feedback:${tokenHash}`)

    const res = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    })
    expect(res.status).toBe(429)
  })

  test('429s once the per-IP limit (RATE_LIMIT_FEEDBACK_IP_MAX) is exceeded', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const token = await mintSource(f)
    // No CF-Connecting-IP header in tests, so the route falls back to the fixed
    // '127.0.0.1' key.
    await seedRateLimitAtCap('feedback-ip:127.0.0.1')

    const res = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    })
    expect(res.status).toBe(429)
  })
})

// RATE_LIMIT_FEEDBACK_MAX and _IP_MAX are both 5 in vite.config.ts — seed to the cap.
// (seedRateLimitCounter waits out the tail of a window first — PROJ-637.)
async function seedRateLimitAtCap(key: string): Promise<void> {
  await seedRateLimitCounter(key, 5)
}

const seedFeedbackRow = async function seedFeedbackRow(
  sourceId: string,
  workspaceId: string,
  projectId: string,
  opts: Readonly<{ body?: string; status?: string }> = {},
): Promise<string> {
  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
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
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f, { name: 'Onboarding' })
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(f.projectId)
      .first<{ id: string }>()
    await seedFeedbackRow(src!.id, f.workspaceId, f.projectId, { status: 'new', body: 'a' })
    await seedFeedbackRow(src!.id, f.workspaceId, f.projectId, { status: 'reviewed', body: 'b' })

    const all = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback`, {
      headers: authHeaders(f.token, f.slug),
    })
    const allRows = (await all.json()) as { sourceName: string; status: string }[]
    expect(allRows).toHaveLength(2)
    expect(allRows[0].sourceName).toBe('Onboarding')

    const filtered = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback?status=new`, {
      headers: authHeaders(f.token, f.slug),
    })
    const rows = (await filtered.json()) as { status: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('new')
  })

  test('handles GET 404s for a caller with no project access', async () => {
    const owner = await seedProjectFixture({ role: 'owner' })
    await mintSource(owner)
    const stranger = await seedProjectFixture({ role: 'owner' }) // different workspace
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
    const create = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      body: JSON.stringify({ name: 'S' }),
    })
    await create.json()
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(proj.id)
      .first<{ id: string }>()
    const fbId = await seedFeedbackRow(src!.id, roles.workspace.id, proj.id)

    const viewerRes = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback/${fbId}`, {
      method: 'PATCH',
      headers: authHeaders(roles.viewer.token, roles.workspace.slug),
      body: JSON.stringify({ status: 'reviewed' }),
    })
    expect(viewerRes.status).toBe(403)

    const memberRes = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback/${fbId}`, {
      method: 'PATCH',
      headers: authHeaders(roles.member.token, roles.workspace.slug),
      body: JSON.stringify({ status: 'reviewed' }),
    })
    expect(memberRes.status).toBe(200)
    const row = await env.DB.prepare('SELECT status FROM feedback WHERE id = ?').bind(fbId).first<{ status: string }>()
    expect(row?.status).toBe('reviewed')
  })

  test('handles GET is readable by a viewer (read visibility, not a write action)', async () => {
    const f = await seedProjectFixture({ role: 'viewer' })
    await mintSource(f)
    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback`, {
      headers: authHeaders(f.token, f.slug),
    })
    expect(res.status).toBe(200)
  })

  test('filters by sourceId', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f, { name: 'A' })
    await mintSource(f, { name: 'B' })
    const sources = await env.DB.prepare('SELECT id, name FROM feedback_sources WHERE project_id = ? ORDER BY name')
      .bind(f.projectId)
      .all<{ id: string; name: string }>()
    const [srcA, srcB] = sources.results!
    await seedFeedbackRow(srcA.id, f.workspaceId, f.projectId, { body: 'from a' })
    await seedFeedbackRow(srcB.id, f.workspaceId, f.projectId, { body: 'from b' })

    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback?sourceId=${srcA.id}`, {
      headers: authHeaders(f.token, f.slug),
    })
    const rows = (await res.json()) as { sourceId: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].sourceId).toBe(srcA.id)
  })

  test('handles PATCH rejects an invalid status value', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(f.projectId)
      .first<{ id: string }>()
    const fbId = await seedFeedbackRow(src!.id, f.workspaceId, f.projectId)

    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback/${fbId}`, {
      method: 'PATCH',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({ status: 'bogus' }),
    })
    expect(res.status).toBe(400)
  })
})

const mcpCall = async function mcpCall<T>(
  workspaceId: string,
  name: string,
  args: unknown,
  headers: Record<string, string>,
): Promise<JsonRpcResult<T> | JsonRpcError> {
  const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  return res.json()
}

const mcpText = function mcpText<T>(r: JsonRpcResult<{ content: { text: string }[] }>): T {
  return JSON.parse(r.result.content[0].text) as T
}

describe('feedback source MCP tools', () => {
  test('create_feedback_source returns a one-time token (owner)', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const res = (await mcpCall<{ content: { text: string }[] }>(
      f.workspaceId,
      'create_feedback_source',
      { projectId: f.projectId, name: 'Onboarding' },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const out = mcpText<{ id: string; token: string }>(res)
    expect(out.id).toBeTruthy()
    expect(out.token).toBeTruthy()
  })

  test('create_feedback_source is forbidden for a member (forbidden)', async () => {
    const f = await seedProjectFixture({ role: 'member' })
    const res = await mcpCall(
      f.workspaceId,
      'create_feedback_source',
      { projectId: f.projectId, name: 'X' },
      authHeaders(f.token, f.slug),
    )
    expect(toolError(res)?.code).toBe('forbidden')
  })

  test('list_feedback_sources never leaks a raw token', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const created = (await mcpCall<{ content: { text: string }[] }>(
      f.workspaceId,
      'create_feedback_source',
      { projectId: f.projectId, name: 'NPS' },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const { token } = mcpText<{ id: string; token: string }>(created)

    const listed = (await mcpCall<{ content: { text: string }[] }>(
      f.workspaceId,
      'list_feedback_sources',
      { projectId: f.projectId },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    expect(listed.result.content[0].text).not.toContain(token)
  })

  test('update_feedback_source updates fields via MCP (owner)', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const created = (await mcpCall<{ content: { text: string }[] }>(
      f.workspaceId,
      'create_feedback_source',
      { projectId: f.projectId, name: 'Old' },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const { id } = mcpText<{ id: string }>(created)

    const res = (await mcpCall(
      f.workspaceId,
      'update_feedback_source',
      { sourceId: id, name: 'New', isActive: false },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult
    expect(res.result).toBeDefined()

    const row = await env.DB.prepare('SELECT name, is_active FROM feedback_sources WHERE id = ?')
      .bind(id)
      .first<{ name: string; is_active: number }>()
    expect(row?.name).toBe('New')
    expect(row?.is_active).toBe(0)
  })

  test('revoke_feedback_source stamps revoked_at via MCP (owner)', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const created = (await mcpCall<{ content: { text: string }[] }>(
      f.workspaceId,
      'create_feedback_source',
      { projectId: f.projectId, name: 'S' },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const { id } = mcpText<{ id: string }>(created)

    const res = (await mcpCall(
      f.workspaceId,
      'revoke_feedback_source',
      { sourceId: id },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult
    expect(res.result).toBeDefined()

    const row = await env.DB.prepare('SELECT revoked_at FROM feedback_sources WHERE id = ?')
      .bind(id)
      .first<{ revoked_at: number | null }>()
    expect(row?.revoked_at).not.toBeNull()
  })

  test('rotate_feedback_source_token invalidates the old token, keeps id + history', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const created = (await mcpCall<{ content: { text: string }[] }>(
      f.workspaceId,
      'create_feedback_source',
      { projectId: f.projectId, name: 'R' },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const { id, token: oldToken } = mcpText<{ id: string; token: string }>(created)
    // Existing feedback under this source
    const fbId = await seedFeedbackRow(id, f.workspaceId, f.projectId, { body: 'keep me' })

    const rotated = (await mcpCall<{ content: { text: string }[] }>(
      f.workspaceId,
      'rotate_feedback_source_token',
      { sourceId: id },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const { token: newToken } = mcpText<{ token: string }>(rotated)
    expect(newToken).not.toBe(oldToken)

    // Old token now rejected
    const oldRes = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${oldToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    })
    expect(oldRes.status).toBe(401)
    // New token works
    const newRes = await fetchNativeApi('http://localhost/api/feedback/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${newToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'y' }),
    })
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
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(f.projectId)
      .first<{ id: string }>()
    const fbId = await seedFeedbackRow(src!.id, f.workspaceId, f.projectId, {
      body: 'The export button is broken',
    })

    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback/${fbId}/convert-to-issue`, {
      headers: authHeaders(f.token, f.slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const issue = (await res.json()) as { id: string }
    expect(issue.id).toBeTruthy()

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
    const create = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      body: JSON.stringify({ name: 'S' }),
    })
    await create.json()
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(proj.id)
      .first<{ id: string }>()
    const fbId = await seedFeedbackRow(src!.id, roles.workspace.id, proj.id)

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
    const create = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      body: JSON.stringify({ name: 'S' }),
    })
    await create.json()
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(proj.id)
      .first<{ id: string }>()
    const fbId = await seedFeedbackRow(src!.id, roles.workspace.id, proj.id, { body: 'Fix this' })

    const res = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback/${fbId}/convert-to-issue`, {
      headers: authHeaders(roles.member.token, roles.workspace.slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
  })

  test('falls back to a rating-based title when there is no body', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(f.projectId)
      .first<{ id: string }>()
    const id = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    await env.DB.prepare(
      `INSERT INTO feedback (id, source_id, workspace_id, project_id, rating, rating_scale, body, status, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, NULL, 'new', ?)`,
    )
      .bind(id, src!.id, f.workspaceId, f.projectId, 1, 'thumbs', now)
      .run()

    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback/${id}/convert-to-issue`, {
      headers: authHeaders(f.token, f.slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const issue = (await res.json()) as { id: string }
    const issueRow = await env.DB.prepare('SELECT title FROM issues WHERE id = ?')
      .bind(issue.id)
      .first<{ title: string }>()
    expect(issueRow?.title).toBe('👍 Positive feedback')
  })

  test('rejects re-conversion of an already-actioned feedback row (409)', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(f.projectId)
      .first<{ id: string }>()
    const fbId = await seedFeedbackRow(src!.id, f.workspaceId, f.projectId, { body: 'Repeat me' })

    const first = await fetchNativeApi(
      `http://localhost/api/projects/${f.projectId}/feedback/${fbId}/convert-to-issue`,
      {
        headers: authHeaders(f.token, f.slug),
        method: 'POST',
      },
    )
    expect(first.status).toBe(201)

    const second = await fetchNativeApi(
      `http://localhost/api/projects/${f.projectId}/feedback/${fbId}/convert-to-issue`,
      {
        headers: authHeaders(f.token, f.slug),
        method: 'POST',
      },
    )
    expect(second.status).toBe(409)
  })
})

describe('covers PROJ-390: path params win over body-supplied ids', () => {
  test('handles PATCH feedback status ignores a body-supplied projectId/feedbackId', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(f.projectId)
      .first<{ id: string }>()
    const fbId = await seedFeedbackRow(src!.id, f.workspaceId, f.projectId)

    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback/${fbId}`, {
      method: 'PATCH',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({
        status: 'reviewed',
        projectId: '00000000-0000-0000-0000-000000000000',
        feedbackId: '00000000-0000-0000-0000-000000000000',
      }),
    })
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT status FROM feedback WHERE id = ?').bind(fbId).first<{ status: string }>()
    expect(row?.status).toBe('reviewed')
  })

  test('handles POST feedback-sources ignores a body-supplied projectId', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({ name: 'X', projectId: '00000000-0000-0000-0000-000000000000' }),
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    const row = await env.DB.prepare('SELECT project_id FROM feedback_sources WHERE id = ?')
      .bind(id)
      .first<{ project_id: string }>()
    expect(row?.project_id).toBe(f.projectId)
  })

  test('handles PATCH feedback-sources ignores a body-supplied projectId/sourceId', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f)
    const source = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(f.projectId)
      .first<{ id: string }>()
    const id = source!.id

    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources/${id}`, {
      method: 'PATCH',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({
        name: 'Renamed',
        projectId: '00000000-0000-0000-0000-000000000000',
        sourceId: '00000000-0000-0000-0000-000000000000',
      }),
    })
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
    const created = await fetchNativeApi(`http://localhost/api/projects/${projA.id}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      body: JSON.stringify({ name: "A's source" }),
    })
    const { id: sourceId } = (await created.json()) as { id: string }
    return { roles, projA, projB, sourceId }
  }

  test("handles PATCH via project B's path 404s on project A's source", async () => {
    const { roles, projB, sourceId } = await seedTwoProjectsSameWorkspace()
    const res = await fetchNativeApi(`http://localhost/api/projects/${projB.id}/feedback-sources/${sourceId}`, {
      method: 'PATCH',
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      body: JSON.stringify({ name: 'Hijacked' }),
    })
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
    const created = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({ name: 'Doomed' }),
    })
    const { id } = (await created.json()) as { id: string }
    await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources/${id}`, {
      headers: authHeaders(f.token, f.slug),
      method: 'DELETE',
    })
    return id
  }

  test('handles PATCH on an already-revoked source 409s', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const id = await seedRevokedSource(f)
    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources/${id}`, {
      method: 'PATCH',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({ name: 'Resurrected' }),
    })
    expect(res.status).toBe(409)
  })

  test('rotate on an already-revoked source 409s', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const id = await seedRevokedSource(f)
    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources/${id}/rotate`, {
      headers: authHeaders(f.token, f.slug),
      method: 'POST',
    })
    expect(res.status).toBe(409)
  })

  test('revoke on an already-revoked source stays idempotent (200)', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    const id = await seedRevokedSource(f)
    const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources/${id}`, {
      headers: authHeaders(f.token, f.slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
  })
})

describe('feedback read/triage MCP tools', () => {
  test('list_feedback matches REST shape and supports status/sourceId filters', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f, { name: 'Onboarding' })
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(f.projectId)
      .first<{ id: string }>()
    await seedFeedbackRow(src!.id, f.workspaceId, f.projectId, { body: 'new one' })
    await seedFeedbackRow(src!.id, f.workspaceId, f.projectId, {
      body: 'reviewed one',
      status: 'reviewed',
    })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      f.workspaceId,
      'list_feedback',
      { projectId: f.projectId },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const all = mcpText<{ status: string; sourceId: string }[]>(res)
    expect(all).toHaveLength(2)

    const filtered = (await mcpCall<{ content: { text: string }[] }>(
      f.workspaceId,
      'list_feedback',
      { projectId: f.projectId, status: 'reviewed' },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const reviewed = mcpText<{ status: string }[]>(filtered)
    expect(reviewed).toHaveLength(1)
    expect(reviewed[0].status).toBe('reviewed')

    const bySource = (await mcpCall<{ content: { text: string }[] }>(
      f.workspaceId,
      'list_feedback',
      { projectId: f.projectId, sourceId: src!.id },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    expect(mcpText<unknown[]>(bySource)).toHaveLength(2)
  })

  test('list_feedback is readable by a viewer', async () => {
    const roles = await seedWorkspaceRoles()
    const proj = await seedProject(roles.workspace.id, 'LFV')
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, proj.id, 'viewer')
    const create = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      body: JSON.stringify({ name: 'S' }),
    })
    const { id: sourceId } = (await create.json()) as { id: string }
    await seedFeedbackRow(sourceId, roles.workspace.id, proj.id)

    const res = (await mcpCall(
      roles.workspace.id,
      'list_feedback',
      { projectId: proj.id },
      authHeaders(roles.viewer.token, roles.workspace.slug),
    )) as JsonRpcResult
    expect(res.result).toBeDefined()
  })

  test('update_feedback_status updates the row without a projectId argument (member+)', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(f.projectId)
      .first<{ id: string }>()
    const fbId = await seedFeedbackRow(src!.id, f.workspaceId, f.projectId)

    const res = (await mcpCall(
      f.workspaceId,
      'update_feedback_status',
      { feedbackId: fbId, status: 'reviewed' },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult
    expect(res.result).toBeDefined()

    const row = await env.DB.prepare('SELECT status FROM feedback WHERE id = ?').bind(fbId).first<{ status: string }>()
    expect(row?.status).toBe('reviewed')
  })

  test('update_feedback_status is forbidden for a viewer (forbidden)', async () => {
    const roles = await seedWorkspaceRoles()
    const proj = await seedProject(roles.workspace.id, 'UFV')
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, proj.id, 'viewer')
    const create = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      body: JSON.stringify({ name: 'S' }),
    })
    const { id: sourceId } = (await create.json()) as { id: string }
    const fbId = await seedFeedbackRow(sourceId, roles.workspace.id, proj.id)

    const res = await mcpCall(
      roles.workspace.id,
      'update_feedback_status',
      { feedbackId: fbId, status: 'reviewed' },
      authHeaders(roles.viewer.token, roles.workspace.slug),
    )
    expect(toolError(res)?.code).toBe('forbidden')
  })

  test('convert_feedback_to_issue creates and links an issue without a projectId argument (member+)', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(f.projectId)
      .first<{ id: string }>()
    const fbId = await seedFeedbackRow(src!.id, f.workspaceId, f.projectId, {
      body: 'The export button is broken',
    })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      f.workspaceId,
      'convert_feedback_to_issue',
      { feedbackId: fbId },
      authHeaders(f.token, f.slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const issue = mcpText<{ id: string }>(res)
    expect(issue.id).toBeTruthy()

    const row = await env.DB.prepare('SELECT status, linked_issue_id FROM feedback WHERE id = ?')
      .bind(fbId)
      .first<{ status: string; linked_issue_id: string | null }>()
    expect(row?.status).toBe('actioned')
    expect(row?.linked_issue_id).toBe(issue.id)
  })

  test('convert_feedback_to_issue rejects re-conversion (conflict)', async () => {
    const f = await seedProjectFixture({ role: 'owner' })
    await mintSource(f)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(f.projectId)
      .first<{ id: string }>()
    const fbId = await seedFeedbackRow(src!.id, f.workspaceId, f.projectId, { body: 'Repeat me' })

    await mcpCall(f.workspaceId, 'convert_feedback_to_issue', { feedbackId: fbId }, authHeaders(f.token, f.slug))
    const second = await mcpCall(
      f.workspaceId,
      'convert_feedback_to_issue',
      { feedbackId: fbId },
      authHeaders(f.token, f.slug),
    )
    expect(toolError(second)?.code).toBe('conflict')
  })

  test('convert_feedback_to_issue is forbidden for a viewer (forbidden)', async () => {
    const roles = await seedWorkspaceRoles()
    const proj = await seedProject(roles.workspace.id, 'CFV')
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, proj.id, 'viewer')
    const create = await fetchNativeApi(`http://localhost/api/projects/${proj.id}/feedback-sources`, {
      method: 'POST',
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      body: JSON.stringify({ name: 'S' }),
    })
    const { id: sourceId } = (await create.json()) as { id: string }
    const fbId = await seedFeedbackRow(sourceId, roles.workspace.id, proj.id, { body: 'x' })

    const res = await mcpCall(
      roles.workspace.id,
      'convert_feedback_to_issue',
      { feedbackId: fbId },
      authHeaders(roles.viewer.token, roles.workspace.slug),
    )
    expect(toolError(res)?.code).toBe('forbidden')
  })
})
