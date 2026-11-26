import { Predicate } from 'effect'
import { afterAll, assert, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test'

/*
 * PROJ-894: stateless agent identity. register_agent records the credential that made the
 * call; claim_issue / heartbeat_agent / end_agent may then omit the agent id when that
 * credential owns exactly one (live) session, and must pass it otherwise.
 */
import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import { hashToken, seedIssue, seedProjectFixture, seedToken } from './helpers.ts'
import { fetchNativeMcpTool } from './native-fetch.ts'
import { JsonRecordResponse, McpRpcResponse, parseNativeMcpText, readNativeJson } from './response-json.ts'

interface AgentIdentityTestContext {
  projectFixture: Awaited<ReturnType<typeof seedProjectFixture>>
}

interface AgentToolReceiver {
  bearer: string
  workspaceId: string
}

const call = async function call(
  { bearer, workspaceId }: AgentToolReceiver,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; value: Record<string, unknown>; message: string }> {
  const res = await fetchNativeMcpTool(
    workspaceId,
    { arguments: args, name },
    { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
  )
  const body = await readNativeJson(res, McpRpcResponse)
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
  return { ok: true, value: parseNativeMcpText(text, JsonRecordResponse), message: '' }
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

const register = async function register(workspaceId: string, bearer: string, name = 'agent'): Promise<string> {
  const rpcResult = await call({ bearer, workspaceId }, 'register_agent', { name })
  expect(rpcResult.ok).toBe(true)
  const { id } = rpcResult.value
  assert(Predicate.isString(id))
  return id
}

describe('covers PROJ-894: stateless agent identity', () => {
  // These tests make more calls per token than vite.config.ts's RATE_LIMIT_API_MAX.
  const prevApiMax = env.RATE_LIMIT_API_MAX
  beforeAll(() => {
    env.RATE_LIMIT_API_MAX = '1000'
  })
  afterAll(() => {
    env.RATE_LIMIT_API_MAX = prevApiMax
  })

  beforeEach<AgentIdentityTestContext>(async (context) => {
    context.projectFixture = await seedProjectFixture()
  })

  test<AgentIdentityTestContext>('register_agent records the credential and auth method on the session', async ({
    projectFixture: { token, workspaceId },
  }) => {
    const id = await register(workspaceId, token)
    const row = await env.DB.prepare('SELECT auth_method, credential_id, token_id FROM agent_sessions WHERE id = ?')
      .bind(id)
      .first<{ auth_method: string; credential_id: string; token_id: string }>()
    const credentialId = await credentialIdOf(token)
    // The seedToken helper mints a `tok_` token, which the auth middleware classifies as a PAT.
    expect(row).toStrictEqual({
      auth_method: 'pat',
      credential_id: credentialId,
      token_id: credentialId,
    })
  })

  test<AgentIdentityTestContext>('one live session: claim_issue, heartbeat_agent and end_agent work without an agent id', async ({
    projectFixture: { projectId, token, userId, workspaceId },
  }) => {
    const sessionId = await register(workspaceId, token)
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Claim me' })

    const claim = await call({ bearer: token, workspaceId }, 'claim_issue', { issueId: issue.id })
    expect(claim.ok).toBe(true)
    expect(claim.value.agentSessionId).toBe(sessionId)

    const beat = await call({ bearer: token, workspaceId }, 'heartbeat_agent', {})
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(sessionId)

    const end = await call({ bearer: token, workspaceId }, 'end_agent', {})
    expect(end.ok).toBe(true)
    expect(end.value.status).toBe('ended')
  })

  test<AgentIdentityTestContext>('two sessions on a shared token: an omitted id is rejected with a hint, an explicit id works', async ({
    projectFixture: { projectId, token, userId, workspaceId },
  }) => {
    const firstAgent = await register(workspaceId, token, 'agent-a')
    await register(workspaceId, token, 'agent-b')
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Contended' })

    for (const [tool, args] of [
      ['claim_issue', { issueId: issue.id }],
      ['heartbeat_agent', {}],
      ['end_agent', {}],
    ] as const) {
      const rpcResult = await call({ bearer: token, workspaceId }, tool, { ...args })
      expect(rpcResult.ok, tool).toBe(false)
      expect(rpcResult.message, tool).toContain('pass agentId from register_agent')
    }

    const claim = await call({ bearer: token, workspaceId }, 'claim_issue', { issueId: issue.id, agentId: firstAgent })
    expect(claim.ok).toBe(true)
    expect(claim.value.agentSessionId).toBe(firstAgent)
  })

  test<AgentIdentityTestContext>('no session on the credential: an omitted id is rejected, even if another credential has one', async ({
    projectFixture: { projectId, token, userId, workspaceId },
  }) => {
    await register(workspaceId, token, 'owner-of-a-session')
    const other = await seedToken(workspaceId, userId)
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Not yours' })

    const rpcResult = await call({ bearer: other, workspaceId }, 'claim_issue', { issueId: issue.id })
    expect(rpcResult.ok).toBe(false)
    expect(rpcResult.message).toContain('pass agentId from register_agent')

    // A different credential's session is never picked up by mistake.
    const beat = await call({ bearer: other, workspaceId }, 'heartbeat_agent', {})
    expect(beat.ok).toBe(false)
  })

  test<AgentIdentityTestContext>('an ended session no longer counts, so a fresh register_agent becomes the single session again', async ({
    projectFixture: { token, workspaceId },
  }) => {
    const first = await register(workspaceId, token, 'first')
    const result = await call({ bearer: token, workspaceId }, 'end_agent', {})
    expect(result.ok).toBe(true)
    const second = await register(workspaceId, token, 'second')

    const beat = await call({ bearer: token, workspaceId }, 'heartbeat_agent', {})
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(second)
    expect(second).not.toBe(first)
  })

  test<AgentIdentityTestContext>('a stale session can be revived by an id-less heartbeat, but cannot claim until then', async ({
    projectFixture: { projectId, token, userId, workspaceId },
  }) => {
    const sessionId = await register(workspaceId, token)
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Stale claim' })
    await env.DB.prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?')
      .bind(currentEpochSeconds() - 600, sessionId)
      .run()

    const claim = await call({ bearer: token, workspaceId }, 'claim_issue', { issueId: issue.id })
    expect(claim.ok).toBe(false)

    const beat = await call({ bearer: token, workspaceId }, 'heartbeat_agent', {})
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(sessionId)

    const resolvedValue = await call({ bearer: token, workspaceId }, 'claim_issue', { issueId: issue.id })
    expect(resolvedValue.ok).toBe(true)
  })

  test<AgentIdentityTestContext>('an explicit id still works exactly as before', async ({
    projectFixture: { token, workspaceId },
  }) => {
    const sessionId = await register(workspaceId, token)
    const beat = await call({ bearer: token, workspaceId }, 'heartbeat_agent', { id: sessionId })
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(sessionId)
  })

  test<AgentIdentityTestContext>('heartbeat_agent and end_agent accept agentId as an alias for id', async ({
    projectFixture: { token, workspaceId },
  }) => {
    const sessionId = await register(workspaceId, token)
    const beat = await call({ bearer: token, workspaceId }, 'heartbeat_agent', { agentId: sessionId })
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(sessionId)
    const result = await call({ bearer: token, workspaceId }, 'end_agent', { agentId: sessionId })
    expect(result.ok).toBe(true)
  })

  test<AgentIdentityTestContext>("an abandoned stale session does not make a lone live agent's id-less heartbeat ambiguous", async ({
    projectFixture: { token, workspaceId },
  }) => {
    const abandoned = await register(workspaceId, token, 'crashed')
    await env.DB.prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?')
      .bind(currentEpochSeconds() - 3600, abandoned)
      .run()
    const live = await register(workspaceId, token, 'restarted')

    const beat = await call({ bearer: token, workspaceId }, 'heartbeat_agent', {})
    expect(beat.ok).toBe(true)
    expect(beat.value.id).toBe(live)
  })
})
