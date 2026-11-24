import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test'

/*
 * PROJ-894: stateless agent identity. register_agent records the credential that made the
 * call; claim_issue / heartbeat_agent / end_agent may then omit the agent id when that
 * credential owns exactly one (live) session, and must pass it otherwise.
 */
import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import { hashToken, seedIssue, seedProjectFixture, seedToken } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'

interface RpcBody {
  result?: { content?: { text: string }[]; isError?: boolean }
  error?: { code: number; message: string; data?: unknown }
}

describe('covers PROJ-894: stateless agent identity', () => {
  let token: string
  let workspaceId: string
  let projectId: string
  let userId: string

  // These tests make more calls per token than vite.config.ts's RATE_LIMIT_API_MAX.
  const prevApiMax = env.RATE_LIMIT_API_MAX
  beforeAll(() => {
    env.RATE_LIMIT_API_MAX = '1000'
  })
  afterAll(() => {
    env.RATE_LIMIT_API_MAX = prevApiMax
  })

  beforeEach(async () => {
    ;({ token, workspaceId, projectId, userId } = await seedProjectFixture())
  })

  const call = async function call(
    bearer: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; value: Record<string, unknown>; message: string }> {
    const res = await fetchNativeApi(
      `http://localhost/mcp/${workspaceId}`,
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { arguments: args, name },
        }),
      ),
    )
    const body = (await res.json()) as RpcBody
    /*
     * A failure is either a JSON-RPC error or (PROJ-893) an isError tool result;
     * this suite is about identity resolution, not the error envelope.
     */
    if (body.error) {
      return { ok: false, value: {}, message: body.error.message ?? JSON.stringify(body) }
    }
    const text = body.result?.content?.[0]?.text ?? ''
    if (body.result?.isError === true) {
      return { ok: false, value: {}, message: text }
    }
    return { ok: true, value: JSON.parse(text) as Record<string, unknown>, message: '' }
  }

  const credentialIdOf = async function credentialIdOf(bearer: string): Promise<string> {
    const row = await env.DB.prepare('SELECT id FROM api_tokens WHERE token_hash = ?')
      .bind(await hashToken(bearer))
      .first<{ id: string }>()
    if (!row) {
      throw new Error('token row missing')
    }
    return row.id
  }

  const register = async function register(bearer = token, name = 'agent'): Promise<string> {
    const r = await call(bearer, 'register_agent', { name })
    expect(r.ok).toBe(true)
    return r.value.id as string
  }

  test('register_agent records the credential and auth method on the session', async () => {
    const id = await register()
    const row = await env.DB.prepare('SELECT auth_method, credential_id, token_id FROM agent_sessions WHERE id = ?')
      .bind(id)
      .first<{ auth_method: string; credential_id: string; token_id: string }>()
    const credentialId = await credentialIdOf(token)
    // seedToken mints a `tok_` token, which the auth middleware classifies as a PAT.
    expect(row).toStrictEqual({
      auth_method: 'pat',
      credential_id: credentialId,
      token_id: credentialId,
    })
  })

  test('one live session: claim_issue, heartbeat_agent and end_agent work without an agent id', async () => {
    const sessionId = await register()
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Claim me' })

    const claim = await call(token, 'claim_issue', { issueId: issue.id })
    expect(claim.ok).toBe(true)
    expect(claim.value.agentSessionId).toBe(sessionId)

    const beat = await call(token, 'heartbeat_agent', {})
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(sessionId)

    const end = await call(token, 'end_agent', {})
    expect(end.ok).toBe(true)
    expect(end.value.status).toBe('ended')
  })

  test('two sessions on a shared token: an omitted id is rejected with a hint, an explicit id works', async () => {
    const a = await register(token, 'agent-a')
    await register(token, 'agent-b')
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Contended' })

    for (const [tool, args] of [
      ['claim_issue', { issueId: issue.id }],
      ['heartbeat_agent', {}],
      ['end_agent', {}],
    ] as const) {
      const r = await call(token, tool, { ...args })
      expect(r.ok, tool).toBe(false)
      expect(r.message, tool).toContain('pass agentId from register_agent')
    }

    const claim = await call(token, 'claim_issue', { issueId: issue.id, agentId: a })
    expect(claim.ok).toBe(true)
    expect(claim.value.agentSessionId).toBe(a)
  })

  test('no session on the credential: an omitted id is rejected, even if another credential has one', async () => {
    await register(token, 'owner-of-a-session')
    const other = await seedToken(workspaceId, userId)
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Not yours' })

    const r = await call(other, 'claim_issue', { issueId: issue.id })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('pass agentId from register_agent')

    // A different credential's session is never picked up by mistake.
    const beat = await call(other, 'heartbeat_agent', {})
    expect(beat.ok).toBe(false)
  })

  test('an ended session no longer counts, so a fresh register_agent becomes the single session again', async () => {
    const first = await register(token, 'first')
    const result = await call(token, 'end_agent', {})
    expect(result.ok).toBe(true)
    const second = await register(token, 'second')

    const beat = await call(token, 'heartbeat_agent', {})
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(second)
    expect(second).not.toBe(first)
  })

  test('a stale session can be revived by an id-less heartbeat, but cannot claim until then', async () => {
    const sessionId = await register()
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Stale claim' })
    await env.DB.prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?')
      .bind(currentEpochSeconds() - 600, sessionId)
      .run()

    const claim = await call(token, 'claim_issue', { issueId: issue.id })
    expect(claim.ok).toBe(false)

    const beat = await call(token, 'heartbeat_agent', {})
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(sessionId)

    const resolvedValue = await call(token, 'claim_issue', { issueId: issue.id })
    expect(resolvedValue.ok).toBe(true)
  })

  test('an explicit id still works exactly as before', async () => {
    const sessionId = await register()
    const beat = await call(token, 'heartbeat_agent', { id: sessionId })
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(sessionId)
  })

  test('heartbeat_agent and end_agent accept agentId as an alias for id', async () => {
    const sessionId = await register()
    const beat = await call(token, 'heartbeat_agent', { agentId: sessionId })
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(sessionId)
    const result = await call(token, 'end_agent', { agentId: sessionId })
    expect(result.ok).toBe(true)
  })

  test("an abandoned stale session does not make a lone live agent's id-less heartbeat ambiguous", async () => {
    const abandoned = await register(token, 'crashed')
    await env.DB.prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?')
      .bind(currentEpochSeconds() - 3600, abandoned)
      .run()
    const live = await register(token, 'restarted')

    const beat = await call(token, 'heartbeat_agent', {})
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(live)
  })
})
