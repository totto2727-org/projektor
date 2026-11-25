import { assert, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ApiResults } from '#contracts/api-results.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { SQL_NULL } from '#db/sql-null.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedIssue, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { RpcTextResponse, readNativeJson } from './response-json.ts'

const [ClaimsHeatmapResponse, ContentionHeatmapResponse] = ApiResults.apiGetCodeHeatmap.members

const expectHeatmapOk = async function expectHeatmapOk(res: Response): Promise<typeof ClaimsHeatmapResponse.Type> {
  expect(res.status).toBe(200)
  return readNativeJson(res, ClaimsHeatmapResponse)
}

const expectAppsGroup = function expectAppsGroup<E extends { path: string; isLeaf: boolean }>(
  entries: Readonly<E[]>,
): E {
  const apps = entries.find((entry) => entry.path === 'apps')
  assert.isDefined(apps)
  expect(apps.isLeaf).toBe(false)
  return apps
}

describe('code heatmap (PROJ-332)', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let projectId: string
  let userId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture({ role: 'owner' }))
  })

  /*
   * Bypasses the claim_files API (which always stamps "now") so tests can place claims
   * inside/outside an arbitrary window, and the active-claim unique index (which is
   * scoped to workspace+path, not directory) is never at risk since each seeded path is
   * distinct.
   */
  const seedClaim = async function seedClaim(
    issueId: string,
    path: string,
    claimedAt: number,
    releasedAt?: number,
  ): Promise<void> {
    await env.DB.prepare(
      'INSERT INTO issue_file_claims (id, workspace_id, issue_id, agent_id, path, claimed_at, ' +
        'released_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), workspaceId, issueId, path, claimedAt, releasedAt ?? SQL_NULL)
      .run()
  }

  const seedConflict = async function seedConflict(
    rejectedIssueId: string,
    holdingIssueId: string,
    path: string,
    occurredAt: number,
    forced = 0,
  ): Promise<void> {
    await env.DB.prepare(
      'INSERT INTO claim_conflicts (id, workspace_id, path, rejected_issue_id, rejected_agent_id, ' +
        'holding_issue_id, holding_agent_id, forced, occurred_at) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?)',
    )
      .bind(crypto.randomUUID(), workspaceId, path, rejectedIssueId, holdingIssueId, forced, occurredAt)
      .run()
  }

  const getHeatmap = async function getHeatmap(params: Record<string, string> = {}): Promise<Response> {
    const qs = new URLSearchParams(params).toString()
    return fetchNativeApi(`http://localhost/api/projects/${projectId}/code-heatmap${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(token, slug),
    })
  }

  test('aggregates distinct issues per top-level directory within the window', async () => {
    const now = currentEpochSeconds()
    const apiIssue = await seedIssue(workspaceId, projectId, userId, { title: 'API work' })
    const apiIssue2 = await seedIssue(workspaceId, projectId, userId, { title: 'More API work' })
    const webIssue = await seedIssue(workspaceId, projectId, userId, { title: 'Web work' })
    const oldIssue = await seedIssue(workspaceId, projectId, userId, { title: 'Old work' })

    await seedClaim(apiIssue.id, 'apps/api/src/services/flow-metrics.ts', now - 1000)
    await seedClaim(apiIssue.id, 'apps/api/src/services/code-heatmap.ts', now - 900)
    await seedClaim(apiIssue2.id, 'apps/api/src/routes/code-heatmap.ts', now - 800)
    await seedClaim(webIssue.id, 'apps/web/src/islands/MetricsDashboard.tsx', now - 700)
    // Outside the requested window — must not count.
    await seedClaim(oldIssue.id, 'apps/api/src/routes/old.ts', now - 10 * 86_400)

    const res = await getHeatmap({ since: String(now - 3600), until: String(now) })
    const body = await expectHeatmapOk(res)

    expect(body.prefix).toBe('')
    expect(body.totalDistinctIssues).toBe(3)

    const apps = expectAppsGroup(body.entries)
    expect(apps.distinctIssueCount).toBe(3)
    expect(apps.claimCount).toBe(4)
  })

  test('drills down via prefix, one segment at a time', async () => {
    const now = currentEpochSeconds()
    const issueA = await seedIssue(workspaceId, projectId, userId, { title: 'A' })
    const issueB = await seedIssue(workspaceId, projectId, userId, { title: 'B' })

    await seedClaim(issueA.id, 'apps/api/src/services/flow-metrics.ts', now - 100)
    await seedClaim(issueB.id, 'apps/api/src/services/code-heatmap.ts', now - 90)
    await seedClaim(issueA.id, 'apps/web/src/islands/MetricsDashboard.tsx', now - 80)

    const apiRes = await getHeatmap({
      since: String(now - 3600),
      until: String(now),
      prefix: 'apps/api/src/services',
    })
    const apiBody = await expectHeatmapOk(apiRes)
    expect(apiBody.prefix).toBe('apps/api/src/services')
    const paths = apiBody.entries.map((entry) => entry.path).sort()
    expect(paths).toStrictEqual(['apps/api/src/services/code-heatmap.ts', 'apps/api/src/services/flow-metrics.ts'])
    expect(apiBody.entries.every((entry) => entry.isLeaf)).toBe(true)
    expect(apiBody.entries.every((entry) => entry.distinctIssueCount === 1)).toBe(true)
  })

  test('counts a released claim toward the aggregate (soft-release retains history)', async () => {
    const now = currentEpochSeconds()
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Released work' })
    await seedClaim(issue.id, 'apps/api/src/routes/code-heatmap.ts', now - 500, now - 100)

    const res = await getHeatmap({ since: String(now - 3600), until: String(now) })
    const body = await readNativeJson(res, ClaimsHeatmapResponse)
    expect(body.totalDistinctIssues).toBe(1)
  })

  test('treats a path claimed as both file and directory as a drillable directory', async () => {
    const now = currentEpochSeconds()
    const fileIssue = await seedIssue(workspaceId, projectId, userId, { title: 'File claim' })
    const dirIssue = await seedIssue(workspaceId, projectId, userId, { title: 'Dir claim' })
    // File claim seeded first so its isLeaf=true must not freeze the group as a leaf.
    await seedClaim(fileIssue.id, 'docs', now - 200)
    await seedClaim(dirIssue.id, 'docs/guide.md', now - 100)

    const res = await getHeatmap({ since: String(now - 3600), until: String(now) })
    const body = await readNativeJson(res, ClaimsHeatmapResponse)
    const docs = body.entries.find((entry) => entry.path === 'docs')
    expect(docs).toBeDefined()
    expect(docs?.isLeaf).toBe(false)
    expect(docs?.distinctIssueCount).toBe(2)
  })

  test('returns an empty entries array when no claims exist in the window', async () => {
    const now = currentEpochSeconds()
    const res = await getHeatmap({ since: String(now - 3600), until: String(now) })
    expect(res.status).toBe(200)
    const body = await readNativeJson(res, ClaimsHeatmapResponse)
    expect(body.entries).toStrictEqual([])
    expect(body.totalDistinctIssues).toBe(0)
  })

  test('covers MCP get_code_heatmap matches REST', async () => {
    const now = currentEpochSeconds()
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Parity check' })
    await seedClaim(issue.id, 'apps/api/src/services/code-heatmap.ts', now - 100)

    const query = `since=${now - 3600}&until=${now}`
    const restRes = await fetchNativeApi(`http://localhost/api/projects/${projectId}/code-heatmap?${query}`, {
      headers: authHeaders(token, slug),
    })
    const restBody = await restRes.json()

    const mcpRes = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: { projectId, since: now - 3600, until: now },
          name: 'get_code_heatmap',
        },
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const mcpJson = await readNativeJson(mcpRes, RpcTextResponse)
    const mcpBody = JSON.parse(mcpJson.result.content[0].text)

    expect(mcpBody).toStrictEqual(restBody)
  })

  describe('contention mode (PROJ-338)', () => {
    test('aggregates distinct rejected issues per top-level directory within the window', async () => {
      const now = currentEpochSeconds()
      const holdingIssue = await seedIssue(workspaceId, projectId, userId, { title: 'Holder' })
      const apiIssue = await seedIssue(workspaceId, projectId, userId, { title: 'API rejected' })
      const apiIssue2 = await seedIssue(workspaceId, projectId, userId, {
        title: 'More API rejected',
      })
      const webIssue = await seedIssue(workspaceId, projectId, userId, { title: 'Web rejected' })
      const oldIssue = await seedIssue(workspaceId, projectId, userId, { title: 'Old rejected' })

      await seedConflict(apiIssue.id, holdingIssue.id, 'apps/api/src/services/flow-metrics.ts', now - 1000)
      await seedConflict(apiIssue.id, holdingIssue.id, 'apps/api/src/services/code-heatmap.ts', now - 900)
      await seedConflict(apiIssue2.id, holdingIssue.id, 'apps/api/src/routes/code-heatmap.ts', now - 800)
      await seedConflict(webIssue.id, holdingIssue.id, 'apps/web/src/islands/MetricsDashboard.tsx', now - 700)
      // Outside the requested window — must not count.
      await seedConflict(oldIssue.id, holdingIssue.id, 'apps/api/src/routes/old.ts', now - 10 * 86_400)

      const res = await getHeatmap({
        since: String(now - 3600),
        until: String(now),
        mode: 'contention',
      })
      expect(res.status).toBe(200)
      const body = await readNativeJson(res, ContentionHeatmapResponse)

      expect(body.prefix).toBe('')
      expect(body.totalDistinctIssues).toBe(3)

      const apps = expectAppsGroup(body.entries)
      expect(apps.distinctRejectedIssueCount).toBe(3)
      expect(apps.conflictCount).toBe(4)
    })

    test('drills down via prefix, one segment at a time', async () => {
      const now = currentEpochSeconds()
      const holdingIssue = await seedIssue(workspaceId, projectId, userId, { title: 'Holder' })
      const issueA = await seedIssue(workspaceId, projectId, userId, { title: 'A' })
      const issueB = await seedIssue(workspaceId, projectId, userId, { title: 'B' })

      await seedConflict(issueA.id, holdingIssue.id, 'apps/api/src/services/flow-metrics.ts', now - 100)
      await seedConflict(issueB.id, holdingIssue.id, 'apps/api/src/services/code-heatmap.ts', now - 90)
      await seedConflict(issueA.id, holdingIssue.id, 'apps/web/src/islands/MetricsDashboard.tsx', now - 80)

      const apiRes = await getHeatmap({
        since: String(now - 3600),
        until: String(now),
        prefix: 'apps/api/src/services',
        mode: 'contention',
      })
      expect(apiRes.status).toBe(200)
      const apiBody = await readNativeJson(apiRes, ContentionHeatmapResponse)
      expect(apiBody.prefix).toBe('apps/api/src/services')
      const paths = apiBody.entries.map((entry) => entry.path).sort()
      expect(paths).toStrictEqual(['apps/api/src/services/code-heatmap.ts', 'apps/api/src/services/flow-metrics.ts'])
      expect(apiBody.entries.every((entry) => entry.isLeaf)).toBe(true)
      expect(apiBody.entries.every((entry) => entry.distinctRejectedIssueCount === 1)).toBe(true)
    })

    test('returns an empty entries array when no conflicts exist in the workspace', async () => {
      const now = currentEpochSeconds()
      const res = await getHeatmap({
        since: String(now - 3600),
        until: String(now),
        mode: 'contention',
      })
      expect(res.status).toBe(200)
      const body = await readNativeJson(res, ContentionHeatmapResponse)
      expect(body.entries).toStrictEqual([])
      expect(body.totalDistinctIssues).toBe(0)
    })
  })
})
