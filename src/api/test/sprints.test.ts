import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  seedFixture,
  seedGroupGrant,
  seedIssue,
  seedProject,
  seedProjectFixture,
  seedWorkspaceRoles,
} from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

/*
 * PROJ-311: role-guard tests grant the member a member-role and the viewer a
 * viewer-role on the project so both can see it — the assertions then verify the
 * viewer's writes are still refused (read-only), not merely hidden.
 */

describe('sprints API', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let projectId: string
  let userId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture())
  })

  const createSprint = async function createSprint(body: Record<string, unknown>): Promise<Response> {
    return fetchNativeApi('http://localhost/api/sprints', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify(body),
    })
  }

  test('handles POST /api/sprints creates a sprint', async () => {
    const res = await createSprint({ projectId, name: 'Sprint 1' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBeTruthy()
  })

  test('handles GET /api/sprints?projectId= returns empty list initially', async () => {
    const res = await fetchNativeApi(`http://localhost/api/sprints?projectId=${projectId}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[] }
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items).toHaveLength(0)
  })

  test('handles POST then GET lists the sprint', async () => {
    await createSprint({ projectId, name: 'Sprint 1', goal: 'Ship the feature' })

    const res = await fetchNativeApi(`http://localhost/api/sprints?projectId=${projectId}`, {
      headers: authHeaders(token, slug),
    })
    const body = (await res.json()) as { items: Record<string, unknown>[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].name).toBe('Sprint 1')
    expect(body.items[0].goal).toBe('Ship the feature')
    expect(body.items[0].status).toBe('planned')
  })

  test('handles GET /api/sprints/:id returns the sprint', async () => {
    const createRes = await createSprint({ projectId, name: 'Sprint 2' })
    const { id } = (await createRes.json()) as { id: string }

    const res = await fetchNativeApi(`http://localhost/api/sprints/${id}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const sprint = (await res.json()) as { name: string; status: string }
    expect(sprint.name).toBe('Sprint 2')
    expect(sprint.status).toBe('planned')
  })

  test('handles GET /api/sprints/:id returns 404 for unknown id', async () => {
    const res = await fetchNativeApi(`http://localhost/api/sprints/${crypto.randomUUID()}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(404)
  })

  test('handles PATCH /api/sprints/:id updates sprint fields', async () => {
    const createRes = await createSprint({ projectId, name: 'Draft Sprint' })
    const { id } = (await createRes.json()) as { id: string }

    const patchRes = await fetchNativeApi(`http://localhost/api/sprints/${id}`, {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ name: 'Sprint 1', status: 'active', goal: 'Updated goal' }),
    })
    expect(patchRes.status).toBe(200)

    const getRes = await fetchNativeApi(`http://localhost/api/sprints/${id}`, {
      headers: authHeaders(token, slug),
    })
    const sprint = (await getRes.json()) as { name: string; status: string; goal: string }
    expect(sprint.name).toBe('Sprint 1')
    expect(sprint.status).toBe('active')
    expect(sprint.goal).toBe('Updated goal')
  })

  test('handles POST /api/sprints/:id/complete marks active sprint completed', async () => {
    const createRes = await createSprint({ projectId, name: 'Active Sprint' })
    const { id } = (await createRes.json()) as { id: string }

    // First make it active
    await fetchNativeApi(`http://localhost/api/sprints/${id}`, {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ status: 'active' }),
    })

    const completeRes = await fetchNativeApi(`http://localhost/api/sprints/${id}/complete`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(completeRes.status).toBe(200)

    const getRes = await fetchNativeApi(`http://localhost/api/sprints/${id}`, {
      headers: authHeaders(token, slug),
    })
    const sprint = (await getRes.json()) as { status: string }
    expect(sprint.status).toBe('completed')
  })

  test('handles POST /api/sprints/:id/complete rejects planned sprint', async () => {
    const createRes = await createSprint({ projectId, name: 'Planned Sprint' })
    const { id } = (await createRes.json()) as { id: string }

    const completeRes = await fetchNativeApi(`http://localhost/api/sprints/${id}/complete`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(completeRes.status).toBe(400)
  })

  test('handles DELETE /api/sprints/:id removes the sprint', async () => {
    const createRes = await createSprint({ projectId, name: 'To delete' })
    const { id } = (await createRes.json()) as { id: string }

    const deleteRes = await fetchNativeApi(`http://localhost/api/sprints/${id}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)

    const getRes = await fetchNativeApi(`http://localhost/api/sprints/${id}`, {
      headers: authHeaders(token, slug),
    })
    expect(getRes.status).toBe(404)
  })

  test('handles POST /api/sprints/:id/move-issues bulk moves issues to sprint', async () => {
    const sprintRes = await createSprint({ projectId, name: 'Target Sprint' })
    const { id: sprintId } = (await sprintRes.json()) as { id: string }

    const issue1 = await seedIssue(workspaceId, projectId, userId, { title: 'Issue A' })
    const issue2 = await seedIssue(workspaceId, projectId, userId, { title: 'Issue B' })

    const moveRes = await fetchNativeApi(`http://localhost/api/sprints/${sprintId}/move-issues`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ issueIds: [issue1.id, issue2.id] }),
    })
    expect(moveRes.status).toBe(200)
    const result = (await moveRes.json()) as { ok: boolean; count: number }
    expect(result.ok).toBe(true)
    expect(result.count).toBe(2)

    // Verify issues now appear in sprint filter
    const listRes = await fetchNativeApi(`http://localhost/api/issues?sprintId=${sprintId}`, {
      headers: authHeaders(token, slug),
    })
    const page = (await listRes.json()) as { items: { title: string }[] }
    expect(page.items).toHaveLength(2)
    const titles = page.items.map((i) => i.title).sort()
    expect(titles).toEqual(['Issue A', 'Issue B'])
  })

  test('handles DELETE sprint clears sprint_id on issues (ON DELETE SET NULL)', async () => {
    const sprintRes = await createSprint({ projectId, name: 'Sprint to delete' })
    const { id: sprintId } = (await sprintRes.json()) as { id: string }

    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Sprint issue' })

    await fetchNativeApi(`http://localhost/api/sprints/${sprintId}/move-issues`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ issueIds: [issue.id] }),
    })

    await fetchNativeApi(`http://localhost/api/sprints/${sprintId}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })

    // Issue should still exist but sprint_id should be null
    const issueRes = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    expect(issueRes.status).toBe(200)
    const issueData = (await issueRes.json()) as { sprint_id: string | null }
    expect(issueData.sprint_id).toBeNull()
  })

  test('covers PROJ-356: move-issues invalidates the issue KV cache — an immediate GET reflects the new sprint_id', async () => {
    const sprintRes = await createSprint({ projectId, name: 'Cache Target Sprint' })
    const { id: sprintId } = (await sprintRes.json()) as { id: string }

    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Cache issue' })

    // Warm the issue KV cache with the pre-move (sprint_id: null) shape.
    const before = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const beforeBody = (await before.json()) as { sprint_id: string | null }
    expect(beforeBody.sprint_id).toBeNull()

    const moveRes = await fetchNativeApi(`http://localhost/api/sprints/${sprintId}/move-issues`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ issueIds: [issue.id] }),
    })
    expect(moveRes.status).toBe(200)

    // Immediately after — must not be served from the pre-move cache entry.
    const after = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const afterBody = (await after.json()) as { sprint_id: string | null }
    expect(afterBody.sprint_id).toBe(sprintId)
  })

  test('handles POST /api/sprints/:id/move-issues returns 404 for unknown sprint', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Orphan issue' })

    const res = await fetchNativeApi(`http://localhost/api/sprints/${crypto.randomUUID()}/move-issues`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ issueIds: [issue.id] }),
    })
    expect(res.status).toBe(404)
  })

  /*
   * PROJ-871: moving up to 500 issues used to fire one KV `invalidate` (a subrequest) per
   * issue — 500 subrequests, 10x the free-plan cap. PROJ-863 already narrowed the per-issue
   * KV cache to rollup/customFields only (sprint_id is read live from the row on every
   * getIssue/listIssues), so that invalidation loop was invalidating a field the cache
   * doesn't hold — it's deleted outright rather than chunked/deferred.
   */
  describe('covers PROJ-871: moving many issues stays within the KV subrequest budget', () => {
    const prevApiMax = env.RATE_LIMIT_API_MAX
    beforeAll(() => {
      env.RATE_LIMIT_API_MAX = '1000'
    })
    afterAll(() => {
      env.RATE_LIMIT_API_MAX = prevApiMax
    })

    test('moving 500 issues succeeds within <=50 KV deletes, and a subsequent GET shows the new sprint', async () => {
      const sprintRes = await createSprint({ projectId, name: 'Bulk Target Sprint' })
      const { id: sprintId } = (await sprintRes.json()) as { id: string }

      const issueIds: string[] = []
      for (let index = 0; index < 500; index++) {
        const issue = await seedIssue(workspaceId, projectId, userId, { title: `Bulk ${index}` })
        issueIds.push(issue.id)
      }

      /*
       * Warm the per-issue KV cache first, so the GET after the move proves sprint_id
       * isn't served stale from it (it's read live from the row; the cache only holds
       * rollup/customFields).
       */
      const warmRes = await fetchNativeApi(`http://localhost/api/issues/${issueIds[0]}`, {
        headers: authHeaders(token, slug),
      })
      expect(warmRes.status).toBe(200)
      expect(((await warmRes.json()) as { sprint_id: string | null }).sprint_id).toBeNull()
      await expect(env.KV.get(`issue:${workspaceId}:${issueIds[0]}`)).resolves.not.toBeNull()

      let kvDeletes = 0
      const origDelete = env.KV.delete.bind(env.KV)
      vi.spyOn(env.KV, 'delete').mockImplementation((...args: Parameters<typeof origDelete>) => {
        kvDeletes++
        return origDelete(...args)
      })

      const moveRes = await fetchNativeApi(`http://localhost/api/sprints/${sprintId}/move-issues`, {
        method: 'POST',
        headers: authHeaders(token, slug),
        body: JSON.stringify({ issueIds }),
      })
      vi.restoreAllMocks()

      expect(moveRes.status).toBe(200)
      const result = (await moveRes.json()) as { ok: boolean; count: number }
      expect(result.ok).toBe(true)
      expect(result.count).toBe(500)
      expect(kvDeletes).toBeLessThanOrEqual(50)

      /*
       * The cache entry is still there (nothing invalidated it), yet the GET shows the
       * new sprint.
       */
      await expect(env.KV.get(`issue:${workspaceId}:${issueIds[0]}`)).resolves.not.toBeNull()
      const getRes = await fetchNativeApi(`http://localhost/api/issues/${issueIds[0]}`, {
        headers: authHeaders(token, slug),
      })
      expect(getRes.status).toBe(200)
      const body = (await getRes.json()) as { sprint_id: string | null }
      expect(body.sprint_id).toBe(sprintId)
    })
  })

  test('lists multiple sprints ordered by created_at', async () => {
    await createSprint({ projectId, name: 'First Sprint' })
    await createSprint({ projectId, name: 'Second Sprint' })
    await createSprint({ projectId, name: 'Third Sprint' })

    const res = await fetchNativeApi(`http://localhost/api/sprints?projectId=${projectId}`, {
      headers: authHeaders(token, slug),
    })
    const body = (await res.json()) as { items: { name: string }[] }
    expect(body.items).toHaveLength(3)
    expect(body.items[0].name).toBe('First Sprint')
    expect(body.items[2].name).toBe('Third Sprint')
  })

  test('sprints are scoped to workspace — cross-workspace sprint not visible', async () => {
    const other = await seedFixture()
    const otherProject = await seedProject(other.workspace.id, 'OTH')

    // Create sprint in other workspace
    await fetchNativeApi('http://localhost/api/sprints', {
      method: 'POST',
      headers: authHeaders(other.token, other.workspace.slug),
      body: JSON.stringify({ projectId: otherProject.id, name: 'Other Workspace Sprint' }),
    })

    // Our workspace sees none
    const res = await fetchNativeApi(`http://localhost/api/sprints?projectId=${projectId}`, {
      headers: authHeaders(token, slug),
    })
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toHaveLength(0)
  })
})

describe('sprints role guards', () => {
  test('viewer cannot create a sprint (403)', async () => {
    const roles = await seedWorkspaceRoles()
    const project = await seedProject(roles.workspace.id)
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, project.id, 'viewer')

    const res = await fetchNativeApi('http://localhost/api/sprints', {
      method: 'POST',
      headers: authHeaders(roles.viewer.token, roles.workspace.slug),
      body: JSON.stringify({ projectId: project.id, name: 'Viewer Sprint' }),
    })
    expect(res.status).toBe(403)
  })

  const seedMemberSprintWithViewer = async function seedMemberSprintWithViewer(sprintName: string) {
    const roles = await seedWorkspaceRoles()
    const project = await seedProject(roles.workspace.id)
    await seedGroupGrant(roles.workspace.id, roles.member.user.id, project.id, 'member')
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, project.id, 'viewer')

    const createRes = await fetchNativeApi('http://localhost/api/sprints', {
      method: 'POST',
      headers: authHeaders(roles.member.token, roles.workspace.slug),
      body: JSON.stringify({ projectId: project.id, name: sprintName }),
    })
    const { id } = (await createRes.json()) as { id: string }

    return { roles, id }
  }

  test('viewer cannot update a sprint (403)', async () => {
    const { roles, id } = await seedMemberSprintWithViewer('Member Sprint')

    const patchRes = await fetchNativeApi(`http://localhost/api/sprints/${id}`, {
      method: 'PATCH',
      headers: authHeaders(roles.viewer.token, roles.workspace.slug),
      body: JSON.stringify({ name: 'Hacked' }),
    })
    expect(patchRes.status).toBe(403)
  })

  test('viewer cannot delete a sprint (403)', async () => {
    const { roles, id } = await seedMemberSprintWithViewer('Member Sprint')

    const deleteRes = await fetchNativeApi(`http://localhost/api/sprints/${id}`, {
      headers: authHeaders(roles.viewer.token, roles.workspace.slug),
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(403)
  })

  test('viewer cannot complete a sprint (403)', async () => {
    const { roles, id } = await seedMemberSprintWithViewer('Sprint')
    await fetchNativeApi(`http://localhost/api/sprints/${id}`, {
      method: 'PATCH',
      headers: authHeaders(roles.member.token, roles.workspace.slug),
      body: JSON.stringify({ status: 'active' }),
    })

    const completeRes = await fetchNativeApi(`http://localhost/api/sprints/${id}/complete`, {
      headers: authHeaders(roles.viewer.token, roles.workspace.slug),
      method: 'POST',
    })
    expect(completeRes.status).toBe(403)
  })

  test("covers PROJ-357: write access only on the sprint's project can't move an issue from an ungranted one", async () => {
    const roles = await seedWorkspaceRoles()
    const projectA = await seedProject(roles.workspace.id, 'PJA')
    const projectB = await seedProject(roles.workspace.id, 'PJB')
    // Member has write access to project A only — no grant at all on project B.
    await seedGroupGrant(roles.workspace.id, roles.member.user.id, projectA.id, 'member')

    const createRes = await fetchNativeApi('http://localhost/api/sprints', {
      method: 'POST',
      headers: authHeaders(roles.member.token, roles.workspace.slug),
      body: JSON.stringify({ projectId: projectA.id, name: 'Sprint A' }),
    })
    expect(createRes.status).toBe(201)
    const { id: sprintId } = (await createRes.json()) as { id: string }

    const foreignIssue = await seedIssue(roles.workspace.id, projectB.id, roles.owner.user.id, {
      title: 'Project B issue',
    })

    const moveRes = await fetchNativeApi(`http://localhost/api/sprints/${sprintId}/move-issues`, {
      method: 'POST',
      headers: authHeaders(roles.member.token, roles.workspace.slug),
      body: JSON.stringify({ issueIds: [foreignIssue.id] }),
    })
    expect(moveRes.status).toBe(404)

    // The issue must be untouched — no partial mutation.
    const row = await env.DB.prepare('SELECT sprint_id FROM issues WHERE id = ?')
      .bind(foreignIssue.id)
      .first<{ sprint_id: string | null }>()
    expect(row?.sprint_id).toBeNull()
  })

  test('viewer cannot move issues to a sprint (403)', async () => {
    const roles = await seedWorkspaceRoles()
    const project = await seedProject(roles.workspace.id)
    await seedGroupGrant(roles.workspace.id, roles.member.user.id, project.id, 'member')
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, project.id, 'viewer')

    const createRes = await fetchNativeApi('http://localhost/api/sprints', {
      method: 'POST',
      headers: authHeaders(roles.member.token, roles.workspace.slug),
      body: JSON.stringify({ projectId: project.id, name: 'Sprint' }),
    })
    const { id: sprintId } = (await createRes.json()) as { id: string }

    const issue = await seedIssue(roles.workspace.id, project.id, roles.member.user.id)

    const moveRes = await fetchNativeApi(`http://localhost/api/sprints/${sprintId}/move-issues`, {
      method: 'POST',
      headers: authHeaders(roles.viewer.token, roles.workspace.slug),
      body: JSON.stringify({ issueIds: [issue.id] }),
    })
    expect(moveRes.status).toBe(403)
  })
})
