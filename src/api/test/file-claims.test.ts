import { Schema, Predicate } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { ApiResults } from '#contracts/api-results.ts'
import { currentEpochSeconds } from '#contracts/time.ts'

import { configureCore, env } from './fixture-api.ts'
import { authHeaders, hashToken, seedFixture, seedIssue, seedIssueFixture, seedProject, toolError } from './helpers.ts'
import { fetchNativeApi, fetchNativeMcpTool } from './native-fetch.ts'
import type { McpToolRequest } from './native-fetch.ts'
import {
  parseNativeMcpText,
  ErrorMessageResponse,
  IdResponse,
  ItemsResponse,
  MessageBodiesResponse,
  RpcTextResponse,
  readNativeJson,
} from './response-json.ts'

interface FileClaimTestContext {
  issueFixture: Awaited<ReturnType<typeof seedIssueFixture>>
}

type FileClaimRestAuth = Pick<FileClaimTestContext['issueFixture'], 'slug' | 'token'>
type FileClaimMcpAuth = Pick<FileClaimTestContext['issueFixture'], 'slug' | 'token' | 'workspaceId'>
type FileClaimSessionFixture = Pick<FileClaimTestContext['issueFixture'], 'token' | 'workspaceId'>

const claimFiles = async function claimFiles(
  body: Record<string, unknown>,
  { slug, token }: FileClaimRestAuth,
): Promise<Response> {
  return fetchNativeApi('http://localhost/api/file-claims', {
    body: JSON.stringify(body),
    headers: authHeaders(token, slug),
    method: 'POST',
  })
}

const releaseFiles = async function releaseFiles(
  body: Record<string, unknown>,
  { slug, token }: FileClaimRestAuth,
): Promise<Response> {
  return fetchNativeApi('http://localhost/api/file-claims/release', {
    body: JSON.stringify(body),
    headers: authHeaders(token, slug),
    method: 'POST',
  })
}

const listFileClaims = async function listFileClaims(
  params: Record<string, string>,
  { slug, token }: FileClaimRestAuth,
): Promise<Response> {
  const qs = new URLSearchParams(params).toString()
  return fetchNativeApi(`http://localhost/api/file-claims${qs ? `?${qs}` : ''}`, {
    headers: authHeaders(token, slug),
  })
}

// Workspace middleware resolves the slug from X-Workspace-Slug.
const mcpCall = async function mcpCall(
  params: McpToolRequest,
  { slug, token, workspaceId }: FileClaimMcpAuth,
): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Workspace-Slug': slug,
    'Content-Type': 'application/json',
  }
  return fetchNativeMcpTool(workspaceId, params, headers)
}

const listMessagesForScope = async function listMessagesForScope(
  scope: string,
  { slug, token }: FileClaimRestAuth,
): Promise<typeof MessageBodiesResponse.Type> {
  const res = await fetchNativeApi(`http://localhost/api/agent-messages?scope=${encodeURIComponent(scope)}`, {
    headers: authHeaders(token, slug),
  })
  expect(res.status).toBe(200)
  return readNativeJson(res, MessageBodiesResponse)
}

const seedSession = async function seedSession(
  { token, workspaceId }: FileClaimSessionFixture,
  opts: Readonly<{ status?: string; heartbeatAgeSecs?: number; name?: string }> = {},
): Promise<string> {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await env.DB.prepare(
    `INSERT INTO agent_sessions
	         (id, workspace_id, issue_id, token_id, name, kind, status, started_at,
	          last_heartbeat_at, ended_at)
	       VALUES (?, ?, NULL, NULL, ?, 'agent', ?, ?, ?, NULL)`,
  )
    .bind(
      id,
      workspaceId,
      opts.name ?? 'crashed-agent',
      opts.status ?? 'active',
      now,
      now - (opts.heartbeatAgeSecs ?? 0),
    )
    .run()
  await env.DB.prepare(`UPDATE agent_sessions SET credential_id =
        (SELECT id FROM api_tokens WHERE token_hash = ?) WHERE id = ?`)
    .bind(await hashToken(token), id)
    .run()
  return id
}

const claimRow = async function claimRow(
  workspaceId: string,
  path: string,
): Promise<{ released_at: number | null; release_reason: string | null } | null> {
  return env.DB.prepare('SELECT released_at, release_reason FROM issue_file_claims WHERE path = ? AND workspace_id = ?')
    .bind(path, workspaceId)
    .first<{ released_at: number | null; release_reason: string | null }>()
}

const backdateClaim = async function backdateClaim(
  workspaceId: string,
  path: string,
  secondsAgo: number,
): Promise<void> {
  const claimedAt = currentEpochSeconds() - secondsAgo
  await env.DB.prepare('UPDATE issue_file_claims SET claimed_at = ? WHERE path = ? AND workspace_id = ?')
    .bind(claimedAt, path, workspaceId)
    .run()
}

const patchStatus = async function patchStatus(
  { slug, token }: FileClaimRestAuth,
  id: string,
  status: string,
): Promise<Response> {
  return fetchNativeApi(`http://localhost/api/issues/${id}`, {
    body: JSON.stringify({ status }),
    headers: authHeaders(token, slug),
    method: 'PATCH',
  })
}

const seedStaleAgentSession = async function seedStaleAgentSession({
  token,
  workspaceId,
}: FileClaimSessionFixture): Promise<string> {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  // 200s > the 120s TTL
  await env.DB.prepare(
    `INSERT INTO agent_sessions
				   (id, workspace_id, issue_id, token_id, name, kind, status, started_at, last_heartbeat_at, ended_at)
				 VALUES (?, ?, NULL, NULL, ?, 'agent', 'active', ?, ?, NULL)`,
  )
    .bind(id, workspaceId, 'stale-session-932', now, now - 200)
    .run()
  await env.DB.prepare(`UPDATE agent_sessions SET credential_id =
        (SELECT id FROM api_tokens WHERE token_hash = ?) WHERE id = ?`)
    .bind(await hashToken(token), id)
    .run()
  return id
}

describe('file Claims API', () => {
  beforeEach<FileClaimTestContext>(async (context) => {
    context.issueFixture = await seedIssueFixture()
  })

  // B1: claim_files creates active claims; list_file_claims({issueId}) returns them
  // REST: 3 requests (claim, list, MCP list) — within RATE_LIMIT_API_MAX=5
  test<FileClaimTestContext>('b1: POST /api/file-claims creates active claims; GET list by issueId returns them', async ({
    issueFixture: { issueId, slug, token, workspaceId },
  }) => {
    const paths = ['src/foo.ts', 'src/bar.ts']
    const res = await claimFiles({ issueId, paths }, { slug, token })
    expect(res.status).toBe(201)
    const bodyShape = Schema.Struct({
      created: Schema.Array(Schema.Struct({ id: Schema.String, path: Schema.String, releasedAt: Schema.Null })).pipe(
        Schema.mutable,
      ),
      overridden: Schema.Array(Schema.Unknown).pipe(Schema.mutable),
    })
    const body = await readNativeJson(res, bodyShape)
    expect(body.created).toHaveLength(2)
    expect(body.overridden).toHaveLength(0)
    expect(body.created.every((c) => Predicate.isNullish(c.releasedAt))).toBe(true)
    const returnedPaths = body.created.map((c) => c.path)
    expect(returnedPaths).toContain('src/foo.ts')
    expect(returnedPaths).toContain('src/bar.ts')

    const listRes = await listFileClaims({ issueId }, { slug, token })
    expect(listRes.status).toBe(200)
    const listBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ path: Schema.String })).pipe(Schema.mutable),
    })
    const listBody = await readNativeJson(listRes, listBodyShape)
    expect(listBody.items.some((item) => item.path === 'src/foo.ts')).toBe(true)
    expect(listBody.items.some((item) => item.path === 'src/bar.ts')).toBe(true)

    // Verify via MCP — workspaceMiddleware requires X-Workspace-Slug
    const mcpRes = await mcpCall({ arguments: { issueId }, name: 'list_file_claims' }, { slug, token, workspaceId })
    expect(mcpRes.status).toBe(200)
    const mcpBody = await readNativeJson(mcpRes, RpcTextResponse)
    const mcpData = parseNativeMcpText(
      mcpBody.result.content[0].text,
      Schema.Struct({ items: Schema.Array(Schema.Struct({ path: Schema.String })).pipe(Schema.mutable) }),
    )
    expect(mcpData.items.some((item) => item.path === 'src/foo.ts')).toBe(true)
  })

  // B2: conflict on held path (force false) -> 409; batch does NOT partially claim
  // 4 requests (claim, conflict-claim, list other, MCP conflict) — within limit
  test<FileClaimTestContext>('b2: second claim on held path (force=false) returns 409 naming holder; batch stays atomic', async ({
    issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
  }) => {
    // Claim one path in issue A
    await claimFiles({ issueId, paths: ['src/held.ts'] }, { slug, token })

    // Second issue
    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Issue 2' })

    // Try to claim [held, new] — should fail entirely
    const res = await claimFiles({ issueId: issue2.id, paths: ['src/held.ts', 'src/other.ts'] }, { slug, token })
    expect(res.status).toBe(409)
    const body = await readNativeJson(res, ErrorMessageResponse)
    expect(body.error).toContain(issueId)

    // Assert "src/other.ts" was NOT claimed (batch all-or-nothing)
    const listRes = await listFileClaims({ path: 'src/other.ts' }, { slug, token })
    const listBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ path: Schema.String })).pipe(Schema.mutable),
    })
    const listBody = await readNativeJson(listRes, listBodyShape)
    expect(listBody.items).toHaveLength(0)

    // Verify via MCP — should also return a conflict tool error with holder info
    const mcpRes = await mcpCall(
      { arguments: { issueId: issue2.id, paths: ['src/held.ts'] }, name: 'claim_files' },
      { slug, token, workspaceId },
    )
    expect(mcpRes.status).toBe(200)
    const mcpBody = await readNativeJson(mcpRes, Schema.Struct({ error: Schema.optional(Schema.Unknown) }))
    expect(mcpBody.error).toBeUndefined()
    expect(toolError(mcpBody)?.code).toBe('conflict')
    expect(toolError(mcpBody)?.message).toContain(issueId)
  })

  // B3: force:true steals — prior released, new active, overridden list non-empty
  // 3 requests (claim, force-claim, list) — within limit
  test<FileClaimTestContext>('b3: force:true releases prior claim and creates new; overridden list contains prior claim', async ({
    issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
  }) => {
    // Claim path in issue A
    await claimFiles({ issueId, paths: ['src/steal.ts'] }, { slug, token })

    // Second issue steals it
    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Issue 2' })
    const forceRes = await claimFiles({ issueId: issue2.id, paths: ['src/steal.ts'], force: true }, { slug, token })
    expect(forceRes.status).toBe(201)
    const forceBody = await readNativeJson(forceRes, ApiResults.apiClaimFiles)
    expect(forceBody.created).toHaveLength(1)
    expect(forceBody.created[0].issueId).toBe(issue2.id)
    expect(forceBody.created[0].releasedAt).toBeNull()
    expect(forceBody.overridden).toHaveLength(1)
    expect(forceBody.overridden[0].issueId).toBe(issueId)
    expect(forceBody.overridden[0].releasedAt).toBeGreaterThan(0)

    // Verify new holder via list
    const listRes = await listFileClaims({ path: 'src/steal.ts' }, { slug, token })
    const listBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ issueId: Schema.String })).pipe(Schema.mutable),
    })
    const listBody = await readNativeJson(listRes, listBodyShape)
    expect(listBody.items).toHaveLength(1)
    expect(listBody.items[0].issueId).toBe(issue2.id)
  })

  // B4a: release_files sets released_at; path becomes re-claimable
  // 3 requests (claim, release, re-claim) — within limit
  test<FileClaimTestContext>('b4a: release_files sets released_at and path becomes re-claimable', async ({
    issueFixture: { issueId, slug, token },
  }) => {
    await claimFiles({ issueId, paths: ['src/release-me.ts'] }, { slug, token })

    const releaseRes = await releaseFiles({ paths: ['src/release-me.ts'], issueId }, { slug, token })
    expect(releaseRes.status).toBe(200)
    const releaseBodyShape = Schema.Struct({
      count: Schema.Number,
      released: Schema.Array(Schema.Struct({ releasedAt: Schema.Number })).pipe(Schema.mutable),
    })
    const releaseBody = await readNativeJson(releaseRes, releaseBodyShape)
    expect(releaseBody.count).toBe(1)
    expect(releaseBody.released[0].releasedAt).toBeGreaterThan(0)

    // Should now be re-claimable
    const reclaimRes = await claimFiles({ issueId, paths: ['src/release-me.ts'] }, { slug, token })
    expect(reclaimRes.status).toBe(201)
  })

  // B4b: ending an agent session auto-releases that agent's claims; path becomes re-claimable
  // 5 requests (register-agent, claim, end-agent, list, re-claim) — at limit of 5
  test<FileClaimTestContext>('b4b: endAgent auto-releases agent file claims; path becomes re-claimable', async ({
    issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
  }) => {
    // Register an agent session
    const agentRes = await fetchNativeApi('http://localhost/api/agents', {
      body: JSON.stringify({ name: 'test-agent-fc' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(agentRes.status).toBe(201)
    const agent = await readNativeJson(agentRes, IdResponse)

    // Claim a file as that agent
    const agentClaimRes = await claimFiles(
      {
        issueId,
        agentId: agent.id,
        paths: ['src/agent-file.ts'],
      },
      { slug, token },
    )
    expect(agentClaimRes.status).toBe(201)

    // End the agent session — should auto-release claims
    const endRes = await fetchNativeApi(`http://localhost/api/agents/${agent.id}/end`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(endRes.status).toBe(200)

    // Claim should now be gone
    const listRes = await listFileClaims({ path: 'src/agent-file.ts' }, { slug, token })
    const listBody = await readNativeJson(listRes, ItemsResponse)
    expect(listBody.items).toHaveLength(0)

    // Path is re-claimable
    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'After agent end' })
    const reclaimRes = await claimFiles({ issueId: issue2.id, paths: ['src/agent-file.ts'] }, { slug, token })
    expect(reclaimRes.status).toBe(201)
  })

  // B5: list_file_claims({path}) returns holder across issues; tenant isolation
  // 3 requests (claim, list by path, list from other workspace) — within limit
  test<FileClaimTestContext>('b5: list_file_claims({path}) returns holder; claims in workspace X not visible from workspace Y', async ({
    issueFixture: { issueId, slug, token },
  }) => {
    await claimFiles({ issueId, paths: ['src/shared.ts'] }, { slug, token })

    // List by path — should identify the holder
    const listRes = await listFileClaims({ path: 'src/shared.ts' }, { slug, token })
    const listBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ issueId: Schema.String, path: Schema.String })).pipe(Schema.mutable),
    })
    const listBody = await readNativeJson(listRes, listBodyShape)
    expect(listBody.items).toHaveLength(1)
    expect(listBody.items[0].issueId).toBe(issueId)
    expect(listBody.items[0].path).toBe('src/shared.ts')

    // Tenant isolation: workspace Y should not see workspace X's claims
    const other = await seedFixture()
    const otherListRes = await listFileClaims({}, { slug: other.workspace.slug, token: other.token })
    expect(otherListRes.status).toBe(200)
    const otherBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ issueId: Schema.String })).pipe(Schema.mutable),
    })
    const otherBody = await readNativeJson(otherListRes, otherBodyShape)
    expect(otherBody.items.some((item) => item.issueId === issueId)).toBe(false)
  })

  // PROJ-337: rejecting a conflicting claim inserts a claim_conflicts row (forced=0)
  // 1 request (claim) + setup claim already counted below — within limit
  test<FileClaimTestContext>('covers PROJ-337: rejecting a conflicting claim inserts a claim_conflicts row with forced=0', async ({
    issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
  }) => {
    await claimFiles({ issueId, paths: ['src/conflict-log.ts'] }, { slug, token })

    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Rejected issue' })
    const res = await claimFiles({ issueId: issue2.id, paths: ['src/conflict-log.ts'] }, { slug, token })
    expect(res.status).toBe(409)

    const rows = await env.DB.prepare('SELECT * FROM claim_conflicts WHERE workspace_id = ? AND path = ?')
      .bind(workspaceId, 'src/conflict-log.ts')
      .all()
    expect(rows.results).toHaveLength(1)
    const row = rows.results[0] as Record<string, unknown>
    expect(row.forced).toBe(0)
    expect(row.rejected_issue_id).toBe(issue2.id)
    expect(row.holding_issue_id).toBe(issueId)
  })

  // PROJ-337: rejecting a call where multiple paths are held records one row per contended path
  test<FileClaimTestContext>('covers PROJ-337: rejecting a multi-path claim records one row per contended path', async ({
    issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
  }) => {
    await claimFiles({ issueId, paths: ['src/multi-a.ts', 'src/multi-b.ts'] }, { slug, token })

    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Multi rejected' })
    const res = await claimFiles(
      {
        issueId: issue2.id,
        paths: ['src/multi-a.ts', 'src/multi-b.ts'],
      },
      { slug, token },
    )
    expect(res.status).toBe(409)

    const rows = await env.DB.prepare(
      'SELECT path FROM claim_conflicts WHERE workspace_id = ? AND rejected_issue_id = ? AND forced = 0',
    )
      .bind(workspaceId, issue2.id)
      .all()
    expect(rows.results).toHaveLength(2)
    const paths = rows.results
      .map((result) => (result as Record<string, unknown>).path)
      .toSorted((selectedLeft, selectedRight) => {
        const left = String(selectedLeft)
        const right = String(selectedRight)
        return left < right ? -1 : left > right ? 1 : 0
      })
    expect(paths).toStrictEqual(['src/multi-a.ts', 'src/multi-b.ts'])
  })

  // PROJ-337: force:true override inserts a claim_conflicts row (forced=1)
  test<FileClaimTestContext>('covers PROJ-337: force:true override inserts a claim_conflicts row with forced=1', async ({
    issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
  }) => {
    await claimFiles({ issueId, paths: ['src/force-log.ts'] }, { slug, token })

    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Forcing issue' })
    const res = await claimFiles(
      {
        issueId: issue2.id,
        paths: ['src/force-log.ts'],
        force: true,
      },
      { slug, token },
    )
    expect(res.status).toBe(201)

    const rows = await env.DB.prepare('SELECT * FROM claim_conflicts WHERE workspace_id = ? AND path = ?')
      .bind(workspaceId, 'src/force-log.ts')
      .all()
    expect(rows.results).toHaveLength(1)
    const row = rows.results[0] as Record<string, unknown>
    expect(row.forced).toBe(1)
    expect(row.rejected_issue_id).toBe(issue2.id)
    expect(row.holding_issue_id).toBe(issueId)
  })

  // PROJ-337: a non-conflicting claim inserts no claim_conflicts rows
  test<FileClaimTestContext>('covers PROJ-337: a non-conflicting claim inserts no claim_conflicts rows', async ({
    issueFixture: { issueId, slug, token, workspaceId },
  }) => {
    const res = await claimFiles({ issueId, paths: ['src/no-conflict.ts'] }, { slug, token })
    expect(res.status).toBe(201)

    const rows = await env.DB.prepare('SELECT * FROM claim_conflicts WHERE workspace_id = ? AND path = ?')
      .bind(workspaceId, 'src/no-conflict.ts')
      .all()
    expect(rows.results).toHaveLength(0)
  })

  /*
   * PROJ-624: rejection (force=false) must not post any agent message — this was
   * previously mis-stated in the project's own docs as a message-posting path.
   */
  test<FileClaimTestContext>('covers PROJ-624: a rejected claim (force=false) posts no agent message to any scope', async ({
    issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
  }) => {
    await claimFiles({ issueId, paths: ['src/no-message-on-reject.ts'] }, { slug, token })

    const issue2 = await seedIssue(workspaceId, projectId, userId, {
      title: 'Rejected, no message',
    })
    const res = await claimFiles({ issueId: issue2.id, paths: ['src/no-message-on-reject.ts'] }, { slug, token })
    expect(res.status).toBe(409)

    const holderMessages = await listMessagesForScope(`issue:${issueId}`, { slug, token })
    expect(holderMessages.items).toHaveLength(0)

    const rejectedMessages = await listMessagesForScope(`issue:${issue2.id}`, { slug, token })
    expect(rejectedMessages.items).toHaveLength(0)
  })

  test<FileClaimTestContext>('covers PROJ-635/624: force:true override posts a message to both the now-holding and the displaced issue', async ({
    issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
  }) => {
    await claimFiles({ issueId, paths: ['src/message-on-force.ts'] }, { slug, token })

    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Force claims' })
    const forceRes = await claimFiles(
      {
        issueId: issue2.id,
        paths: ['src/message-on-force.ts'],
        force: true,
      },
      { slug, token },
    )
    expect(forceRes.status).toBe(201)

    const messages = await listMessagesForScope(`issue:${issue2.id}`, { slug, token })
    expect(messages.items).toHaveLength(1)
    expect(messages.items[0].body).toContain('src/message-on-force.ts')
    expect(messages.items[0].body).toContain(issueId)

    const priorHolderMessages = await listMessagesForScope(`issue:${issueId}`, { slug, token })
    expect(priorHolderMessages.items).toHaveLength(1)
    expect(priorHolderMessages.items[0].body).toContain('src/message-on-force.ts')
    expect(priorHolderMessages.items[0].body).toContain(issue2.id)
  })

  test<FileClaimTestContext>('covers PROJ-635: force:true override on multiple paths held by the same issue posts one message per side, not one per path', async ({
    issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
  }) => {
    await claimFiles(
      {
        issueId,
        paths: ['src/multi-a.ts', 'src/multi-b.ts', 'src/multi-c.ts'],
      },
      { slug, token },
    )

    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Force claims' })
    const forceRes = await claimFiles(
      {
        issueId: issue2.id,
        paths: ['src/multi-a.ts', 'src/multi-b.ts', 'src/multi-c.ts'],
        force: true,
      },
      { slug, token },
    )
    expect(forceRes.status).toBe(201)

    const messages = await listMessagesForScope(`issue:${issue2.id}`, { slug, token })
    expect(messages.items).toHaveLength(1)
    expect(messages.items[0].body).toContain('src/multi-a.ts')
    expect(messages.items[0].body).toContain('src/multi-b.ts')
    expect(messages.items[0].body).toContain('src/multi-c.ts')

    const priorHolderMessages2 = await listMessagesForScope(`issue:${issueId}`, { slug, token })
    expect(priorHolderMessages2.items).toHaveLength(1)
    expect(priorHolderMessages2.items[0].body).toContain('src/multi-a.ts')
    expect(priorHolderMessages2.items[0].body).toContain('src/multi-b.ts')
    expect(priorHolderMessages2.items[0].body).toContain('src/multi-c.ts')
  })

  /*
   * PROJ-636: a claim whose holding session stopped heartbeating is reclaimed by the next
   * claim on that path, the way issue leases already were.
   *
   * The distinction that matters throughout: a *crashed* agent keeps status 'active' with a
   * stale heartbeat, because status only becomes 'ended' when it calls end_agent — which by
   * definition it didn't. B4b above covers the clean-exit path; none of these do.
   */
  describe('covers PROJ-636: stale-holder reclaim', () => {
    test<FileClaimTestContext>("a crashed agent's claim no longer blocks another issue", async ({
      issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
    }) => {
      // 200s > the 120s TTL. Status stays 'active' — that is the whole point.
      const dead = await seedSession({ token, workspaceId }, { heartbeatAgeSecs: 200 })
      const result = await claimFiles({ issueId, agentId: dead, paths: ['src/abandoned.ts'] }, { slug, token })
      expect(result.status).toBe(201)

      const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Takes over' })
      const res = await claimFiles({ issueId: issue2.id, paths: ['src/abandoned.ts'] }, { slug, token })
      expect(res.status).toBe(201)

      const bodyShape = Schema.Struct({
        created: Schema.Array(Schema.Struct({ issueId: Schema.String })).pipe(Schema.mutable),
        reclaimed: Schema.Array(Schema.Struct({ path: Schema.String, releaseReason: Schema.String })).pipe(
          Schema.mutable,
        ),
      })
      const body = await readNativeJson(res, bodyShape)
      expect(body.created[0].issueId).toBe(issue2.id)
      /*
       * Reported, not silent: an agent that took over an abandoned path should be able to
       * tell that from an uncontested first claim.
       */
      expect(body.reclaimed.map((fileClaim) => fileClaim.path)).toStrictEqual(['src/abandoned.ts'])
      expect(body.reclaimed[0].releaseReason).toBe('expired')
    })

    test<FileClaimTestContext>('marks the reclaimed claim expired, distinct from agent_ended', async ({
      issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
    }) => {
      const dead = await seedSession({ token, workspaceId }, { heartbeatAgeSecs: 200 })
      await claimFiles({ issueId, agentId: dead, paths: ['src/reason.ts'] }, { slug, token })

      const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Takes over' })
      await claimFiles({ issueId: issue2.id, paths: ['src/reason.ts'] }, { slug, token })

      // Two rows now share this path; the released one is the original holder's.
      const released = await env.DB.prepare(
        'SELECT release_reason FROM issue_file_claims WHERE path = ? AND released_at IS NOT NULL',
      )
        .bind('src/reason.ts')
        .first<{ release_reason: string }>()
      /*
       * Not 'agent_ended' — the factory-health tile uses that to mean a clean exit, and a
       * crash reported as a clean exit would hide exactly the failure this ticket is about.
       */
      expect(released?.release_reason).toBe('expired')
    })

    test<FileClaimTestContext>("a live agent's claim still blocks, and is not silently expired", async ({
      issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
    }) => {
      /*
       * The control. Without this, a bug that expired every claim regardless of heartbeat
       * would satisfy every other test in this block.
       */
      const live = await seedSession({ token, workspaceId }, { heartbeatAgeSecs: 5, name: 'live-agent' })
      await claimFiles({ issueId, agentId: live, paths: ['src/held.ts'] }, { slug, token })

      const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Blocked' })
      const resolvedValue = await claimFiles({ issueId: issue2.id, paths: ['src/held.ts'] }, { slug, token })
      expect(resolvedValue.status).toBe(409)
      expect((await claimRow(workspaceId, 'src/held.ts'))?.released_at).toBeNull()
    })

    test<FileClaimTestContext>('an agentless claim within its TTL is not auto-reclaimed', async ({
      issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
    }) => {
      /*
       * No session means no heartbeat to judge, so freshness is judged by claim age instead
       * (PROJ-928, FILE_CLAIM_TTL_SECONDS, default 24h) — a claim made moments ago is well
       * inside that window and still blocks; `force` remains the only way past it early.
       */
      await claimFiles({ issueId, paths: ['src/no-agent.ts'] }, { slug, token })

      const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Blocked' })
      await expect(
        claimFiles({ issueId: issue2.id, paths: ['src/no-agent.ts'] }, { slug, token }),
      ).resolves.toHaveProperty('status', 409)
    })

    test<FileClaimTestContext>('does not record a conflict when superseding a dead holder', async ({
      issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
    }) => {
      const dead = await seedSession({ token, workspaceId }, { heartbeatAgeSecs: 200 })
      await claimFiles({ issueId, agentId: dead, paths: ['src/no-conflict.ts'] }, { slug, token })

      const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Takes over' })
      await claimFiles({ issueId: issue2.id, paths: ['src/no-conflict.ts'] }, { slug, token })

      /* Table claim_conflicts drives the heatmap's contention mode, whose argument is that a
       * repeatedly-hot path says something about how the work was sliced. Fleet mortality
       * is not contention, so counting it there would corrupt the signal. */
      const conflicts = await env.DB.prepare('SELECT COUNT(*) AS n FROM claim_conflicts WHERE path = ?')
        .bind('src/no-conflict.ts')
        .first<{ n: number }>()
      expect(conflicts?.n).toBe(0)
    })

    test<FileClaimTestContext>('still records a conflict when the holder is live', async ({
      issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
    }) => {
      /*
       * The paired control for the assertion above: proves the zero there comes from the
       * holder being dead, not from conflict recording having been broken outright.
       */
      const live = await seedSession({ token, workspaceId }, { heartbeatAgeSecs: 5 })
      await claimFiles({ issueId, agentId: live, paths: ['src/live-conflict.ts'] }, { slug, token })

      const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Rejected' })
      await claimFiles({ issueId: issue2.id, paths: ['src/live-conflict.ts'] }, { slug, token })

      const conflicts = await env.DB.prepare('SELECT COUNT(*) AS n FROM claim_conflicts WHERE path = ?')
        .bind('src/live-conflict.ts')
        .first<{ n: number }>()
      expect(conflicts?.n).toBe(1)
    })

    test<FileClaimTestContext>('reclaims only the stale paths in a mixed multi-path claim', async ({
      issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
    }) => {
      /*
       * Claims are all-or-nothing, so a request spanning a dead holder and a live one must
       * still be refused whole — and must not expire the dead one as a side effect of a
       * request that failed.
       */
      const dead = await seedSession({ token, workspaceId }, { heartbeatAgeSecs: 200 })
      const live = await seedSession({ token, workspaceId }, { heartbeatAgeSecs: 5 })
      await claimFiles({ issueId, agentId: dead, paths: ['src/dead-path.ts'] }, { slug, token })
      const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Live holder' })
      await claimFiles({ issueId: issue2.id, agentId: live, paths: ['src/live-path.ts'] }, { slug, token })

      const issue3 = await seedIssue(workspaceId, projectId, userId, { title: 'Wants both' })
      const res = await claimFiles(
        {
          issueId: issue3.id,
          paths: ['src/dead-path.ts', 'src/live-path.ts'],
        },
        { slug, token },
      )
      expect(res.status).toBe(409)

      // The live path is untouched.
      expect((await claimRow(workspaceId, 'src/live-path.ts'))?.released_at).toBeNull()
      /*
       * The dead one was released on the way through. Documenting the actual behaviour
       * rather than asserting the tidier alternative: reclaim happens before conflict
       * evaluation, so a refused request can still have freed an abandoned path. That is
       * harmless — the path was reclaimable by anyone — but it is a real ordering
       * consequence and worth pinning so a future change to it is a visible decision.
       */
      expect((await claimRow(workspaceId, 'src/dead-path.ts'))?.release_reason).toBe('expired')
    })

    test<FileClaimTestContext>('list_file_claims flags a stale holder as not live', async ({
      issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
    }) => {
      const dead = await seedSession({ token, workspaceId }, { heartbeatAgeSecs: 200 })
      await claimFiles({ issueId, agentId: dead, paths: ['src/listed-dead.ts'] }, { slug, token })
      const live = await seedSession({ token, workspaceId }, { heartbeatAgeSecs: 5 })
      const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Live' })
      await claimFiles({ issueId: issue2.id, agentId: live, paths: ['src/listed-live.ts'] }, { slug, token })

      /*
       * PROJ-932: the default listing excludes stale holders outright — pass
       * includeStale to see both, still flagged via `live`.
       */
      const listRes = await listFileClaims({ includeStale: 'true' }, { slug, token })
      const bodyShape = Schema.Struct({
        items: Schema.Array(Schema.Struct({ live: Schema.Boolean, path: Schema.String })).pipe(Schema.mutable),
      })
      const body = await readNativeJson(listRes, bodyShape)
      const byPath = new Map(body.items.map((item) => [item.path, item.live]))
      expect(byPath.get('src/listed-dead.ts')).toBe(false)
      expect(byPath.get('src/listed-live.ts')).toBe(true)
    })

    /*
     * PROJ-929: claim_files refreshes an already-live agent's heartbeat, but must never
     * revive a crashed one — that would silently defeat the reclaim this block tests.
     */
    test<FileClaimTestContext>("refreshes a live agent's heartbeat, but does not revive a dead one", async ({
      issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
    }) => {
      const live = await seedSession({ token, workspaceId }, { heartbeatAgeSecs: 5 })
      await claimFiles({ issueId, agentId: live, paths: ['src/touch-live.ts'] }, { slug, token })
      const liveRow = await env.DB.prepare('SELECT last_heartbeat_at FROM agent_sessions WHERE id = ?')
        .bind(live)
        .first<{ last_heartbeat_at: number }>()
      expect(liveRow?.last_heartbeat_at).toBeGreaterThan(currentEpochSeconds() - 5)

      const dead = await seedSession({ token, workspaceId }, { heartbeatAgeSecs: 200 })
      const deadBefore = await env.DB.prepare('SELECT last_heartbeat_at FROM agent_sessions WHERE id = ?')
        .bind(dead)
        .first<{ last_heartbeat_at: number }>()
      const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Dead claimer' })
      await claimFiles({ issueId: issue2.id, agentId: dead, paths: ['src/touch-dead.ts'] }, { slug, token })
      const deadAfter = await env.DB.prepare('SELECT last_heartbeat_at FROM agent_sessions WHERE id = ?')
        .bind(dead)
        .first<{ last_heartbeat_at: number }>()
      expect(deadAfter?.last_heartbeat_at).toBe(deadBefore?.last_heartbeat_at)
    })

    /*
     * PROJ-928: an agentless claim has no heartbeat to judge staleness by, so it is judged
     * by claim age against a configurable TTL (FILE_CLAIM_TTL_SECONDS, default 24h) instead —
     * same reclaim path as a claim whose agent session went stale.
     */
    describe('covers PROJ-928: agentless claim TTL', () => {
      test<FileClaimTestContext>('an agentless claim past the default 24h TTL is reclaimed by the next claimer', async ({
        issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
      }) => {
        await claimFiles({ issueId, paths: ['src/ttl-expired.ts'] }, { slug, token })
        await backdateClaim(workspaceId, 'src/ttl-expired.ts', 24 * 60 * 60 + 1)

        const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Takes over' })
        const res = await claimFiles({ issueId: issue2.id, paths: ['src/ttl-expired.ts'] }, { slug, token })
        expect(res.status).toBe(201)
        const bodyShape = Schema.Struct({
          reclaimed: Schema.Array(Schema.Struct({ path: Schema.String, releaseReason: Schema.String })).pipe(
            Schema.mutable,
          ),
        })
        const body = await readNativeJson(res, bodyShape)
        expect(body.reclaimed.map((fileClaim) => fileClaim.path)).toStrictEqual(['src/ttl-expired.ts'])
        expect(body.reclaimed[0].releaseReason).toBe('expired')
      })

      test<FileClaimTestContext>('covers FILE_CLAIM_TTL_SECONDS overrides the default', async ({
        issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
      }) => {
        const previous = env.FILE_CLAIM_TTL_SECONDS
        env.FILE_CLAIM_TTL_SECONDS = '60'
        await configureCore({ FILE_CLAIM_TTL_SECONDS: '60' })
        try {
          await claimFiles({ issueId, paths: ['src/ttl-short.ts'] }, { slug, token })
          await backdateClaim(workspaceId, 'src/ttl-short.ts', 61)

          const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Takes over' })
          const res = await claimFiles({ issueId: issue2.id, paths: ['src/ttl-short.ts'] }, { slug, token })
          expect(res.status).toBe(201)
        } finally {
          env.FILE_CLAIM_TTL_SECONDS = previous
          await configureCore()
        }
      })
    })
  })

  /*
   * PROJ-928: moving an issue to done/cancelled releases its file claims (release_reason
   * "issue_closed") so a closed issue doesn't keep blocking the fleet on paths no one is
   * still working.
   */
  describe('covers PROJ-928: issue close releases file claims', () => {
    test<FileClaimTestContext>('marking an issue done releases its file claims', async ({
      issueFixture: { issueId, slug, token, workspaceId },
    }) => {
      await claimFiles({ issueId, paths: ['src/done-releases.ts'] }, { slug, token })

      await expect(patchStatus({ slug, token }, issueId, 'done')).resolves.toHaveProperty('status', 200)

      const listRes = await listFileClaims({ path: 'src/done-releases.ts' }, { slug, token })
      const listBody = await readNativeJson(listRes, ItemsResponse)
      expect(listBody.items).toHaveLength(0)

      const row = await env.DB.prepare(
        'SELECT release_reason FROM issue_file_claims WHERE path = ? AND workspace_id = ?',
      )
        .bind('src/done-releases.ts', workspaceId)
        .first<{ release_reason: string }>()
      expect(row?.release_reason).toBe('issue_closed')
    })

    test<FileClaimTestContext>('marking an issue cancelled releases its file claims', async ({
      issueFixture: { issueId, slug, token },
    }) => {
      await claimFiles({ issueId, paths: ['src/cancelled-releases.ts'] }, { slug, token })

      await expect(patchStatus({ slug, token }, issueId, 'cancelled')).resolves.toHaveProperty('status', 200)

      const listRes = await listFileClaims({ path: 'src/cancelled-releases.ts' }, { slug, token })
      const listBody = await readNativeJson(listRes, ItemsResponse)
      expect(listBody.items).toHaveLength(0)
    })

    test<FileClaimTestContext>('a title-only update of an already-done issue does not re-release a new claim', async ({
      issueFixture: { issueId, slug, token },
    }) => {
      await expect(patchStatus({ slug, token }, issueId, 'done')).resolves.toHaveProperty('status', 200)
      /*
       * A fresh claim made after the issue is already done — a subsequent non-status
       * update must not sweep it up.
       */
      await claimFiles({ issueId, paths: ['src/after-done.ts'] }, { slug, token })

      const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}`, {
        body: JSON.stringify({ title: 'Renamed' }),
        headers: authHeaders(token, slug),
        method: 'PATCH',
      })
      expect(res.status).toBe(200)

      const listRes = await listFileClaims({ path: 'src/after-done.ts' }, { slug, token })
      const listBody = await readNativeJson(listRes, ItemsResponse)
      expect(listBody.items).toHaveLength(1)
    })
  })

  /*
   * PROJ-932: list_file_claims defaults to live entries only; projectId scopes to one
   * project (key or uuid); every item carries the linked issue's ref.
   */
  describe('covers PROJ-932: projectId filter and issueRef', () => {
    // The default key from seedProject
    const projectKey = 'PROJ'

    test<FileClaimTestContext>("every item carries the issue's issueRef", async ({
      issueFixture: { issueId, slug, token },
    }) => {
      await claimFiles({ issueId, paths: ['src/ref-check.ts'] }, { slug, token })

      const issueRow = await env.DB.prepare('SELECT number FROM issues WHERE id = ?')
        .bind(issueId)
        .first<{ number: number }>()

      const listRes = await listFileClaims({ path: 'src/ref-check.ts' }, { slug, token })
      const bodyShape = Schema.Struct({
        items: Schema.Array(Schema.Struct({ issueRef: Schema.String })).pipe(Schema.mutable),
      })
      const body = await readNativeJson(listRes, bodyShape)
      expect(body.items).toHaveLength(1)
      expect(body.items[0].issueRef).toBe(`${projectKey}-${issueRow?.number}`)
    })

    /* The projectId filter must exclude a claim in a SECOND project in the SAME workspace, not just
     * a claim that happens to live in another workspace (which the plain visibility
     * filter would already have excluded, passing even with the filter absent). */
    test<FileClaimTestContext>("projectId filters to the granted project's claim, excluding a second same-workspace project's (by key and uuid)", async ({
      issueFixture: { issueId, projectId, slug, token, userId, workspaceId },
    }) => {
      const otherProject = await seedProject(workspaceId, 'OTHR')
      const otherIssue = await seedIssue(workspaceId, otherProject.id, userId, {
        title: 'Other project',
      })

      await claimFiles({ issueId, paths: ['src/in-project.ts'] }, { slug, token })
      await claimFiles({ issueId: otherIssue.id, paths: ['src/in-other.ts'] }, { slug, token })

      const byKey = await listFileClaims({ projectId: projectKey }, { slug, token })
      const keyedClaims = await readNativeJson(byKey, ApiResults.apiListFileClaims)
      const byKeyPaths = keyedClaims.items.map((item) => item.path)
      expect(byKeyPaths).toContain('src/in-project.ts')
      expect(byKeyPaths).not.toContain('src/in-other.ts')

      const byUuid = await listFileClaims({ projectId }, { slug, token })
      const uuidClaims = await readNativeJson(byUuid, ApiResults.apiListFileClaims)
      const byUuidPaths = uuidClaims.items.map((item) => item.path)
      expect(byUuidPaths).toContain('src/in-project.ts')
      expect(byUuidPaths).not.toContain('src/in-other.ts')
    })

    test<FileClaimTestContext>('covers REST parity: GET /api/file-claims accepts includeStale and projectId', async ({
      issueFixture: { issueId, slug, token },
    }) => {
      await claimFiles({ issueId, paths: ['src/rest-parity.ts'] }, { slug, token })

      const byKey = await listFileClaims({ projectId: projectKey }, { slug, token })
      const byKeyBodyShape = Schema.Struct({
        items: Schema.Array(Schema.Struct({ path: Schema.String })).pipe(Schema.mutable),
      })
      const byKeyBody = await readNativeJson(byKey, byKeyBodyShape)
      expect(byKeyBody.items.map((item) => item.path)).toContain('src/rest-parity.ts')

      const stale = await listFileClaims({ includeStale: 'true' }, { slug, token })
      expect(stale.status).toBe(200)
    })
  })

  // PROJ-932: default listing excludes a stale-holder claim regardless of holder shape
  // (agent-linked vs agentless); includeStale restores it. Both cases fail if the
  // `if (!includeStale)` filter in listFileClaims is removed.
  describe('covers PROJ-932: default excludes stale/expired claims; includeStale includes them', () => {
    test<FileClaimTestContext>('excludes an agent-linked claim whose session heartbeat is stale; includeStale:true includes it, flagged live:false', async ({
      issueFixture: { issueId, slug, token, workspaceId },
    }) => {
      const dead = await seedStaleAgentSession({ token, workspaceId })
      await expect(
        claimFiles({ issueId, agentId: dead, paths: ['src/stale-agent-932.ts'] }, { slug, token }),
      ).resolves.toHaveProperty('status', 201)

      const withoutFlag = await listFileClaims({ path: 'src/stale-agent-932.ts' }, { slug, token })
      const activeClaims = await readNativeJson(withoutFlag, ItemsResponse)
      expect(activeClaims.items).toHaveLength(0)

      const withFlag = await listFileClaims(
        {
          path: 'src/stale-agent-932.ts',
          includeStale: 'true',
        },
        { slug, token },
      )
      const withBodyShape = Schema.Struct({
        items: Schema.Array(Schema.Struct({ live: Schema.Boolean })).pipe(Schema.mutable),
      })
      const withBody = await readNativeJson(withFlag, withBodyShape)
      expect(withBody.items).toHaveLength(1)
      expect(withBody.items[0].live).toBe(false)
    })

    test<FileClaimTestContext>('excludes an agentless claim past the file-claim TTL; includeStale:true includes it, flagged live:false', async ({
      issueFixture: { issueId, slug, token, workspaceId },
    }) => {
      await expect(
        claimFiles({ issueId, paths: ['src/expired-agentless-932.ts'] }, { slug, token }),
      ).resolves.toHaveProperty('status', 201)
      await env.DB.prepare('UPDATE issue_file_claims SET claimed_at = ? WHERE path = ? AND workspace_id = ?')
        .bind(
          // Past the default 24h TTL
          currentEpochSeconds() - (24 * 60 * 60 + 1),
          'src/expired-agentless-932.ts',
          workspaceId,
        )
        .run()

      const withoutFlag = await listFileClaims({ path: 'src/expired-agentless-932.ts' }, { slug, token })
      const activeClaims = await readNativeJson(withoutFlag, ItemsResponse)
      expect(activeClaims.items).toHaveLength(0)

      const withFlag = await listFileClaims(
        {
          path: 'src/expired-agentless-932.ts',
          includeStale: 'true',
        },
        { slug, token },
      )
      const withBodyShape = Schema.Struct({
        items: Schema.Array(Schema.Struct({ live: Schema.Boolean })).pipe(Schema.mutable),
      })
      const withBody = await readNativeJson(withFlag, withBodyShape)
      expect(withBody.items).toHaveLength(1)
      expect(withBody.items[0].live).toBe(false)
    })
  })
})

/*
 * PROJ-932: a member without a group grant on a project must get an empty result for
 * that project's key or uuid — not just fewer results, none at all — proving the
 * projectId filter composes with (rather than bypasses) PROJ-316 visibility.
 */
describe('covers PROJ-932: list_file_claims projectId + visibility for a non-admin member', () => {
  test("a hidden project's key or uuid returns no claims", async () => {
    const { token, slug, workspaceId, userId } = await seedIssueFixture({ role: 'member' })
    const hidden = await seedProject(workspaceId, 'HIDN')
    // No group grant for `userId` on `hidden` — it stays invisible to them.
    const hiddenIssue = await seedIssue(workspaceId, hidden.id, userId, { title: 'Hidden' })

    const claimRes = await fetchNativeApi('http://localhost/api/file-claims', {
      body: JSON.stringify({ issueId: hiddenIssue.id, paths: ['hidden/secret.ts'] }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(claimRes.status).toBe(404)
    // Seed existing state directly. A member may not create a claim in a hidden project.
    await env.DB.prepare(`INSERT INTO issue_file_claims
      (id, workspace_id, issue_id, path, claimed_at)
      VALUES (?, ?, ?, 'hidden/secret.ts', ?)`)
      .bind(crypto.randomUUID(), workspaceId, hiddenIssue.id, currentEpochSeconds())
      .run()

    const list = async function list(params: Record<string, string>): Promise<Response> {
      const qs = new URLSearchParams(params).toString()
      return fetchNativeApi(`http://localhost/api/file-claims?${qs}`, {
        headers: authHeaders(token, slug),
      })
    }

    const byKey = await list({ projectId: 'HIDN' })
    const keyedClaims = await readNativeJson(byKey, ItemsResponse)
    expect(keyedClaims.items).toHaveLength(0)

    const byUuid = await list({ projectId: hidden.id })
    const uuidClaims = await readNativeJson(byUuid, ItemsResponse)
    expect(uuidClaims.items).toHaveLength(0)
  })
})
