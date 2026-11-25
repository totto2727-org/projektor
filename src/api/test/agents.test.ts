import { Predicate, Schema, Iterable } from 'effect'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { startWork as startWorkDirect } from '#commands/agents.ts'
import type { ServiceCtx } from '#commands/types.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture, seedGroupGrant, seedIssue, seedProject, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import {
  IdListResponse,
  IdResponse,
  ItemsResponse,
  JsonRecordResponse,
  McpRpcResponse,
  parseNativeMcpText,
  readNativeJson,
} from './response-json.ts'

interface AgentApiTestContext {
  projectFixture: Awaited<ReturnType<typeof seedProjectFixture>>
}

type AgentRequestAuth = Pick<AgentApiTestContext['projectFixture'], 'slug' | 'token'>

const registerAgent = async function registerAgent(
  { slug, token }: AgentRequestAuth,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetchNativeApi('http://localhost/api/agents', {
    body: JSON.stringify(body),
    headers: authHeaders(token, slug),
    method: 'POST',
  })
}

describe('agents API', () => {
  beforeEach<AgentApiTestContext>(async (context) => {
    context.projectFixture = await seedProjectFixture()
  })

  // A1: register -> active, appears in list_active_agents by issueId
  test<AgentApiTestContext>('a1: POST /api/agents registers a session and it appears in GET list filtered by issueId', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Test Issue' })

    const res = await registerAgent({ slug, token }, { name: 'test-agent', issueId: issue.id })
    expect(res.status).toBe(201)
    const session = await readNativeJson(res, Schema.Struct({ id: Schema.String, status: Schema.String }))
    expect(isNonEmptyText(session.id)).toBe(true)
    expect(session.status).toBe('active')

    const listRes = await fetchNativeApi(`http://localhost/api/agents?issueId=${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    expect(listRes.status).toBe(200)
    const bodyShape = Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable) })
    const body = await readNativeJson(listRes, bodyShape)
    expect(body.items.some((item) => item.id === session.id)).toBe(true)
  })

  // A2: heartbeat bumps last_heartbeat_at; stale session excluded from list
  test<AgentApiTestContext>('a2: heartbeat updates last_heartbeat_at; stale session is excluded from list', async ({
    projectFixture: { slug, token },
  }) => {
    const res = await registerAgent({ slug, token }, { name: 'heartbeat-agent' })
    expect(res.status).toBe(201)
    const session = await readNativeJson(res, IdResponse)

    // Heartbeat should succeed
    const hbRes = await fetchNativeApi(`http://localhost/api/agents/${session.id}/heartbeat`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(hbRes.status).toBe(200)
    const updated = await readNativeJson(hbRes, Schema.Struct({ lastHeartbeatAt: Schema.Number }))
    expect(updated.lastHeartbeatAt).toSatisfy(Predicate.isNumber)

    // Backdate the heartbeat to simulate staleness (> 120s ago)
    const stale = currentEpochSeconds() - 200
    await env.DB.prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?').bind(stale, session.id).run()

    // Should now be excluded from active list
    const listRes = await fetchNativeApi('http://localhost/api/agents', {
      headers: authHeaders(token, slug),
    })
    expect(listRes.status).toBe(200)
    const listBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
    })
    const listBody = await readNativeJson(listRes, listBodyShape)
    expect(listBody.items.some((item) => item.id === session.id)).toBe(false)
  })

  // A3: end -> status='ended', excluded from active list
  test<AgentApiTestContext>('a3: POST /:id/end sets status=ended and excludes session from active list', async ({
    projectFixture: { slug, token },
  }) => {
    const res = await registerAgent({ slug, token }, { name: 'end-agent' })
    expect(res.status).toBe(201)
    const session = await readNativeJson(res, IdResponse)

    const endRes = await fetchNativeApi(`http://localhost/api/agents/${session.id}/end`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(endRes.status).toBe(200)
    const ended = await readNativeJson(
      endRes,
      Schema.Struct({ endedAt: Schema.Union([Schema.Number, Schema.Null]), status: Schema.String }),
    )
    expect(ended.status).toBe('ended')
    expect(ended.endedAt).toBeGreaterThan(0)

    // Must not appear in active list
    const listRes = await fetchNativeApi('http://localhost/api/agents', {
      headers: authHeaders(token, slug),
    })
    const listBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
    })
    const listBody = await readNativeJson(listRes, listBodyShape)
    expect(listBody.items.some((item) => item.id === session.id)).toBe(false)
  })

  /*
   * A4 (PROJ-336): kind is deprecated — still accepted for MCP compatibility but
   * ignored, and no longer present in register/list responses as a trust signal.
   */
  test<AgentApiTestContext>('a4: caller-supplied kind is accepted but ignored, and absent from responses', async ({
    projectFixture: { slug, token },
  }) => {
    const agentRes = await registerAgent({ slug, token }, { name: 'bot' })
    const agentSession = await readNativeJson(agentRes, Schema.Record(Schema.String, Schema.Unknown))
    expect(agentSession.kind).toBeUndefined()

    const humanRes = await registerAgent({ slug, token }, { name: 'human-user', kind: 'human' })
    expect(humanRes.status).toBe(201)
    const humanSession = await readNativeJson(humanRes, JsonRecordResponse)
    expect(humanSession.kind).toBeUndefined()

    const listRes = await fetchNativeApi('http://localhost/api/agents', {
      headers: authHeaders(token, slug),
    })
    const listBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)).pipe(Schema.mutable),
    })
    const listBody = await readNativeJson(listRes, listBodyShape)
    const humanItem = listBody.items.find((item) => item.id === humanSession.id)
    expect(humanItem).toBeDefined()
    expect(humanItem?.kind).toBeUndefined()
  })

  // A5: tenant isolation
  test<AgentApiTestContext>('a5: session in workspace X is not visible from workspace Y; heartbeat/end from Y -> 404', async ({
    projectFixture: { slug, token },
  }) => {
    const other = await seedFixture()

    // Register session in our workspace (X)
    const res = await registerAgent({ slug, token }, { name: 'isolated-agent' })
    const session = await readNativeJson(res, IdResponse)

    // Workspace Y should not see it
    const listRes = await fetchNativeApi('http://localhost/api/agents', {
      headers: authHeaders(other.token, other.workspace.slug),
    })
    const listBodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
    })
    const listBody = await readNativeJson(listRes, listBodyShape)
    expect(listBody.items.some((item) => item.id === session.id)).toBe(false)

    // Heartbeat from Y -> 404
    const hbRes = await fetchNativeApi(`http://localhost/api/agents/${session.id}/heartbeat`, {
      headers: authHeaders(other.token, other.workspace.slug),
      method: 'POST',
    })
    expect(hbRes.status).toBe(404)

    // End from Y -> 404
    const endRes = await fetchNativeApi(`http://localhost/api/agents/${session.id}/end`, {
      headers: authHeaders(other.token, other.workspace.slug),
      method: 'POST',
    })
    expect(endRes.status).toBe(404)
  })

  test<AgentApiTestContext>('handles POST /api/agents returns 400 for missing name', async ({
    projectFixture: { slug, token },
  }) => {
    const res = await registerAgent({ slug, token }, {})
    expect(res.status).toBe(400)
  })

  test<AgentApiTestContext>('handles POST /api/agents returns 404 for unknown issueId', async ({
    projectFixture: { slug, token },
  }) => {
    const res = await registerAgent({ slug, token }, { name: 'orphan', issueId: crypto.randomUUID() })
    expect(res.status).toBe(404)
  })

  test<AgentApiTestContext>('handles POST /:id/heartbeat returns 404 for unknown id', async ({
    projectFixture: { slug, token },
  }) => {
    const res = await fetchNativeApi(`http://localhost/api/agents/${crypto.randomUUID()}/heartbeat`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  test<AgentApiTestContext>('handles POST /:id/end returns 404 for unknown id', async ({
    projectFixture: { slug, token },
  }) => {
    const res = await fetchNativeApi(`http://localhost/api/agents/${crypto.randomUUID()}/end`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  test<AgentApiTestContext>('handles GET /api/agents returns all active sessions in workspace', async ({
    projectFixture: { slug, token },
  }) => {
    await registerAgent({ slug, token }, { name: 'agent-1' })
    await registerAgent({ slug, token }, { name: 'agent-2' })

    const listRes = await fetchNativeApi('http://localhost/api/agents', {
      headers: authHeaders(token, slug),
    })
    const bodyShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ name: Schema.String })).pipe(Schema.mutable),
    })
    const body = await readNativeJson(listRes, bodyShape)
    const names = body.items.map((item) => item.name)
    expect(names).toContain('agent-1')
    expect(names).toContain('agent-2')
  })

  // PROJ-929: start_work / finish_work replace the 5-call fleet routine.
  describe('covers PROJ-929: start_work / finish_work', () => {
    const startWork = function startWork(
      { slug, token }: AgentRequestAuth,
      body: Record<string, unknown>,
    ): Promise<Response> {
      return fetchNativeApi('http://localhost/api/agents/start-work', {
        body: JSON.stringify(body),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
    }

    const finishWork = function finishWork(
      { slug, token }: AgentRequestAuth,
      body: Record<string, unknown>,
    ): Promise<Response> {
      return fetchNativeApi('http://localhost/api/agents/finish-work', {
        body: JSON.stringify(body),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
    }

    const mcpCall = async function mcpCall(
      { slug, token, workspaceId }: Pick<AgentApiTestContext['projectFixture'], 'slug' | 'token' | 'workspaceId'>,
      name: string,
      args: Record<string, unknown>,
    ) {
      const res = await fetchNativeApi(
        `http://localhost/mcp/${workspaceId}`,
        requestOptionsWithBody(
          'POST',
          {
            Authorization: `Bearer ${token}`,
            'X-Workspace-Slug': slug,
            'Content-Type': 'application/json',
          },
          JSON.stringify({
            id: 1,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { arguments: args, name },
          }),
        ),
      )
      const body = await readNativeJson(res, McpRpcResponse)
      return { status: res.status, body }
    }

    test<AgentApiTestContext>('registers, claims the issue and files, and posts a start message in one call', async ({
      projectFixture: { projectId, slug, token, userId, workspaceId },
    }) => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Start work' })

      const res = await startWork(
        { slug, token },
        {
          issue: issue.id,
          paths: ['src/a.ts', 'src/b.ts'],
          name: 'worker-1',
        },
      )
      expect(res.status).toBe(201)
      const bodyShape = Schema.Struct({
        claimedFiles: Schema.Array(Schema.Struct({ path: Schema.String })).pipe(Schema.mutable),
        lease: Schema.Struct({ issueId: Schema.String }),
        sessionId: Schema.String,
      })
      const body = await readNativeJson(res, bodyShape)
      expect(isNonEmptyText(body.sessionId)).toBe(true)
      expect(body.lease.issueId).toBe(issue.id)
      expect(body.claimedFiles.map((fileClaim) => fileClaim.path).toSorted()).toStrictEqual(['src/a.ts', 'src/b.ts'])

      const leaseRow = await env.DB.prepare(
        'SELECT agent_session_id FROM issue_leases WHERE issue_id = ? AND released_at IS NULL',
      )
        .bind(issue.id)
        .first<{ agent_session_id: string }>()
      expect(leaseRow?.agent_session_id).toBe(body.sessionId)

      const messages = await env.DB.prepare('SELECT body FROM agent_messages WHERE scope = ?')
        .bind(`issue:${issue.id}`)
        .all<{ body: string }>()
      expect(messages.results.some((result) => result.body.includes('started work'))).toBe(true)
    })

    test<AgentApiTestContext>('works with no paths given', async ({
      projectFixture: { projectId, slug, token, userId, workspaceId },
    }) => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'No paths' })
      const res = await startWork({ slug, token }, { issue: issue.id, name: 'worker-1' })
      expect(res.status).toBe(201)
      const body = await readNativeJson(
        res,
        Schema.Struct({ claimedFiles: Schema.Array(Schema.Unknown).pipe(Schema.mutable) }),
      )
      expect(body.claimedFiles).toStrictEqual([])
    })

    test<AgentApiTestContext>('is all-or-nothing: a lease conflict leaves no session, lease, or claim behind', async ({
      projectFixture: { projectId, slug, token, userId, workspaceId },
    }) => {
      expect.hasAssertions()
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Contended' })
      const first = await startWork({ slug, token }, { issue: issue.id, name: 'worker-1' })
      expect(first.status).toBe(201)

      const second = await startWork(
        { slug, token },
        {
          issue: issue.id,
          paths: ['src/never-claimed.ts'],
          name: 'worker-2',
        },
      )
      // Same ConflictError as claim_issue today
      expect(second.status).toBe(409)

      const sessions = await env.DB.prepare("SELECT id, status FROM agent_sessions WHERE name = 'worker-2'").all<{
        id: string
        status: string
      }>()
      /*
       * The session was registered internally, then compensated — either absent, or
       * present but already ended, never left active.
       */
      Iterable.forEach(sessions.results, (result) => {
        expect(result.status).toBe('ended')
      })

      const claim = await env.DB.prepare('SELECT id FROM issue_file_claims WHERE path = ?')
        .bind('src/never-claimed.ts')
        .first()
      expect(claim).toBeNull()
    })

    /*
     * PROJ-929 review fix-up: the compensating endAgent() in startWork's catch block must
     * not let its own failure hide the original error, or silently crash the request.
     */
    describe('compensating endAgent failure is isolated (PROJ-929 fix-up)', () => {
      afterEach(() => {
        vi.restoreAllMocks()
      })

      test<AgentApiTestContext>('rethrows the original conflict error even when the compensating endAgent call itself fails', async ({
        projectFixture: { projectId, userId, workspaceId },
      }) => {
        const issue1 = await seedIssue(workspaceId, projectId, userId, { title: 'Holds file' })
        const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Wants file' })
        await startWorkDirect(
          {
            db: env.DB,
            kv: env.KV,
            r2: env.R2,
            workspaceId,
            userId,
            role: 'owner',
            auth: { kind: 'human', method: 'dev' },
          } as ServiceCtx,
          { issue: issue1.id, paths: ['src/contended.ts'], name: 'holder' },
        )

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const origPrepare = env.DB.prepare.bind(env.DB)
        vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
          const stmt = origPrepare(sql)
          /*
           * Simulate a D1 outage specifically for endAgent's own status='ended' update
           * (its bind args carry "ended" as the new status), leaving every other query —
           * including the earlier successful claimIssue/claimFiles calls — untouched.
           */
          if (/update .*agent_sessions/i.test(sql)) {
            const origBind = stmt.bind.bind(stmt)
            // Copy only the same enumerable own properties as the original spread, not prototype methods.
            return Object.assign({}, stmt, {
              bind: (...args: unknown[]) => {
                if (args.includes('ended')) {
                  throw new Error('simulated D1 outage during compensating endAgent')
                }
                return origBind(...args)
              },
            }) as D1PreparedStatement
          }
          return stmt
        })

        const ctx: ServiceCtx = {
          db: env.DB,
          kv: env.KV,
          r2: env.R2,
          workspaceId,
          userId,
          role: 'owner',
          auth: { kind: 'human', method: 'dev' },
        } as ServiceCtx

        await expect(
          startWorkDirect(ctx, {
            issue: issue2.id,
            paths: ['src/contended.ts'],
            name: 'wants-it',
          }),
        ).rejects.toMatchObject({ kind: 'conflict' })

        // The compensating-cleanup failure was logged, not thrown or swallowed silently.
        expect(errorSpy).toHaveBeenCalled()
      })
    })

    test<AgentApiTestContext>('is all-or-nothing: a file-claim conflict releases the lease it just took', async ({
      projectFixture: { projectId, slug, token, userId, workspaceId },
    }) => {
      const issue1 = await seedIssue(workspaceId, projectId, userId, { title: 'Holds file' })
      const heldRes = await startWork(
        { slug, token },
        {
          issue: issue1.id,
          paths: ['src/contended.ts'],
          name: 'holder',
        },
      )
      expect(heldRes.status).toBe(201)

      const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Wants file' })
      const res = await startWork(
        { slug, token },
        {
          issue: issue2.id,
          paths: ['src/contended.ts'],
          name: 'wants-it',
        },
      )
      // Same ConflictError as claim_files today
      expect(res.status).toBe(409)

      // The issue2 fixture never ended up with a live lease — the failed file claim rolled it back.
      const lease = await env.DB.prepare('SELECT id FROM issue_leases WHERE issue_id = ? AND released_at IS NULL')
        .bind(issue2.id)
        .first()
      expect(lease).toBeNull()
    })

    test<AgentApiTestContext>('finish_work transitions the issue, releases everything, and ends the session', async ({
      projectFixture: { projectId, slug, token, userId, workspaceId },
    }) => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Finish' })
      const started = await startWork({ slug, token }, { issue: issue.id, paths: ['src/finish.ts'], name: 'w' })
      const { sessionId } = await readNativeJson(started, Schema.Struct({ sessionId: Schema.String }))

      const res = await finishWork(
        { slug, token },
        {
          sessionId,
          issue: issue.id,
          status: 'done',
          completionReport: { summary: 'Done', verification: 'pnpm test' },
        },
      )
      expect(res.status).toBe(200)

      const issueRow = await env.DB.prepare('SELECT status FROM issues WHERE id = ?')
        .bind(issue.id)
        .first<{ status: string }>()
      expect(issueRow?.status).toBe('done')

      const lease = await env.DB.prepare('SELECT id FROM issue_leases WHERE issue_id = ? AND released_at IS NULL')
        .bind(issue.id)
        .first()
      expect(lease).toBeNull()

      const claim = await env.DB.prepare('SELECT id FROM issue_file_claims WHERE issue_id = ? AND released_at IS NULL')
        .bind(issue.id)
        .first()
      expect(claim).toBeNull()

      const session = await env.DB.prepare('SELECT status FROM agent_sessions WHERE id = ?')
        .bind(sessionId)
        .first<{ status: string }>()
      expect(session?.status).toBe('ended')
    })

    test<AgentApiTestContext>('finish_work with no status/completionReport just releases and ends the session', async ({
      projectFixture: { projectId, slug, token, userId, workspaceId },
    }) => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'No transition' })
      const started = await startWork({ slug, token }, { issue: issue.id, name: 'w' })
      const { sessionId } = await readNativeJson(started, Schema.Struct({ sessionId: Schema.String }))

      const res = await finishWork({ slug, token }, { sessionId, issue: issue.id })
      expect(res.status).toBe(200)

      const issueRow = await env.DB.prepare('SELECT status FROM issues WHERE id = ?')
        .bind(issue.id)
        .first<{ status: string }>()
      // Unchanged
      expect(issueRow?.status).toBe('backlog')

      const session = await env.DB.prepare('SELECT status FROM agent_sessions WHERE id = ?')
        .bind(sessionId)
        .first<{ status: string }>()
      expect(session?.status).toBe('ended')
    })

    test<AgentApiTestContext>("claim_issue (via start_work) refreshes the session's heartbeat", async ({
      projectFixture: { projectId, slug, token, userId, workspaceId },
    }) => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Heartbeat' })
      const before = currentEpochSeconds() - 100

      const res = await startWork({ slug, token }, { issue: issue.id, name: 'w' })
      const { sessionId } = await readNativeJson(res, Schema.Struct({ sessionId: Schema.String }))

      const session = await env.DB.prepare('SELECT last_heartbeat_at FROM agent_sessions WHERE id = ?')
        .bind(sessionId)
        .first<{ last_heartbeat_at: number }>()
      expect(session?.last_heartbeat_at).toBeGreaterThanOrEqual(before)
    })

    test<AgentApiTestContext>('covers MCP parity: start_work and finish_work work the same over MCP', async ({
      projectFixture: { projectId, slug, token, userId, workspaceId },
    }) => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'MCP path' })

      const started = await mcpCall({ slug, token, workspaceId }, 'start_work', { issue: issue.id, name: 'mcp-worker' })
      expect(started.status).toBe(200)
      const startedResult = parseNativeMcpText(
        started.body.result?.content?.[0].text ?? '{}',
        Schema.Struct({ sessionId: Schema.String }),
      )
      expect(isNonEmptyText(startedResult.sessionId)).toBe(true)

      const finished = await mcpCall({ slug, token, workspaceId }, 'finish_work', {
        sessionId: startedResult.sessionId,
        issue: issue.id,
        status: 'cancelled',
      })
      expect(finished.status).toBe(200)
      expect(finished.body.result?.isError).not.toBe(true)

      const issueRow = await env.DB.prepare('SELECT status FROM issues WHERE id = ?')
        .bind(issue.id)
        .first<{ status: string }>()
      expect(issueRow?.status).toBe('cancelled')
    })

    test<AgentApiTestContext>('the old tools still work standalone (register_agent/claim_issue/release_issue/end_agent)', async ({
      projectFixture: { projectId, slug, token, userId, workspaceId },
    }) => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Old path' })
      const reg = await registerAgent({ slug, token }, { name: 'old-style' })
      const { id: agentId } = await readNativeJson(reg, IdResponse)

      const claim = await fetchNativeApi(`http://localhost/api/issues/${issue.id}/claim`, {
        body: JSON.stringify({ agentId }),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
      expect(claim.status).toBe(201)

      const end = await fetchNativeApi(`http://localhost/api/agents/${agentId}/end`, {
        headers: authHeaders(token, slug),
        method: 'POST',
      })
      expect(end.status).toBe(200)
    })
  })

  /*
   * PROJ-932: list_active_agents defaults to live entries only; includeStale widens the
   * heartbeat check but never returns an ended session; projectId scopes to one project
   * (key or uuid) via the linked issue; every item carries `live`, and a linked item
   * carries issueRef.
   */
  describe('covers PROJ-932: live-only default, includeStale, projectId, issueRef, live flag', () => {
    // SeedProject's default key
    const projectKey = 'PROJ'

    const backdateHeartbeat = function backdateHeartbeat(
      agentId: string,
      secondsAgo = 200,
    ): Promise<D1Result<Record<string, unknown>>> {
      const stale = currentEpochSeconds() - secondsAgo
      return env.DB.prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?').bind(stale, agentId).run()
    }

    const listAgents = async function listAgents(
      { slug, token }: AgentRequestAuth,
      params: Record<string, string> = {},
    ): Promise<Response> {
      const qs = new URLSearchParams(params).toString()
      return fetchNativeApi(`http://localhost/api/agents${qs ? `?${qs}` : ''}`, {
        headers: authHeaders(token, slug),
      })
    }

    test<AgentApiTestContext>('excludes a session with a stale heartbeat by default; includeStale:true includes it, flagged live:false', async ({
      projectFixture: { slug, token },
    }) => {
      const res = await registerAgent({ slug, token }, { name: 'stale-agent-932' })
      const session = await readNativeJson(res, IdResponse)
      await backdateHeartbeat(session.id)

      const withoutFlag = await listAgents({ slug, token })
      const withoutBodyShape = Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
      })
      const withoutBody = await readNativeJson(withoutFlag, withoutBodyShape)
      expect(withoutBody.items.some((selectedItem) => selectedItem.id === session.id)).toBe(false)

      const withFlag = await listAgents({ slug, token }, { includeStale: 'true' })
      const withBodyShape = Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.String, live: Schema.Boolean })).pipe(Schema.mutable),
      })
      const withBody = await readNativeJson(withFlag, withBodyShape)
      const item = withBody.items.find((selectedItem) => selectedItem.id === session.id)
      expect(item).toBeDefined()
      expect(item?.live).toBe(false)
    })

    /* The includeStale option widens the heartbeat check on an *active* session; it must never reach
     * into ended sessions, which end_agent explicitly moves out of the pool for good. */
    test<AgentApiTestContext>('never returns an ended session, with or without includeStale', async ({
      projectFixture: { slug, token },
    }) => {
      const res = await registerAgent({ slug, token }, { name: 'ended-agent-932' })
      const session = await readNativeJson(res, IdResponse)
      await fetchNativeApi(`http://localhost/api/agents/${session.id}/end`, {
        headers: authHeaders(token, slug),
        method: 'POST',
      })

      const withoutFlag = await listAgents({ slug, token })
      const withoutBodyShape = Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
      })
      const withoutBody = await readNativeJson(withoutFlag, withoutBodyShape)
      expect(withoutBody.items.some((item) => item.id === session.id)).toBe(false)

      const withFlag = await listAgents({ slug, token }, { includeStale: 'true' })
      const withBodyShape = Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
      })
      const withBody = await readNativeJson(withFlag, withBodyShape)
      expect(withBody.items.some((item) => item.id === session.id)).toBe(false)
    })

    test<AgentApiTestContext>('a fresh session is flagged live:true', async ({ projectFixture: { slug, token } }) => {
      const res = await registerAgent({ slug, token }, { name: 'fresh-agent-932' })
      const session = await readNativeJson(res, IdResponse)

      const listRes = await listAgents({ slug, token })
      const bodyShape = Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.String, live: Schema.Boolean })).pipe(Schema.mutable),
      })
      const body = await readNativeJson(listRes, bodyShape)
      expect(body.items.find((item) => item.id === session.id)?.live).toBe(true)
    })

    test<AgentApiTestContext>("carries the linked issue's issueRef; null when unlinked", async ({
      projectFixture: { projectId, slug, token, userId, workspaceId },
    }) => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Linked' })
      const linked = await registerAgent({ slug, token }, { name: 'linked-932', issueId: issue.id })
      const linkedSession = await readNativeJson(linked, IdResponse)
      const unlinked = await registerAgent({ slug, token }, { name: 'unlinked-932' })
      const unlinkedSession = await readNativeJson(unlinked, IdResponse)

      const res = await listAgents({ slug, token })
      const bodyShape = Schema.Struct({
        items: Schema.Array(
          Schema.Struct({ id: Schema.String, issueRef: Schema.Union([Schema.String, Schema.Null]) }),
        ).pipe(Schema.mutable),
      })
      const body = await readNativeJson(res, bodyShape)
      const byId = new Map(body.items.map((item) => [item.id, item.issueRef]))
      expect(byId.get(linkedSession.id)).toBe(`${projectKey}-${issue.number}`)
      expect(byId.get(unlinkedSession.id)).toBeNull()
    })

    /*
     * The fixture project is the only one the fixture user (role: member) has a grant
     * on; a second project in the SAME workspace, also granted, proves the projectId
     * filter itself excludes the other project's sessions — not merely visibility.
     */
    test<AgentApiTestContext>("projectId filters to the granted project's sessions, excluding a second same-workspace project's (by key and uuid)", async ({
      projectFixture: { projectId, slug, token, userId, workspaceId },
    }) => {
      const otherProject = await seedProject(workspaceId, 'OTHR')
      await seedGroupGrant(workspaceId, userId, otherProject.id, 'member')

      const issueA = await seedIssue(workspaceId, projectId, userId, { title: 'In A' })
      const linkedA = await registerAgent({ slug, token }, { name: 'linked-a-932', issueId: issueA.id })
      const linkedASession = await readNativeJson(linkedA, IdResponse)

      const issueB = await seedIssue(workspaceId, otherProject.id, userId, { title: 'In B' })
      const linkedB = await registerAgent({ slug, token }, { name: 'linked-b-932', issueId: issueB.id })
      const linkedBSession = await readNativeJson(linkedB, IdResponse)

      const sessionListShape = Schema.Struct({ items: IdListResponse })
      const byKey = await listAgents({ slug, token }, { projectId: projectKey })
      const byKeyBody = await readNativeJson(byKey, sessionListShape)
      const byKeyIds = byKeyBody.items.map((item) => item.id)
      expect(byKeyIds).toContain(linkedASession.id)
      expect(byKeyIds).not.toContain(linkedBSession.id)

      const byUuid = await listAgents({ slug, token }, { projectId })
      const byUuidBody = await readNativeJson(byUuid, sessionListShape)
      const byUuidIds = byUuidBody.items.map((item) => item.id)
      expect(byUuidIds).toContain(linkedASession.id)
      expect(byUuidIds).not.toContain(linkedBSession.id)
    })

    test<AgentApiTestContext>("a member with no grant on a project gets an empty result for that project's key or uuid", async ({
      projectFixture: { slug, token, userId, workspaceId },
    }) => {
      const hidden = await seedProject(workspaceId, 'HIDN')
      // No seedGroupGrant for `userId` on `hidden` — it stays invisible to them.
      const issue = await seedIssue(workspaceId, hidden.id, userId, { title: 'Hidden' })
      await registerAgent({ slug, token }, { name: 'hidden-agent-932', issueId: issue.id })

      const byKey = await listAgents({ slug, token }, { projectId: 'HIDN' })
      const byKeyBody = await readNativeJson(byKey, ItemsResponse)
      expect(byKeyBody.items).toHaveLength(0)

      const byUuid = await listAgents({ slug, token }, { projectId: hidden.id })
      const byUuidBody = await readNativeJson(byUuid, ItemsResponse)
      expect(byUuidBody.items).toHaveLength(0)
    })
  })
})
