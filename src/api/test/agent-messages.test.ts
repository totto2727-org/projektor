import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  hashToken,
  seedAgentLease,
  seedFixture,
  seedIssue,
  seedIssueFixture,
  seedProject,
  seedToken,
  toolError,
} from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { resetRateLimits } from './rate-limit-reset.ts'
import {
  MessageBodiesResponse,
  IdResponse,
  parseNativeMcpText,
  RpcTextResponse,
  readNativeJson,
} from './response-json.ts'

type AgentMessagesFixture = Awaited<ReturnType<typeof seedIssueFixture>> &
  Readonly<{
    listMessages: (params?: Record<string, string>, bearerToken?: string, workspaceSlug?: string) => Promise<Response>
    mcpCall: (
      method: string,
      args: Record<string, unknown>,
      bearerToken?: string,
      workspaceSlug?: string,
      wsId?: string,
    ) => Promise<Response>
    ownSession: (id: string) => Promise<void>
    postMessage: (body: Record<string, unknown>, bearerToken?: string, workspaceSlug?: string) => Promise<Response>
  }>

const seedAgentMessagesFixture = async function seedAgentMessagesFixture(): Promise<AgentMessagesFixture> {
  const fixture = await seedIssueFixture()
  const { slug, token, workspaceId } = fixture

  const postMessage = async function postMessage(
    body: Record<string, unknown>,
    bearerToken = token,
    workspaceSlug = slug,
  ): Promise<Response> {
    return fetchNativeApi('http://localhost/api/agent-messages', {
      body: JSON.stringify(body),
      headers: authHeaders(bearerToken, workspaceSlug),
      method: 'POST',
    })
  }

  const listMessages = async function listMessages(
    params: Record<string, string> = {},
    bearerToken = token,
    workspaceSlug = slug,
  ): Promise<Response> {
    const qs = new URLSearchParams(params).toString()
    return fetchNativeApi(`http://localhost/api/agent-messages${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(bearerToken, workspaceSlug),
    })
  }

  const mcpCall = async function mcpCall(
    method: string,
    args: Record<string, unknown>,
    bearerToken = token,
    workspaceSlug = slug,
    wsId: string = workspaceId,
  ): Promise<Response> {
    return fetchNativeApi(
      `http://localhost/mcp/${wsId}`,
      requestOptionsWithBody(
        'POST',
        {
          Authorization: `Bearer ${bearerToken}`,
          'X-Workspace-Slug': workspaceSlug,
          'Content-Type': 'application/json',
        },
        JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { arguments: args, name: method },
        }),
      ),
    )
  }

  const ownSession = async function ownSession(id: string): Promise<void> {
    await env.DB.prepare(`UPDATE agent_sessions SET credential_id =
      (SELECT id FROM api_tokens WHERE token_hash = ?) WHERE id = ?`)
      .bind(await hashToken(token), id)
      .run()
  }

  return { ...fixture, listMessages, mcpCall, ownSession, postMessage }
}

describe('agent Messages API', () => {
  /*
   * C1: post_message to issue scope; list_messages returns it; cursor pagination stable
   * token: POST×3 (3/5); token2: GET all (1/5) + GET page2 (2/5); token3: GET page1 (1/5); token4: MCP (1/5)
   */
  test('c1: post_message({scope:issue}) and list_messages with cursor pagination (no dupes/gaps)', async () => {
    const { issueId, listMessages, mcpCall, postMessage, slug, userId, workspaceId } = await seedAgentMessagesFixture()
    const scope = `issue:${issueId}`

    // Post 3 messages so we can page with limit=2
    const r1 = await postMessage({ scope, body: 'message one' })
    expect(r1.status).toBe(201)
    const r2 = await postMessage({ scope, body: 'message two' })
    expect(r2.status).toBe(201)
    const res3 = await postMessage({ scope, body: 'message three' })
    expect(res3.status).toBe(201)
    const msg3 = await readNativeJson(
      res3,
      Schema.Struct({ body: Schema.String, id: Schema.String, scope: Schema.String }),
    )
    expect(msg3.scope).toBe(scope)
    expect(msg3.body).toBe('message three')

    // token2 for list operations — verify all 3 are visible, then grab page 2
    const token2 = await seedToken(workspaceId, userId)

    // Confirm all 3 messages land in the scope before testing pagination
    const allRes = await listMessages({ scope }, token2, slug)
    expect(allRes.status).toBe(200)
    const allShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ body: Schema.String })).pipe(Schema.mutable),
      nextCursor: Schema.Union([Schema.String, Schema.Null]),
    })
    const all = await readNativeJson(allRes, allShape)
    expect(all.items).toHaveLength(3)

    // token3 for page 1 (fresh budget)
    const token3 = await seedToken(workspaceId, userId)

    // Page 1: limit=2 — composite cursor is "createdAt:id" for same-second stability
    const page1Res = await listMessages({ scope, limit: '2' }, token3, slug)
    expect(page1Res.status).toBe(200)
    const page1Shape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ body: Schema.String })).pipe(Schema.mutable),
      nextCursor: Schema.Union([Schema.String, Schema.Null]),
    })
    const page1 = await readNativeJson(page1Res, page1Shape)
    expect(page1.items).toHaveLength(2)
    expect(page1.items[0].body).toBe('message one')
    expect(page1.items[1].body).toBe('message two')
    expect(page1.nextCursor).not.toBeNull()

    // Page 2: cursor from page 1 (uses token2's remaining budget)
    const page2Res = await listMessages({ scope, limit: '2', cursor: page1.nextCursor! }, token2, slug)
    expect(page2Res.status).toBe(200)
    const page2Shape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ body: Schema.String })).pipe(Schema.mutable),
      nextCursor: Schema.Union([Schema.String, Schema.Null]),
    })
    const page2 = await readNativeJson(page2Res, page2Shape)
    expect(page2.items).toHaveLength(1)
    expect(page2.items[0].body).toBe('message three')
    expect(page2.nextCursor).toBeNull()

    // Verify via MCP
    const token4 = await seedToken(workspaceId, userId)
    const mcpRes = await mcpCall('list_messages', { scope }, token4, slug)
    expect(mcpRes.status).toBe(200)
    const mcpBody = await readNativeJson(mcpRes, RpcTextResponse)
    const mcpData = parseNativeMcpText(mcpBody.result.content[0].text, MessageBodiesResponse)
    expect(mcpData.items).toHaveLength(3)

    /*
     * PROJ-920: MCP paging round-trip — page 1's nextCursor (a "createdAt:id" string)
     * must be accepted back by the argument validator.
     */
    const token5 = await seedToken(workspaceId, userId)
    const p1Res = await mcpCall('list_messages', { scope, limit: 2 }, token5, slug)
    const p1Body = await readNativeJson(p1Res, RpcTextResponse)
    const p1 = parseNativeMcpText(
      p1Body.result.content[0].text,
      Schema.Struct({ nextCursor: Schema.Union([Schema.String, Schema.Null]) }),
    )
    expect(typeof p1.nextCursor).toBe('string')
    const p2Res = await mcpCall('list_messages', { scope, limit: 2, cursor: p1.nextCursor }, token5, slug)
    const p2BodyShape = Schema.Struct({
      error: Schema.optional(Schema.Struct({ message: Schema.String })),
      result: Schema.optional(
        Schema.Struct({ content: Schema.Array(Schema.Struct({ text: Schema.String })).pipe(Schema.mutable) }),
      ),
    })
    const p2Body = await readNativeJson(p2Res, p2BodyShape)
    expect(p2Body.error).toBeUndefined()
    const p2 = parseNativeMcpText(p2Body.result?.content[0].text ?? '{}', MessageBodiesResponse)
    expect(p2.items.map((item) => item.body)).toStrictEqual(['message three'])
  })

  // C2: workspace scope; messages visible via workspace scope; not returned under issue scope
  // 3 requests (post, list workspace scope, list issue scope) — within RATE_LIMIT_API_MAX=5
  test('c2: workspace-scoped post_message visible under workspace scope; not under issue scope', async () => {
    const { issueId, listMessages, postMessage, slug, userId, workspaceId } = await seedAgentMessagesFixture()
    const wsScope = 'workspace'
    const issueScope = `issue:${issueId}`

    const res = await postMessage({ scope: wsScope, body: 'workspace-wide notice' })
    expect(res.status).toBe(201)
    const msg = await readNativeJson(res, Schema.Struct({ body: Schema.String, scope: Schema.String }))
    expect(msg.scope).toBe(wsScope)

    const token2 = await seedToken(workspaceId, userId)

    // Should appear in workspace channel
    const wsListRes = await listMessages({ scope: wsScope }, token2, slug)
    expect(wsListRes.status).toBe(200)
    const wsBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ body: Schema.String, scope: Schema.String })).pipe(Schema.mutable),
    })
    const wsBody = await readNativeJson(wsListRes, wsBodyShape)
    expect(wsBody.items.some((item) => item.body === 'workspace-wide notice')).toBe(true)

    // Should NOT appear in issue channel
    const issueListRes = await listMessages({ scope: issueScope }, token2, slug)
    expect(issueListRes.status).toBe(200)
    const issueBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ body: Schema.String })).pipe(Schema.mutable),
    })
    const issueBody = await readNativeJson(issueListRes, issueBodyShape)
    expect(issueBody.items.some((item) => item.body === 'workspace-wide notice')).toBe(false)
  })

  // C3: CAPSTONE — spans agents + file-claims + agent-messages
  // Uses multiple tokens to stay within rate limit (5 per token)
  // PROJ-248: many sequential MCP round-trips; full-suite contention pushes this past the 5s default
  test('c3: capstone — two agents coordinate via messages; force-claim posts override notice', async () => {
    const { mcpCall, projectId, slug, token, userId, workspaceId } = await seedAgentMessagesFixture()
    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Agent Issue' })
    const scope = `issue:${issue2.id}`

    // Phase 1 (token): register agents, claim, conflict, post message
    const agent1Res = await mcpCall('register_agent', { name: 'agent-one' })
    expect(agent1Res.status).toBe(200)
    const a1Body = await readNativeJson(agent1Res, RpcTextResponse)
    const agent1 = parseNativeMcpText(a1Body.result.content[0].text, IdResponse)

    const agent2Res = await mcpCall('register_agent', { name: 'agent-two' })
    expect(agent2Res.status).toBe(200)
    const a2Body = await readNativeJson(agent2Res, RpcTextResponse)
    const agent2 = parseNativeMcpText(a2Body.result.content[0].text, IdResponse)

    // agent1 claims path A
    const claimRes = await mcpCall('claim_files', {
      issueId: issue2.id,
      agentId: agent1.id,
      paths: ['src/coord.ts'],
    })
    expect(claimRes.status).toBe(200)
    const claimBody = await readNativeJson(claimRes, RpcTextResponse)
    expect(JSON.parse(claimBody.result.content[0].text)).toMatchObject({
      created: [{ path: 'src/coord.ts' }],
    })

    // agent2 tries to claim path A without force — expect conflict
    const conflictRes = await mcpCall('claim_files', {
      issueId: issue2.id,
      agentId: agent2.id,
      paths: ['src/coord.ts'],
      force: false,
    })
    expect(conflictRes.status).toBe(200)
    const conflictBody = await readNativeJson(conflictRes, Schema.Struct({ error: Schema.optional(Schema.Unknown) }))
    expect(conflictBody.error).toBeUndefined()
    expect(toolError(conflictBody)?.code).toBe('conflict')

    // agent2 posts a message to the issue channel
    const postMsgRes = await mcpCall('post_message', {
      scope,
      agentId: agent2.id,
      body: 'agent2 needs src/coord.ts — can you release?',
    })
    expect(postMsgRes.status).toBe(200)

    // A fleet session belongs to its credential, not every token owned by this user.
    // Reset the fixture budget between phases without impersonating the fleet from a new token.
    await resetRateLimits()
    const token2 = token

    const readRes = await mcpCall('list_messages', { scope }, token2, slug)
    expect(readRes.status).toBe(200)
    const readBody = await readNativeJson(readRes, RpcTextResponse)
    const readData = parseNativeMcpText(readBody.result.content[0].text, MessageBodiesResponse)
    expect(readData.items.some((item) => item.body.includes('can you release?'))).toBe(true)

    // agent1 releases path A
    const releaseRes = await mcpCall('release_files', { paths: ['src/coord.ts'], issueId: issue2.id }, token2, slug)
    expect(releaseRes.status).toBe(200)

    // agent2 re-claims path A successfully
    const reclaimRes = await mcpCall(
      'claim_files',
      {
        issueId: issue2.id,
        agentId: agent2.id,
        paths: ['src/coord.ts'],
      },
      token2,
      slug,
    )
    expect(reclaimRes.status).toBe(200)
    const reclaimBody = await readNativeJson(reclaimRes, RpcTextResponse)
    const reclaimData = parseNativeMcpText(
      reclaimBody.result.content[0].text,
      Schema.Struct({ created: Schema.Array(Schema.Struct({ issueId: Schema.String })).pipe(Schema.mutable) }),
    )
    expect(reclaimData.created[0].issueId).toBe(issue2.id)

    // agent1 claims path B so agent2 can force-steal it
    const claimBRes = await mcpCall(
      'claim_files',
      {
        issueId: issue2.id,
        agentId: agent1.id,
        paths: ['src/forced.ts'],
      },
      token2,
      slug,
    )
    expect(claimBRes.status).toBe(200)

    // Phase 3 (token3): agent2 force-claims path B; assert override notice in list_messages
    await resetRateLimits()
    const token3 = token
    const issue3 = await seedIssue(workspaceId, projectId, userId, { title: 'Force Issue' })

    const forceRes = await mcpCall(
      'claim_files',
      {
        issueId: issue3.id,
        agentId: agent2.id,
        paths: ['src/forced.ts'],
        force: true,
      },
      token3,
      slug,
    )
    expect(forceRes.status).toBe(200)
    const forceBody = await readNativeJson(forceRes, RpcTextResponse)
    const forceData = parseNativeMcpText(
      forceBody.result.content[0].text,
      Schema.Struct({ overridden: Schema.Array(Schema.Unknown).pipe(Schema.mutable) }),
    )
    expect(forceData.overridden).toHaveLength(1)

    // The force-override notice should appear in the issue3 scope channel (Epic B wiring)
    const noticeScope = `issue:${issue3.id}`
    const noticeRes = await mcpCall('list_messages', { scope: noticeScope }, token3, slug)
    expect(noticeRes.status).toBe(200)
    const noticeBody = await readNativeJson(noticeRes, RpcTextResponse)
    const noticeData = parseNativeMcpText(noticeBody.result.content[0].text, MessageBodiesResponse)
    expect(
      noticeData.items.some((item) => item.body.includes('force-claimed') && item.body.includes('src/forced.ts')),
    ).toBe(true)
  }, 15_000)

  // C4: workspace isolation; issue-scope isolation; cursor stability
  // 4 requests (post, list from other ws, post other-issue, list-ws scope) within limit
  test('c4: workspace isolation and issue-scope isolation', async () => {
    const { issueId, listMessages, postMessage, slug, userId, workspaceId } = await seedAgentMessagesFixture()
    const scope = `issue:${issueId}`

    // Post a message in workspace X
    await postMessage({ scope, body: 'workspace-X message' })

    // Workspace Y should not see workspace X's messages
    const other = await seedFixture({ role: 'owner' })
    const otherProject = await seedProject(other.workspace.id)
    const otherIssue = await seedIssue(other.workspace.id, otherProject.id, other.user.id, {
      title: 'Other',
    })
    const otherScope = `issue:${otherIssue.id}`

    // Post in workspace Y's issue scope
    const token2 = await seedToken(workspaceId, userId)
    const otherPostRes = await fetchNativeApi(
      'http://localhost/api/agent-messages',
      requestOptionsWithBody(
        'POST',
        authHeaders(other.token, other.workspace.slug),
        JSON.stringify({ scope: otherScope, body: 'workspace-Y message' }),
      ),
    )
    expect(otherPostRes.status).toBe(201)

    // Workspace X cannot see workspace Y messages
    const xListRes = await listMessages({ scope }, token2, slug)
    expect(xListRes.status).toBe(200)
    const xBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ body: Schema.String })).pipe(Schema.mutable),
    })
    const xBody = await readNativeJson(xListRes, xBodyShape)
    expect(xBody.items.some((item) => item.body === 'workspace-Y message')).toBe(false)
    expect(xBody.items.some((item) => item.body === 'workspace-X message')).toBe(true)

    // Issue-scope isolation: workspace-channel messages don't bleed into issue scope
    const wsScope = 'workspace'
    await postMessage({ scope: wsScope, body: 'ws-channel msg' }, token2, slug)

    const token3 = await seedToken(workspaceId, userId)
    const isoRes = await listMessages({ scope }, token3, slug)
    expect(isoRes.status).toBe(200)
    const isoBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ body: Schema.String })).pipe(Schema.mutable),
    })
    const isoBody = await readNativeJson(isoRes, isoBodyShape)
    expect(isoBody.items.some((item) => item.body === 'ws-channel msg')).toBe(false)
  })

  // --- Heartbeat refresh on a live agentId (PROJ-929) ---

  const heartbeatOf = async function heartbeatOf(id: string): Promise<number> {
    const row = await env.DB.prepare('SELECT last_heartbeat_at FROM agent_sessions WHERE id = ?')
      .bind(id)
      .first<{ last_heartbeat_at: number }>()
    return row!.last_heartbeat_at
  }

  test("post_message refreshes a live agentId's heartbeat, but never revives a stale one", async () => {
    const { issueId, ownSession, postMessage, workspaceId } = await seedAgentMessagesFixture()
    const { agentSessionId: live } = await seedAgentLease(workspaceId, issueId)
    await ownSession(live)
    const backdated = currentEpochSeconds() - 10
    await env.DB.prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?').bind(backdated, live).run()

    const res = await postMessage({ scope: `issue:${issueId}`, agentId: live, body: 'still here' })
    expect(res.status).toBe(201)
    await expect(heartbeatOf(live)).resolves.toBeGreaterThan(backdated)

    const { agentSessionId: dead } = await seedAgentLease(workspaceId, issueId, { live: false })
    await ownSession(dead)
    const deadBefore = await heartbeatOf(dead)

    const res2 = await postMessage({
      scope: `issue:${issueId}`,
      agentId: dead,
      body: 'ghost post',
    })
    expect(res2.status).toBe(201)
    await expect(heartbeatOf(dead)).resolves.toBe(deadBefore)
  })
})
