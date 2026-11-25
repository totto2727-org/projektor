import { Order } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { ApiResults } from '#contracts/api-results.ts'

import { authHeaders, seedGroupGrant, seedIssue, seedProject, seedWorkspaceRoles } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { readNativeJson } from './response-json.ts'

/*
 * PROJ-319: pin the admin-bypass path through the hand-written SQL callers of
 * visibleProjectSqlFragment (search) and the effectiveProjectRole/isWorkspaceAdmin
 * bypass used by flow-metrics, contrasted against a non-admin member who is
 * default-deny until granted.
 */

const search = async function search(
  token: string,
  slug: string,
  q: string,
): Promise<{ status: number; body: typeof ApiResults.apiSearchIssues.Type }> {
  const res = await fetchNativeApi(`http://localhost/api/issues/search?q=${encodeURIComponent(q)}`, {
    headers: authHeaders(token, slug),
  })
  return { status: res.status, body: await readNativeJson(res, ApiResults.apiSearchIssues) }
}

/* The seedIssue() helper inserts directly into `issues`, bypassing the FTS index (which is
 * populated by the create-issue service, not a DB trigger); go through the REST
 * route so search can actually find these issues. */
const createIssue = async function createIssue(
  token: string,
  slug: string,
  projectId: string,
  title: string,
): Promise<void> {
  const res = await fetchNativeApi('http://localhost/api/issues', {
    body: JSON.stringify({ projectId, title }),
    headers: authHeaders(token, slug),
    method: 'POST',
  })
  expect(res.status).toBe(201)
}

describe('covers PROJ-319 admin bypass pinning', () => {
  test("owner's search sees issues across projects they hold no group grant on", async () => {
    const roles = await seedWorkspaceRoles()
    const { slug } = roles.workspace
    const p1 = await seedProject(roles.workspace.id, 'P1')
    const p2 = await seedProject(roles.workspace.id, 'P2')
    await createIssue(roles.owner.token, slug, p1.id, 'sentinel-bypass-token')
    await createIssue(roles.owner.token, slug, p2.id, 'sentinel-bypass-token')

    const result = await search(roles.owner.token, slug, 'sentinel-bypass-token')
    expect(result.status).toBe(200)
    const compareProjectIds = Order.mapInput(Order.String, globalThis.String)
    const projectIds = result.body.map((i) => i.project_id).toSorted(compareProjectIds)
    expect(projectIds).toStrictEqual([p1.id, p2.id].toSorted(compareProjectIds))
  })

  test("owner's get_flow_metrics returns real data for an ungranted project", async () => {
    const roles = await seedWorkspaceRoles()
    const { slug } = roles.workspace
    const project = await seedProject(roles.workspace.id, 'UNGRANTED')
    await seedIssue(roles.workspace.id, project.id, roles.owner.user.id, {
      title: 'Metrics issue',
    })

    const res = await fetchNativeApi(`http://localhost/api/projects/${project.id}/flow-metrics`, {
      headers: authHeaders(roles.owner.token, slug),
    })
    expect(res.status).toBe(200)
    const metrics = await readNativeJson(res, ApiResults.apiGetFlowMetrics)
    expect(metrics.leadTime).toBeDefined()
  })

  test('a non-admin member granted only P1 sees only P1 in search (contrast)', async () => {
    const roles = await seedWorkspaceRoles()
    const { slug } = roles.workspace
    const p1 = await seedProject(roles.workspace.id, 'MP1')
    const p2 = await seedProject(roles.workspace.id, 'MP2')
    await createIssue(roles.owner.token, slug, p1.id, 'sentinel-scoped-token')
    await createIssue(roles.owner.token, slug, p2.id, 'sentinel-scoped-token')
    await seedGroupGrant(roles.workspace.id, roles.member.user.id, p1.id, 'member')

    const result = await search(roles.member.token, slug, 'sentinel-scoped-token')
    expect(result.status).toBe(200)
    expect(result.body.map((i) => i.project_id)).toStrictEqual([p1.id])
  })

  test('get_flow_metrics 404s for a non-admin member with no grant on the project', async () => {
    const roles = await seedWorkspaceRoles()
    const { slug } = roles.workspace
    const project = await seedProject(roles.workspace.id, 'MUNGRANTED')
    await seedIssue(roles.workspace.id, project.id, roles.owner.user.id, {
      title: 'Hidden metrics',
    })

    const res = await fetchNativeApi(`http://localhost/api/projects/${project.id}/flow-metrics`, {
      headers: authHeaders(roles.member.token, slug),
    })
    expect(res.status).toBe(404)
  })
})
