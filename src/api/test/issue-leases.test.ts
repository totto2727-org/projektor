import { String, Predicate } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { fetchAgentWipCap } from '#commands/issue-leases.ts'
import type { ServiceCtx } from '#commands/types.ts'
import { drizzle, schema } from '#db'

import { env } from './fixture-api.ts'
import { authHeaders, seedAgentLease, seedFixture, seedIssue, seedProject, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

describe('issue leases API (PROJ-184)', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let projectId: string
  let userId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture())
  })

  const registerAgent = async function registerAgent(name: string): Promise<string> {
    const res = await fetchNativeApi('http://localhost/api/agents', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ name }),
    })
    const session = (await res.json()) as { id: string }
    return session.id
  }

  const claim = function claim(issueId: string, agentId: string): Promise<Response> {
    return fetchNativeApi(`http://localhost/api/issues/${issueId}/claim`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ agentId }),
    })
  }

  const release = function release(issueId: string, agentId?: string): Promise<Response> {
    return fetchNativeApi(`http://localhost/api/issues/${issueId}/release`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify(Predicate.isNotNullish(agentId) && String.isNonEmpty(agentId) ? { agentId } : {}),
    })
  }

  const backdateHeartbeat = function backdateHeartbeat(agentId: string, secondsAgo = 200) {
    const stale = Math.floor(Date.now() / 1000) - secondsAgo
    return env.DB.prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?').bind(stale, agentId).run()
  }

  test('claims an unleased issue', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Claim me' })
    const agent = await registerAgent('a1')

    const res = await claim(issue.id, agent)
    expect(res.status).toBe(201)
    const lease = (await res.json()) as { issueId: string; agentSessionId: string }
    expect(lease.issueId).toBe(issue.id)
    expect(lease.agentSessionId).toBe(agent)
  })

  test('rejects a second claim while the first holder is live', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Contended' })
    const a1 = await registerAgent('a1')
    const a2 = await registerAgent('a2')

    const result = await claim(issue.id, a1)
    expect(result.status).toBe(201)
    const res = await claim(issue.id, a2)
    expect(res.status).toBe(409) // ConflictError
  })

  test('reclaims a lease whose holder stopped heartbeating', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Stale holder' })
    const a1 = await registerAgent('a1')
    const a2 = await registerAgent('a2')

    const resolvedValue = await claim(issue.id, a1)
    expect(resolvedValue.status).toBe(201)
    // a1 goes dark — its session is now stale, so its lease is reclaimable.
    await backdateHeartbeat(a1)

    const res = await claim(issue.id, a2)
    expect(res.status).toBe(201)
    const lease = (await res.json()) as { agentSessionId: string }
    expect(lease.agentSessionId).toBe(a2)
  })

  test('refuses a claim from an agent that is not live', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Dead claimer' })
    const a1 = await registerAgent('a1')
    await backdateHeartbeat(a1)

    const res = await claim(issue.id, a1)
    expect(res.status).toBe(400) // ValidationError — heartbeat first
  })

  test('release frees the issue for another agent', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Release me' })
    const a1 = await registerAgent('a1')
    const a2 = await registerAgent('a2')

    expect((await claim(issue.id, a1)).status).toBe(201)
    expect((await release(issue.id)).status).toBe(200)
    // Now claimable again.
    expect((await claim(issue.id, a2)).status).toBe(201)
  })

  test('ending an agent releases its leases', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'End releases' })
    const a1 = await registerAgent('a1')
    const a2 = await registerAgent('a2')

    expect((await claim(issue.id, a1)).status).toBe(201)
    const endRes = await fetchNativeApi(`http://localhost/api/agents/${a1}/end`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(endRes.status).toBe(200)

    // a1's lease was released on end → a2 can claim.
    expect((await claim(issue.id, a2)).status).toBe(201)
  })

  test('handles GET /:id/leases lists the active lease with a live flag', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Listed' })
    const a1 = await registerAgent('a1')
    await claim(issue.id, a1)

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}/leases`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { agentSessionId: string; live: boolean }[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].agentSessionId).toBe(a1)
    expect(body.items[0].live).toBe(true)
  })

  test('workspace isolation: cannot claim an issue from another workspace', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Mine' })
    const other = await seedFixture()
    const otherAgentRes = await fetchNativeApi('http://localhost/api/agents', {
      method: 'POST',
      headers: authHeaders(other.token, other.workspace.slug),
      body: JSON.stringify({ name: 'intruder' }),
    })
    const otherAgent = (await otherAgentRes.json()) as { id: string }

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}/claim`, {
      method: 'POST',
      headers: authHeaders(other.token, other.workspace.slug),
      body: JSON.stringify({ agentId: otherAgent.id }),
    })
    expect(res.status).toBe(404) // issue not found in the intruder's workspace
  })
})

describe('get_prioritized_issues excludeClaimed (PROJ-184)', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let projectId: string
  let userId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture())
  })

  const callPrioritized = async function callPrioritized(args: Record<string, unknown>) {
    const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      method: 'POST',
      headers: { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_prioritized_issues', arguments: args },
      }),
    })
    const json = (await res.json()) as {
      result?: { content: { text: string }[] }
    }
    const text = json.result?.content?.[0]?.text ?? '{}'
    return JSON.parse(text) as { issues: { id: string }[] }
  }

  test('excludes live-leased issues only when excludeClaimed is true', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'A', priority: 'high' })
    const b = await seedIssue(workspaceId, projectId, userId, { title: 'B', priority: 'high' })

    const agentRes = await fetchNativeApi('http://localhost/api/agents', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ name: 'worker' }),
    })
    const agent = (await agentRes.json()) as { id: string }
    await fetchNativeApi(`http://localhost/api/issues/${issue.id}/claim`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ agentId: agent.id }),
    })

    const withoutFlag = await callPrioritized({ limit: 50, includeNotReady: true })
    expect(withoutFlag.issues.map((i) => i.id).sort()).toEqual([issue.id, b.id].toSorted())

    const withFlag = await callPrioritized({
      limit: 50,
      excludeClaimed: true,
      includeNotReady: true,
    })
    const ids = withFlag.issues.map((i) => i.id)
    expect(ids).toContain(b.id)
    expect(ids).not.toContain(issue.id)
  })
})

describe('claim_issue agent WIP limit (PROJ-253)', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let projectId: string
  let userId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture({ role: 'owner' }))
  })

  const registerAgent = async function registerAgent(name: string): Promise<string> {
    const res = await fetchNativeApi('http://localhost/api/agents', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ name }),
    })
    const session = (await res.json()) as { id: string }
    return session.id
  }

  const claim = function claim(issueId: string, agentId: string): Promise<Response> {
    return fetchNativeApi(`http://localhost/api/issues/${issueId}/claim`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ agentId }),
    })
  }

  /*
   * Under a WIP cap of 1: registers an agent, seeds two issues, and asserts the first
   * claim succeeds while the second is rejected as over-cap.
   */
  const expectWipCapBlocksSecondClaim = async function expectWipCapBlocksSecondClaim(): Promise<void> {
    const agent = await registerAgent('worker')
    const [first, second] = await Promise.all([
      seedIssue(workspaceId, projectId, userId, { title: 'First' }),
      seedIssue(workspaceId, projectId, userId, { title: 'Second' }),
    ])

    expect((await claim(first.id, agent)).status).toBe(201)
    const res = await claim(second.id, agent)
    expect(res.status).toBe(409)
  }

  test('blocks the 4th concurrent agent-held lease at the default cap of 3', async () => {
    const agent = await registerAgent('worker')
    const issues = await Promise.all(
      Array.from({ length: 4 }, (_value, index) =>
        seedIssue(workspaceId, projectId, userId, { title: `Issue ${index}` }),
      ),
    )

    for (const issue of issues.slice(0, 3)) {
      expect((await claim(issue.id, agent)).status).toBe(201)
    }

    const res = await claim(issues[3].id, agent)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error?: string }
    expect(JSON.stringify(body)).toMatch(/WIP limit/i)
  })

  /*
   * PROJ-624: the Nth claim (at the cap) must succeed and the (N+1)th must be
   * rejected with an error that names the actual configured cap — read from
   * fetchAgentWipCap (exported), not retyped as a literal, so the assertion
   * stays honest if DEFAULT_AGENT_WIP_LIMIT ever changes.
   */
  test('covers PROJ-624: claim at the cap succeeds; the (cap+1)th is rejected and the error names the cap', async () => {
    const orm = drizzle(env.DB, { schema })
    const cap = await fetchAgentWipCap(orm, { workspaceId } as ServiceCtx, projectId)

    const agent = await registerAgent('worker')
    const issues = await Promise.all(
      Array.from({ length: cap + 1 }, (_value, index) =>
        seedIssue(workspaceId, projectId, userId, { title: `Cap ${index}` }),
      ),
    )

    for (const issue of issues.slice(0, cap)) {
      expect((await claim(issue.id, agent)).status).toBe(201)
    }

    const res = await claim(issues[cap].id, agent)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error?: string }
    /*
     * Anchored to the phrase, not a bare `toContain(String(cap))`: the message
     * also lists `cap` held issue UUIDs, and a single digit occurs in those by
     * chance often enough that the loose form passes even if the cap is dropped.
     */
    expect(body.error).toMatch(new RegExp(`WIP limit reached \\(${cap}\\)`))
  })

  test('records a wip_cap_denials event when a claim is rejected over-cap (PROJ-342)', async () => {
    const agent = await registerAgent('worker')
    const issues = await Promise.all(
      Array.from({ length: 4 }, (_value, index) =>
        seedIssue(workspaceId, projectId, userId, { title: `Denial ${index}` }),
      ),
    )

    for (const issue of issues.slice(0, 3)) {
      expect((await claim(issue.id, agent)).status).toBe(201)
    }

    expect((await claim(issues[3].id, agent)).status).toBe(409)

    const row = await env.DB.prepare(
      'SELECT project_id, issue_id, agent_session_id FROM wip_cap_denials WHERE workspace_id = ?',
    )
      .bind(workspaceId)
      .first<{ project_id: string; issue_id: string; agent_session_id: string }>()

    expect(row).not.toBeNull()
    expect(row?.project_id).toBe(projectId)
    expect(row?.issue_id).toBe(issues[3].id)
    expect(row?.agent_session_id).toBe(agent)
  })

  test('covers TOCTOU: N concurrent claims never push a project over the cap (PROJ-290)', async () => {
    const agent = await registerAgent('worker')
    const issues = await Promise.all(
      Array.from({ length: 8 }, (_value, index) => seedIssue(workspaceId, projectId, userId, { title: `C${index}` })),
    )

    /*
     * Fire all claims at once: the read-then-insert bug let several each see cap-1
     * and all proceed. The guarded INSERT must let at most `cap` (default 3) win.
     */
    const results = await Promise.all(issues.map((iss) => claim(iss.id, agent)))
    const granted = results.filter((response) => response.status === 201).length
    expect(granted).toBeLessThanOrEqual(3)

    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM issue_leases il JOIN issues i ON i.id = il.issue_id
			 WHERE il.released_at IS NULL AND i.project_id = ?`,
    )
      .bind(projectId)
      .first<{ n: number }>()
    expect(row!.n).toBeLessThanOrEqual(3)
  })

  test("respects a project's own agent_wip_limit override", async () => {
    const patchRes = await fetchNativeApi(`http://localhost/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ agentWipLimit: 1 }),
    })
    expect(patchRes.status).toBe(200)

    await expectWipCapBlocksSecondClaim()
  })

  // --- REST/MCP parity (PROJ-301) ---

  test('covers MCP parity: update_project sets agent_wip_limit the same as REST PATCH', async () => {
    const mcpRes = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'update_project', arguments: { id: projectId, agentWipLimit: 1 } },
      }),
    })
    expect(mcpRes.status).toBe(200)

    await expectWipCapBlocksSecondClaim()
  })

  test('covers MCP parity: create_project sets agent_wip_limit the same as REST create', async () => {
    const mcpRes = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_project',
          arguments: { name: 'MCP WIP Project', key: 'MCPWIP', agentWipLimit: 1 },
        },
      }),
    })
    expect(mcpRes.status).toBe(200)
    const body = (await mcpRes.json()) as {
      result: { content: { text: string }[] }
    }
    const created = JSON.parse(body.result.content[0].text) as { id: string }

    const agent = await registerAgent('worker2')
    const [first, second] = await Promise.all([
      seedIssue(workspaceId, created.id, userId, { title: 'First' }),
      seedIssue(workspaceId, created.id, userId, { title: 'Second' }),
    ])

    expect((await claim(first.id, agent)).status).toBe(201)
    const res = await claim(second.id, agent)
    expect(res.status).toBe(409)
  })

  /*
   * PROJ-928: moving an issue to done/cancelled releases its lease (release_reason
   * "issue_closed") so a closed issue doesn't keep blocking the fleet's WIP cap on a
   * lease no one is still working.
   */
  describe('covers PROJ-928: issue close releases its lease', () => {
    const patchStatus = function patchStatus(id: string, status: string, completionReport?: object): Promise<Response> {
      return fetchNativeApi(`http://localhost/api/issues/${id}`, {
        method: 'PATCH',
        headers: authHeaders(token, slug),
        body: JSON.stringify(completionReport ? { status, completionReport } : { status }),
      })
    }
    // An issue an agent held a lease on requires a completion report to close as done.
    const REPORT = { summary: 'Done', verification: 'pnpm test' }

    test('marking a leased issue done releases its lease', async () => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Closes done' })
      const a1 = await registerAgent('a1')
      expect((await claim(issue.id, a1)).status).toBe(201)

      expect((await patchStatus(issue.id, 'done', REPORT)).status).toBe(200)

      const leases = await env.DB.prepare(
        'SELECT release_reason FROM issue_leases WHERE issue_id = ? AND released_at IS NOT NULL',
      )
        .bind(issue.id)
        .first<{ release_reason: string }>()
      expect(leases?.release_reason).toBe('issue_closed')

      // Freed for another agent to pick up (e.g. reopened and reworked).
      const a2 = await registerAgent('a2')
      expect((await claim(issue.id, a2)).status).toBe(201)
    })

    test('marking a leased issue cancelled releases its lease', async () => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Closes cancelled' })
      const a1 = await registerAgent('a1')
      expect((await claim(issue.id, a1)).status).toBe(201)

      expect((await patchStatus(issue.id, 'cancelled')).status).toBe(200)

      const a2 = await registerAgent('a2')
      expect((await claim(issue.id, a2)).status).toBe(201)
    })

    test('a non-status update of a done issue does not disturb a newer lease', async () => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Already done' })
      expect((await patchStatus(issue.id, 'done')).status).toBe(200)

      // A fresh lease claimed after the issue was already closed (e.g. reopened work).
      const a1 = await registerAgent('a1')
      expect((await claim(issue.id, a1)).status).toBe(201)

      const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
        method: 'PATCH',
        headers: authHeaders(token, slug),
        body: JSON.stringify({ title: 'Renamed' }),
      })
      expect(res.status).toBe(200)

      const leases = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM issue_leases WHERE issue_id = ? AND released_at IS NULL',
      )
        .bind(issue.id)
        .first<{ n: number }>()
      expect(leases?.n).toBe(1)
    })
  })
})

/*
 * PROJ-932: list_issue_leases defaults to live entries only (unreleased AND the holding
 * session is within the heartbeat TTL); includeStale restores the old unfiltered
 * behaviour; projectId scopes to one project (key or uuid); and every item carries
 * issueRef. Visibility (PROJ-316) is covered by coordination-access.test.ts, which
 * exercises this same query.
 */
describe('covers PROJ-932: list_issue_leases live-only default', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let projectId: string
  const projectKey = 'PROJ' // seedProject's default key
  let userId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture({
      role: 'owner',
    }))
  })

  const registerAgent = async function registerAgent(name: string): Promise<string> {
    const res = await fetchNativeApi('http://localhost/api/agents', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ name }),
    })
    const session = (await res.json()) as { id: string }
    return session.id
  }

  const claim = function claim(issueId: string, agentId: string): Promise<Response> {
    return fetchNativeApi(`http://localhost/api/issues/${issueId}/claim`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ agentId }),
    })
  }

  const backdateHeartbeat = function backdateHeartbeat(agentId: string, secondsAgo = 200) {
    const stale = Math.floor(Date.now() / 1000) - secondsAgo
    return env.DB.prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?').bind(stale, agentId).run()
  }

  const mcpLeases = async function mcpLeases(args: Record<string, unknown>) {
    const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_issue_leases', arguments: args },
      }),
    })
    const json = (await res.json()) as { result?: { content: { text: string }[] } }
    const text = json.result?.content?.[0]?.text ?? '{}'
    return JSON.parse(text) as {
      items: { id: string; issueId: string; issueRef: string; live: boolean }[]
    }
  }

  test('excludes a lease whose session has gone stale by default; includeStale:true includes it', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Stale by default' })
    const agent = await registerAgent('stale-holder')
    expect((await claim(issue.id, agent)).status).toBe(201)
    await backdateHeartbeat(agent)

    const withoutFlag = await mcpLeases({ issueId: issue.id })
    expect(withoutFlag.items).toHaveLength(0)

    const withFlag = await mcpLeases({ issueId: issue.id, includeStale: true })
    expect(withFlag.items).toHaveLength(1)
    expect(withFlag.items[0].live).toBe(false)
  })

  test('excludes a released lease regardless of includeStale', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Released' })
    const agent = await registerAgent('releaser')
    expect((await claim(issue.id, agent)).status).toBe(201)
    const response = await fetchNativeApi(`http://localhost/api/issues/${issue.id}/release`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(200)

    expect((await mcpLeases({ issueId: issue.id })).items).toHaveLength(0)
    expect((await mcpLeases({ issueId: issue.id, includeStale: true })).items).toHaveLength(0)
  })

  test("every item carries the issue's issueRef", async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Ref check' })
    const agent = await registerAgent('ref-holder')
    expect((await claim(issue.id, agent)).status).toBe(201)

    const { items } = await mcpLeases({ issueId: issue.id })
    expect(items).toHaveLength(1)
    expect(items[0].issueRef).toBe(`${projectKey}-${issue.number}`)
  })

  // projectId must exclude a lease in a SECOND project in the SAME workspace, not just a
  // lease that happens to live in another workspace (which the plain visibility filter
  // would already have excluded, passing even with the filter absent). Leases are seeded
  // directly (bypassing the register/claim API calls) to stay well under the test
  // environment's per-token rate limit (RATE_LIMIT_API_MAX=5).
  test("projectId filters to the granted project's lease, excluding a second same-workspace project's (by key and uuid)", async () => {
    const otherProject = await seedProject(workspaceId, 'OTHR')

    const issueA = await seedIssue(workspaceId, projectId, userId, { title: 'In project' })
    await seedAgentLease(workspaceId, issueA.id, { name: 'a' })

    const issueB = await seedIssue(workspaceId, otherProject.id, userId, { title: 'In other' })
    await seedAgentLease(workspaceId, issueB.id, { name: 'b' })

    const byKey = await mcpLeases({ projectId: projectKey })
    expect(byKey.items.map((item) => item.issueId)).toEqual([issueA.id])

    const byUuid = await mcpLeases({ projectId })
    expect(byUuid.items.map((item) => item.issueId)).toEqual([issueA.id])
  })

  test('covers REST parity: GET /api/issues/:id/leases accepts includeStale', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'REST parity' })
    const agent = await registerAgent('rest-holder')
    expect((await claim(issue.id, agent)).status).toBe(201)
    await backdateHeartbeat(agent)

    const defaultRes = await fetchNativeApi(`http://localhost/api/issues/${issue.id}/leases`, {
      headers: authHeaders(token, slug),
    })
    const defaultBody = (await defaultRes.json()) as { items: unknown[] }
    expect(defaultBody.items).toHaveLength(0)

    const staleRes = await fetchNativeApi(`http://localhost/api/issues/${issue.id}/leases?includeStale=true`, {
      headers: authHeaders(token, slug),
    })
    const staleBody = (await staleRes.json()) as { items: unknown[] }
    expect(staleBody.items).toHaveLength(1)
  })

  /*
   * PROJ-932: GET /api/issue-leases is the workspace-wide REST twin of MCP's
   * list_issue_leases (matching /api/file-claims and /api/agents), distinct from the
   * single-issue GET /api/issues/:id/leases tested above. The lease is seeded directly
   * (bypassing register/claim API calls) so the five GET calls below stay within the
   * test environment's per-token rate limit (RATE_LIMIT_API_MAX=5).
   */
  test('covers REST parity: GET /api/issue-leases accepts issueId, agentId, projectId and includeStale', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Workspace-wide REST' })
    const { agentSessionId: agent } = await seedAgentLease(workspaceId, issue.id, {
      name: 'workspace-rest-holder',
    })

    const byIssue = await fetchNativeApi(`http://localhost/api/issue-leases?issueId=${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    expect(byIssue.status).toBe(200)
    const byIssueBody = (await byIssue.json()) as {
      items: { id: string; issueId: string; agentSessionId: string; issueRef: string }[]
    }
    expect(byIssueBody.items).toHaveLength(1)
    expect(byIssueBody.items[0].issueId).toBe(issue.id)
    expect(byIssueBody.items[0].issueRef).toBe(`${projectKey}-${issue.number}`)

    const byAgent = await fetchNativeApi(`http://localhost/api/issue-leases?agentId=${agent}`, {
      headers: authHeaders(token, slug),
    })
    const byAgentBody = (await byAgent.json()) as { items: { agentSessionId: string }[] }
    expect(byAgentBody.items.some((item) => item.agentSessionId === agent)).toBe(true)

    const byProjectKey = await fetchNativeApi(`http://localhost/api/issue-leases?projectId=${projectKey}`, {
      headers: authHeaders(token, slug),
    })
    const byProjectKeyBody = (await byProjectKey.json()) as { items: { issueId: string }[] }
    expect(byProjectKeyBody.items.some((item) => item.issueId === issue.id)).toBe(true)

    await backdateHeartbeat(agent)
    const defaultRes = await fetchNativeApi('http://localhost/api/issue-leases', {
      headers: authHeaders(token, slug),
    })
    const defaultBody = (await defaultRes.json()) as { items: { issueId: string }[] }
    expect(defaultBody.items.some((item) => item.issueId === issue.id)).toBe(false)

    const staleRes = await fetchNativeApi('http://localhost/api/issue-leases?includeStale=true', {
      headers: authHeaders(token, slug),
    })
    const staleBody = (await staleRes.json()) as {
      items: { issueId: string; live: boolean }[]
    }
    const staleItem = staleBody.items.find((item) => item.issueId === issue.id)
    expect(staleItem).toBeDefined()
    expect(staleItem?.live).toBe(false)
  })
})

/*
 * PROJ-932: a member without a group grant on a project must get an empty result for
 * that project's key or uuid — not just fewer results, none at all — proving the
 * projectId filter composes with (rather than bypasses) PROJ-316 visibility.
 */
describe('covers PROJ-932: list_issue_leases projectId + visibility for a non-admin member', () => {
  test("a hidden project's key or uuid returns no leases", async () => {
    const { token, slug, workspaceId, userId } = await seedProjectFixture({
      role: 'member',
    })
    const hidden = await seedProject(workspaceId, 'HIDN')
    // No seedGroupGrant for `userId` on `hidden` — it stays invisible to them.
    const hiddenIssue = await seedIssue(workspaceId, hidden.id, userId, { title: 'Hidden' })

    const agentRes = await fetchNativeApi('http://localhost/api/agents', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ name: 'hidden-holder' }),
    })
    const agent = (await agentRes.json()) as { id: string }
    /*
     * Claiming from an owner-equivalent path isn't needed — seed the lease directly so
     * this test isn't gated on claim_issue's own access rules.
     */
    const now = Math.floor(Date.now() / 1000)
    await env.DB.prepare(
      `INSERT INTO issue_leases (id, workspace_id, issue_id, agent_session_id, claimed_at, released_at, release_reason)
			 VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
    )
      .bind(crypto.randomUUID(), workspaceId, hiddenIssue.id, agent.id, now)
      .run()

    const mcpLeases = async function mcpLeases(args: Record<string, unknown>) {
      const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
        method: 'POST',
        headers: authHeaders(token, slug),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_issue_leases', arguments: args },
        }),
      })
      const json = (await res.json()) as { result?: { content: { text: string }[] } }
      const text = json.result?.content?.[0]?.text ?? '{}'
      return JSON.parse(text) as { items: unknown[] }
    }

    expect((await mcpLeases({ projectId: 'HIDN' })).items).toHaveLength(0)
    expect((await mcpLeases({ projectId: hidden.id })).items).toHaveLength(0)
  })
})
