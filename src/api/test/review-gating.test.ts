import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  hashToken,
  seedAgentLease as seedLease,
  seedIssue,
  seedProjectFixture,
  seedTaskStatus,
} from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

/*
 * PROJ-254 gate, hardened by PROJ-287/289/292/293: the in_review report requirement is
 * bound to the issue's LIVE AGENT LEASE (an agent can't spoof it by omitting
 * agentSessionId or self-declaring kind:"human"); the done-report requirement is scoped
 * to agent-worked issues; review is keyed on any review-like status; the report is only
 * stamped on a real transition. PROJ-375 removed the old block on an agent (live lease)
 * transitioning to done — agents can close freely now; see the needsAudit tests below.
 */
describe('review gating (PROJ-254/287/289/292/293/375)', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let projectId: string
  let userId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture({ role: 'owner' }))
  })

  const seedAgentLease = async function seedAgentLease(
    workspace: string,
    issue: string,
    options?: Parameters<typeof seedLease>[2],
  ): Promise<{ agentSessionId: string; leaseId: string }> {
    const seeded = await seedLease(workspace, issue, options)
    await env.DB.prepare(`UPDATE agent_sessions SET credential_id =
      (SELECT id FROM api_tokens WHERE token_hash = ?) WHERE id = ?`)
      .bind(await hashToken(token), seeded.agentSessionId)
      .run()
    return seeded
  }

  const patch = function patch(id: string, body: Record<string, unknown>): Promise<Response> {
    return fetchNativeApi(`http://localhost/api/issues/${id}`, {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify(body),
    })
  }

  const completionReportAtOf = async function completionReportAtOf(id: string): Promise<number | null> {
    const row = await env.DB.prepare('SELECT completion_report_at FROM issues WHERE id = ?')
      .bind(id)
      .first<{ completion_report_at: number | null }>()
    return row?.completion_report_at ?? null
  }

  const needsAuditOf = async function needsAuditOf(id: string): Promise<boolean> {
    const row = await env.DB.prepare('SELECT needs_audit FROM issues WHERE id = ?')
      .bind(id)
      .first<{ needs_audit: number }>()
    return Boolean(row?.needs_audit)
  }

  const commentBodies = async function commentBodies(id: string): Promise<string[]> {
    const res = await fetchNativeApi(`http://localhost/api/issues/${id}/comments`, {
      headers: authHeaders(token, slug),
    })
    const comments = (await res.json()) as { body: string }[]
    return comments.map((comment) => comment.body)
  }

  const report = { summary: 'Did the thing', verification: 'pnpm test' }

  const seedFlaggedAndCleanDoneIssues = async function seedFlaggedAndCleanDoneIssues() {
    const flagged = await seedIssue(workspaceId, projectId, userId, { title: 'Flagged' })
    const clean = await seedIssue(workspaceId, projectId, userId, { title: 'Clean' })
    const { agentSessionId: flaggedAgent } = await seedAgentLease(workspaceId, flagged.id)
    const { agentSessionId: cleanAgent } = await seedAgentLease(workspaceId, clean.id)

    await patch(flagged.id, {
      status: 'done',
      agentSessionId: flaggedAgent,
      completionReport: report,
    })
    await patch(clean.id, {
      status: 'done',
      agentSessionId: cleanAgent,
      completionReport: {
        summary: 'Did the thing',
        verification: 'https://github.com/TAJD/projektor/pull/93',
      },
    })

    return { flagged, clean }
  }

  // --- Agent path (live agent lease present) ---

  test('rejects an agent (live lease) entering in_review without a completion report', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'No report' })
    await seedAgentLease(workspaceId, issue.id)

    const res = await patch(issue.id, { status: 'in_review' })
    expect(res.status).toBe(400)
  })

  test('accepts an agent (live lease) entering in_review with a report, and posts it', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'With report' })
    await seedAgentLease(workspaceId, issue.id)

    const res = await patch(issue.id, { status: 'in_review', completionReport: report })
    expect(res.status).toBe(200)
    await expect(completionReportAtOf(issue.id)).resolves.toEqual(expect.any(Number))
    expect((await commentBodies(issue.id)).some((b) => b.includes('Did the thing'))).toBe(true)
  })

  test('accepts a completion report with a non-URL prLink placeholder, dropping just that field', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Placeholder prLink' })
    await seedAgentLease(workspaceId, issue.id)

    const res = await patch(issue.id, {
      status: 'in_review',
      completionReport: { ...report, prLink: 'pending combined PR...' },
    })
    expect(res.status).toBe(200)
    const bodies = await commentBodies(issue.id)
    expect(bodies.some((b) => b.includes('Did the thing'))).toBe(true)
    expect(bodies.some((b) => b.includes('**PR:**'))).toBe(false)
  })

  test('still records a valid prLink URL as before', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Valid prLink' })
    await seedAgentLease(workspaceId, issue.id)

    const prLink = 'https://github.com/TAJD/projektor/pull/99'
    const res = await patch(issue.id, {
      status: 'in_review',
      completionReport: { ...report, prLink },
    })
    expect(res.status).toBe(200)
    expect((await commentBodies(issue.id)).some((b) => b.includes(prLink))).toBe(true)
  })

  test('drops a protocol-less prLink the same as any other invalid URL', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, {
      title: 'Protocol-less prLink',
    })
    await seedAgentLease(workspaceId, issue.id)

    const res = await patch(issue.id, {
      status: 'in_review',
      completionReport: { ...report, prLink: 'github.com/TAJD/projektor/pull/99' },
    })
    expect(res.status).toBe(200)
    expect((await commentBodies(issue.id)).some((b) => b.includes('**PR:**'))).toBe(false)
  })

  // --- PROJ-375: agents close to done directly, no block ---

  test('lets an agent (live lease) transition an issue directly to done', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Agent closes' })
    const { agentSessionId } = await seedAgentLease(workspaceId, issue.id)

    const res = await patch(issue.id, { status: 'done', agentSessionId, completionReport: report })
    expect(res.status).toBe(200)
  })

  test('flags an agent-initiated done closure with freeform verification as needsAudit', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Freeform close' })
    const { agentSessionId } = await seedAgentLease(workspaceId, issue.id)

    await patch(issue.id, { status: 'done', agentSessionId, completionReport: report })
    await expect(needsAuditOf(issue.id)).resolves.toBe(true)
  })

  test('does not flag an agent-initiated done closure with an externally-checkable link', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Verifiable close' })
    const { agentSessionId } = await seedAgentLease(workspaceId, issue.id)

    await patch(issue.id, {
      status: 'done',
      agentSessionId,
      completionReport: {
        summary: 'Did the thing',
        verification: 'https://github.com/TAJD/projektor/pull/93 — CI green',
      },
    })
    await expect(needsAuditOf(issue.id)).resolves.toBe(false)
  })

  test('does not flag a human-initiated done closure (no agentSessionId) even with freeform evidence', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Human closes' })
    await seedAgentLease(workspaceId, issue.id, { live: false })

    await patch(issue.id, { status: 'done', completionReport: report })
    await expect(needsAuditOf(issue.id)).resolves.toBe(false)
  })

  test('does not flag when the agentSessionId given is not a live session (accepted limitation)', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Stale session close' })
    await seedAgentLease(workspaceId, issue.id, { live: false })

    await patch(issue.id, {
      status: 'done',
      agentSessionId: crypto.randomUUID(), // never existed — can't resolve to a live session
      completionReport: report,
    })
    await expect(needsAuditOf(issue.id)).resolves.toBe(false)
  })

  test("flags needsAudit even once the agent's lease has been released before closing", async () => {
    // The exact scenario PROJ-375 was filed for: release_issue then update_issue done.
    const issue = await seedIssue(workspaceId, projectId, userId, {
      title: 'Released then closed',
    })
    const { agentSessionId } = await seedAgentLease(workspaceId, issue.id)
    await fetchNativeApi(`http://localhost/api/issues/${issue.id}/release`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ agentId: agentSessionId }),
    })

    const res = await patch(issue.id, { status: 'done', agentSessionId, completionReport: report })
    expect(res.status).toBe(200)
    await expect(needsAuditOf(issue.id)).resolves.toBe(true)
  })

  // --- Human path scoped to agent-worked issues (PROJ-289) ---

  test('lets a human close a never-agent-leased issue with no report', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Plain human close' })

    const res = await patch(issue.id, { status: 'done' })
    expect(res.status).toBe(200)
  })

  test('still requires a report to close an agent-worked issue (lease no longer live)', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Agent worked' })
    await seedAgentLease(workspaceId, issue.id, { live: false })

    const result = await patch(issue.id, { status: 'done' })
    expect(result.status).toBe(400)
    const resolvedValue = await patch(issue.id, { status: 'done', completionReport: report })
    expect(resolvedValue.status).toBe(200)
  })

  // --- Custom review status designated as a review step (PROJ-292, PROJ-749) ---

  test('gates a custom review-step status (category in_progress) the same as in_review', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Custom review' })
    await seedAgentLease(workspaceId, issue.id)
    const custom = await seedTaskStatus(workspaceId, {
      key: 'code-review',
      name: 'Code Review',
      category: 'in_progress',
      isReviewStep: true,
    })

    expect((await patch(issue.id, { statusId: custom.id })).status).toBe(400)
    expect((await patch(issue.id, { statusId: custom.id, completionReport: report })).status).toBe(200)
  })

  // --- REST/MCP parity (PROJ-301/375) ---

  test('covers MCP parity: update_issue lets an agent close directly to done and flags weak evidence', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'MCP done' })
    const { agentSessionId } = await seedAgentLease(workspaceId, issue.id)

    const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'update_issue',
          arguments: { id: issue.id, status: 'done', agentSessionId, completionReport: report },
        },
      }),
    })
    const body = (await res.json()) as { result?: unknown; error?: unknown }
    expect(body.error).toBeUndefined()
    expect(body.result).toBeDefined()
    await expect(needsAuditOf(issue.id)).resolves.toBe(true)
  })

  // --- Audit query filter (PROJ-375) ---

  test('list_issues({ needsAudit: true }) surfaces flagged closures only', async () => {
    const { flagged, clean } = await seedFlaggedAndCleanDoneIssues()

    const res = await fetchNativeApi(`http://localhost/api/issues?projectId=${projectId}&needsAudit=true`, {
      headers: authHeaders(token, slug),
    })
    const { items } = (await res.json()) as { items: { id: string }[] }
    const ids = items.map((item) => item.id)
    expect(ids).toContain(flagged.id)
    expect(ids).not.toContain(clean.id)
  })

  test('list_issues({ needsAudit: false }) surfaces unflagged closures only (PROJ-449)', async () => {
    const { flagged, clean } = await seedFlaggedAndCleanDoneIssues()

    /*
     * Z.coerce.boolean() would coerce the string "false" to true, silently
     * inverting this filter. Guards against regressing to that.
     */
    const res = await fetchNativeApi(`http://localhost/api/issues?projectId=${projectId}&needsAudit=false`, {
      headers: authHeaders(token, slug),
    })
    const { items } = (await res.json()) as { items: { id: string }[] }
    const ids = items.map((item) => item.id)
    expect(ids).toContain(clean.id)
    expect(ids).not.toContain(flagged.id)
  })

  // --- Report stamped only on a real transition (PROJ-293) ---

  test('does not stamp/post a completionReport on a title-only update', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Pre-stamp attempt' })

    const res = await patch(issue.id, { title: 'Renamed', completionReport: report })
    expect(res.status).toBe(200)
    await expect(completionReportAtOf(issue.id)).resolves.toBeNull()
    expect((await commentBodies(issue.id)).some((b) => b.includes('Did the thing'))).toBe(false)
  })

  // --- Heartbeat refresh on a live agentSessionId (PROJ-929) ---

  const heartbeatOf = async function heartbeatOf(id: string): Promise<number> {
    const row = await env.DB.prepare('SELECT last_heartbeat_at FROM agent_sessions WHERE id = ?')
      .bind(id)
      .first<{ last_heartbeat_at: number }>()
    return row!.last_heartbeat_at
  }

  test("update_issue refreshes a live agentSessionId's heartbeat, but never revives a stale one", async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Heartbeat live' })
    const { agentSessionId: live } = await seedAgentLease(workspaceId, issue.id)
    const backdated = currentEpochSeconds() - 10
    await env.DB.prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?').bind(backdated, live).run()

    const res = await patch(issue.id, { title: 'Renamed by agent', agentSessionId: live })
    expect(res.status).toBe(200)
    await expect(heartbeatOf(live)).resolves.toBeGreaterThan(backdated)

    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Heartbeat dead' })
    const { agentSessionId: dead } = await seedAgentLease(workspaceId, issue2.id, { live: false })
    const deadBefore = await heartbeatOf(dead)

    const res2 = await patch(issue2.id, { title: 'Renamed anyway', agentSessionId: dead })
    expect(res2.status).toBe(200)
    await expect(heartbeatOf(dead)).resolves.toBe(deadBefore)
  })
})
