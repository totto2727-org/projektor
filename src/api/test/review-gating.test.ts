import { Schema } from 'effect'
import { assert, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
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
import { readNativeJson } from './response-json.ts'

type ReviewFixture = Awaited<ReturnType<typeof seedProjectFixture>>
type ReviewLeaseFixture = Pick<ReviewFixture, 'token' | 'workspaceId'>
type ReviewRequestAuth = Pick<ReviewFixture, 'slug' | 'token'>

interface ReviewGatingTestContext {
  projectFixture: ReviewFixture
}

const seedAgentLease = async function seedAgentLease(
  { token, workspaceId: workspace }: ReviewLeaseFixture,
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

const patch = function patch(
  { slug, token }: ReviewRequestAuth,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetchNativeApi(`http://localhost/api/issues/${id}`, {
    body: JSON.stringify(body),
    headers: authHeaders(token, slug),
    method: 'PATCH',
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

const commentBodies = async function commentBodies({ slug, token }: ReviewRequestAuth, id: string): Promise<string[]> {
  const res = await fetchNativeApi(`http://localhost/api/issues/${id}/comments`, {
    headers: authHeaders(token, slug),
  })
  const comments = await readNativeJson(res, Schema.Array(Schema.Struct({ body: Schema.String })).pipe(Schema.mutable))
  return comments.map((comment) => comment.body)
}

const report = { summary: 'Did the thing', verification: 'pnpm test' }

const seedFlaggedAndCleanDoneIssues = async function seedFlaggedAndCleanDoneIssues({
  projectId,
  slug,
  token,
  userId,
  workspaceId,
}: ReviewFixture) {
  const flagged = await seedIssue(workspaceId, projectId, userId, { title: 'Flagged' })
  const clean = await seedIssue(workspaceId, projectId, userId, { title: 'Clean' })
  const { agentSessionId: flaggedAgent } = await seedAgentLease({ token, workspaceId }, flagged.id)
  const { agentSessionId: cleanAgent } = await seedAgentLease({ token, workspaceId }, clean.id)

  await patch(
    { slug, token },
    flagged.id,
    fieldsInOrder([
      ['status', 'done'],
      ['agentSessionId', flaggedAgent],
      ['completionReport', report],
    ]),
  )
  await patch(
    { slug, token },
    clean.id,
    fieldsInOrder([
      ['status', 'done'],
      ['agentSessionId', cleanAgent],
      [
        'completionReport',
        {
          summary: 'Did the thing',
          verification: 'https://github.com/TAJD/projektor/pull/93',
        },
      ],
    ]),
  )

  return { flagged, clean }
}

const heartbeatOf = async function heartbeatOf(id: string): Promise<number> {
  const row = await env.DB.prepare('SELECT last_heartbeat_at FROM agent_sessions WHERE id = ?')
    .bind(id)
    .first<{ last_heartbeat_at: number }>()
  assert.exists(row)
  return row.last_heartbeat_at
}

/*
 * PROJ-254 gate, hardened by PROJ-287/289/292/293: the in_review report requirement is
 * bound to the issue's LIVE AGENT LEASE (an agent can't spoof it by omitting
 * agentSessionId or self-declaring kind:"human"); the done-report requirement is scoped
 * to agent-worked issues; review is keyed on any review-like status; the report is only
 * stamped on a real transition. PROJ-375 removed the old block on an agent (live lease)
 * transitioning to done — agents can close freely now; see the needsAudit tests below.
 */
describe('review gating (PROJ-254/287/289/292/293/375)', () => {
  beforeEach<ReviewGatingTestContext>(async (context) => {
    context.projectFixture = await seedProjectFixture({ role: 'owner' })
  })

  // --- Agent path (live agent lease present) ---

  test<ReviewGatingTestContext>('rejects an agent (live lease) entering in_review without a completion report', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'No report' })
    await seedAgentLease({ token, workspaceId }, issue.id)

    const res = await patch({ slug, token }, issue.id, { status: 'in_review' })
    expect(res.status).toBe(400)
  })

  test<ReviewGatingTestContext>('accepts an agent (live lease) entering in_review with a report, and posts it', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'With report' })
    await seedAgentLease({ token, workspaceId }, issue.id)

    const res = await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['status', 'in_review'],
        ['completionReport', report],
      ]),
    )
    expect(res.status).toBe(200)
    await expect(completionReportAtOf(issue.id)).resolves.toStrictEqual(expect.any(Number))
    const result = await commentBodies({ slug, token }, issue.id)
    expect(result.some((body) => body.includes('Did the thing'))).toBe(true)
  })

  test<ReviewGatingTestContext>('accepts a completion report with a non-URL prLink placeholder, dropping just that field', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Placeholder prLink' })
    await seedAgentLease({ token, workspaceId }, issue.id)

    const res = await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['status', 'in_review'],
        ['completionReport', { ...report, prLink: 'pending combined PR...' }],
      ]),
    )
    expect(res.status).toBe(200)
    const bodies = await commentBodies({ slug, token }, issue.id)
    expect(bodies.some((body) => body.includes('Did the thing'))).toBe(true)
    expect(bodies.some((body) => body.includes('**PR:**'))).toBe(false)
  })

  test<ReviewGatingTestContext>('still records a valid prLink URL as before', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Valid prLink' })
    await seedAgentLease({ token, workspaceId }, issue.id)

    const prLink = 'https://github.com/TAJD/projektor/pull/99'
    const res = await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['status', 'in_review'],
        ['completionReport', { ...report, prLink }],
      ]),
    )
    expect(res.status).toBe(200)
    const result = await commentBodies({ slug, token }, issue.id)
    expect(result.some((body) => body.includes(prLink))).toBe(true)
  })

  test<ReviewGatingTestContext>('drops a protocol-less prLink the same as any other invalid URL', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, {
      title: 'Protocol-less prLink',
    })
    await seedAgentLease({ token, workspaceId }, issue.id)

    const res = await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['status', 'in_review'],
        ['completionReport', { ...report, prLink: 'github.com/TAJD/projektor/pull/99' }],
      ]),
    )
    expect(res.status).toBe(200)
    const result = await commentBodies({ slug, token }, issue.id)
    expect(result.some((body) => body.includes('**PR:**'))).toBe(false)
  })

  // --- PROJ-375: agents close to done directly, no block ---

  test<ReviewGatingTestContext>('lets an agent (live lease) transition an issue directly to done', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Agent closes' })
    const { agentSessionId } = await seedAgentLease({ token, workspaceId }, issue.id)

    const res = await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['status', 'done'],
        ['agentSessionId', agentSessionId],
        ['completionReport', report],
      ]),
    )
    expect(res.status).toBe(200)
  })

  test<ReviewGatingTestContext>('flags an agent-initiated done closure with freeform verification as needsAudit', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Freeform close' })
    const { agentSessionId } = await seedAgentLease({ token, workspaceId }, issue.id)

    await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['status', 'done'],
        ['agentSessionId', agentSessionId],
        ['completionReport', report],
      ]),
    )
    await expect(needsAuditOf(issue.id)).resolves.toBe(true)
  })

  test<ReviewGatingTestContext>('does not flag an agent-initiated done closure with an externally-checkable link', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Verifiable close' })
    const { agentSessionId } = await seedAgentLease({ token, workspaceId }, issue.id)

    await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['status', 'done'],
        ['agentSessionId', agentSessionId],
        [
          'completionReport',
          {
            summary: 'Did the thing',
            verification: 'https://github.com/TAJD/projektor/pull/93 — CI green',
          },
        ],
      ]),
    )
    await expect(needsAuditOf(issue.id)).resolves.toBe(false)
  })

  test<ReviewGatingTestContext>('does not flag a human-initiated done closure (no agentSessionId) even with freeform evidence', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Human closes' })
    await seedAgentLease({ token, workspaceId }, issue.id, { live: false })

    await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['status', 'done'],
        ['completionReport', report],
      ]),
    )
    await expect(needsAuditOf(issue.id)).resolves.toBe(false)
  })

  test<ReviewGatingTestContext>('does not flag when the agentSessionId given is not a live session (accepted limitation)', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Stale session close' })
    await seedAgentLease({ token, workspaceId }, issue.id, { live: false })

    await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['status', 'done'],
        // Never existed — can't resolve to a live session
        ['agentSessionId', crypto.randomUUID()],
        ['completionReport', report],
      ]),
    )
    await expect(needsAuditOf(issue.id)).resolves.toBe(false)
  })

  test<ReviewGatingTestContext>("flags needsAudit even once the agent's lease has been released before closing", async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    // The exact scenario PROJ-375 was filed for: release_issue then update_issue done.
    const issue = await seedIssue(workspaceId, projectId, userId, {
      title: 'Released then closed',
    })
    const { agentSessionId } = await seedAgentLease({ token, workspaceId }, issue.id)
    await fetchNativeApi(`http://localhost/api/issues/${issue.id}/release`, {
      body: JSON.stringify({ agentId: agentSessionId }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['status', 'done'],
        ['agentSessionId', agentSessionId],
        ['completionReport', report],
      ]),
    )
    expect(res.status).toBe(200)
    await expect(needsAuditOf(issue.id)).resolves.toBe(true)
  })

  // --- Human path scoped to agent-worked issues (PROJ-289) ---

  test<ReviewGatingTestContext>('lets a human close a never-agent-leased issue with no report', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Plain human close' })

    const res = await patch({ slug, token }, issue.id, { status: 'done' })
    expect(res.status).toBe(200)
  })

  test<ReviewGatingTestContext>('still requires a report to close an agent-worked issue (lease no longer live)', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Agent worked' })
    await seedAgentLease({ token, workspaceId }, issue.id, { live: false })

    const result = await patch({ slug, token }, issue.id, { status: 'done' })
    expect(result.status).toBe(400)
    const resolvedValue = await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['status', 'done'],
        ['completionReport', report],
      ]),
    )
    expect(resolvedValue.status).toBe(200)
  })

  // --- Custom review status designated as a review step (PROJ-292, PROJ-749) ---

  test<ReviewGatingTestContext>('gates a custom review-step status (category in_progress) the same as in_review', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Custom review' })
    await seedAgentLease({ token, workspaceId }, issue.id)
    const custom = await seedTaskStatus(workspaceId, {
      category: 'in_progress',
      isReviewStep: true,
      key: 'code-review',
      name: 'Code Review',
    })

    const response = await patch({ slug, token }, issue.id, { statusId: custom.id })
    expect(response.status).toBe(400)
    const apiResponse = await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['statusId', custom.id],
        ['completionReport', report],
      ]),
    )
    expect(apiResponse.status).toBe(200)
  })

  // --- REST/MCP parity (PROJ-301/375) ---

  test<ReviewGatingTestContext>('covers MCP parity: update_issue lets an agent close directly to done and flags weak evidence', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'MCP done' })
    const { agentSessionId } = await seedAgentLease({ token, workspaceId }, issue.id)

    const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: { id: issue.id, status: 'done', agentSessionId, completionReport: report },
          name: 'update_issue',
        },
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const body = await readNativeJson(
      res,
      Schema.Struct({ error: Schema.optional(Schema.Unknown), result: Schema.optional(Schema.Unknown) }),
    )
    expect(body.error).toBeUndefined()
    expect(body.result).toBeDefined()
    await expect(needsAuditOf(issue.id)).resolves.toBe(true)
  })

  // --- Audit query filter (PROJ-375) ---

  test<ReviewGatingTestContext>('list_issues({ needsAudit: true }) surfaces flagged closures only', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const { flagged, clean } = await seedFlaggedAndCleanDoneIssues({ projectId, slug, token, userId, workspaceId })

    const res = await fetchNativeApi(`http://localhost/api/issues?projectId=${projectId}&needsAudit=true`, {
      headers: authHeaders(token, slug),
    })
    const resShape = Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable) })
    const { items } = await readNativeJson(res, resShape)
    const ids = items.map((item) => item.id)
    expect(ids).toContain(flagged.id)
    expect(ids).not.toContain(clean.id)
  })

  test<ReviewGatingTestContext>('list_issues({ needsAudit: false }) surfaces unflagged closures only (PROJ-449)', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const { flagged, clean } = await seedFlaggedAndCleanDoneIssues({ projectId, slug, token, userId, workspaceId })

    /*
     * Z.coerce.boolean() would coerce the string "false" to true, silently
     * inverting this filter. Guards against regressing to that.
     */
    const res = await fetchNativeApi(`http://localhost/api/issues?projectId=${projectId}&needsAudit=false`, {
      headers: authHeaders(token, slug),
    })
    const resShape = Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable) })
    const { items } = await readNativeJson(res, resShape)
    const ids = items.map((item) => item.id)
    expect(ids).toContain(clean.id)
    expect(ids).not.toContain(flagged.id)
  })

  // --- Report stamped only on a real transition (PROJ-293) ---

  test<ReviewGatingTestContext>('does not stamp/post a completionReport on a title-only update', async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Pre-stamp attempt' })

    const res = await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['title', 'Renamed'],
        ['completionReport', report],
      ]),
    )
    expect(res.status).toBe(200)
    await expect(completionReportAtOf(issue.id)).resolves.toBeNull()
    const result = await commentBodies({ slug, token }, issue.id)
    expect(result.some((body) => body.includes('Did the thing'))).toBe(false)
  })

  // --- Heartbeat refresh on a live agentSessionId (PROJ-929) ---

  test<ReviewGatingTestContext>("update_issue refreshes a live agentSessionId's heartbeat, but never revives a stale one", async ({
    projectFixture: { projectId, slug, token, userId, workspaceId },
  }) => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Heartbeat live' })
    const { agentSessionId: live } = await seedAgentLease({ token, workspaceId }, issue.id)
    const backdated = currentEpochSeconds() - 10
    await env.DB.prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?').bind(backdated, live).run()

    const res = await patch(
      { slug, token },
      issue.id,
      fieldsInOrder([
        ['title', 'Renamed by agent'],
        ['agentSessionId', live],
      ]),
    )
    expect(res.status).toBe(200)
    await expect(heartbeatOf(live)).resolves.toBeGreaterThan(backdated)

    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Heartbeat dead' })
    const { agentSessionId: dead } = await seedAgentLease({ token, workspaceId }, issue2.id, { live: false })
    const deadBefore = await heartbeatOf(dead)

    const res2 = await patch(
      { slug, token },
      issue2.id,
      fieldsInOrder([
        ['title', 'Renamed anyway'],
        ['agentSessionId', dead],
      ]),
    )
    expect(res2.status).toBe(200)
    await expect(heartbeatOf(dead)).resolves.toBe(deadBefore)
  })
})
