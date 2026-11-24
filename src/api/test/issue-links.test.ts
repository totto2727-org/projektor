import { Schema } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture, seedGroupGrant, seedIssue, seedProject, seedWorkspaceRoles } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { IdResponse, readNativeJson } from './response-json.ts'

describe('issue Links API', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let userId: string
  let projectId: string
  let issueA: { id: string }
  let issueB: { id: string }
  let issueC: { id: string }

  beforeEach(async () => {
    const fixture = await seedFixture({ role: 'owner' })
    token = fixture.token
    slug = fixture.workspace.slug
    workspaceId = fixture.workspace.id
    userId = fixture.user.id
    const project = await seedProject(workspaceId)
    projectId = project.id
    issueA = await seedIssue(workspaceId, projectId, userId, { title: 'Issue A' })
    issueB = await seedIssue(workspaceId, projectId, userId, { title: 'Issue B' })
    issueC = await seedIssue(workspaceId, projectId, userId, { title: 'Issue C' })
  })

  const createLink = async function createLink(
    sourceIssueId: string,
    targetIssueId: string,
    type: string,
  ): Promise<Response> {
    return fetchNativeApi(`http://localhost/api/issues/${sourceIssueId}/links`, {
      body: JSON.stringify({ targetIssueId, type }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
  }

  const listLinks = async function listLinks(
    issueId: string,
  ): Promise<{ res: Response; links: Record<string, unknown>[] }> {
    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/links`, {
      headers: authHeaders(token, slug),
    })
    return { res, links: (await res.json()) as Record<string, unknown>[] }
  }

  test('creates a blocks link and lists it from both sides', async () => {
    const createRes = await createLink(issueA.id, issueB.id, 'blocks')
    expect(createRes.status).toBe(201)
    const { id: linkId } = await readNativeJson(createRes, IdResponse)
    expect(linkId).toBeTruthy()

    // From A's perspective: A blocks B
    const { links: aLinks } = await listLinks(issueA.id)
    expect(aLinks).toHaveLength(1)
    expect(aLinks[0].type).toBe('blocks')
    expect(aLinks[0].linkedIssueId).toBe(issueB.id)

    // From B's perspective: B is blocked_by A
    const { links: bLinks } = await listLinks(issueB.id)
    expect(bLinks).toHaveLength(1)
    expect(bLinks[0].type).toBe('blocked_by')
    expect(bLinks[0].linkedIssueId).toBe(issueA.id)
  })

  test('creates a blocked_by link and stores it canonically', async () => {
    // A blocked_by B → stored as B blocks A
    const createRes = await createLink(issueA.id, issueB.id, 'blocked_by')
    expect(createRes.status).toBe(201)

    // From A's perspective: blocked_by B
    const { links: aLinks } = await listLinks(issueA.id)
    expect(aLinks[0].type).toBe('blocked_by')
    expect(aLinks[0].linkedIssueId).toBe(issueB.id)

    // From B's perspective: blocks A
    const { links: bLinks } = await listLinks(issueB.id)
    expect(bLinks[0].type).toBe('blocks')
    expect(bLinks[0].linkedIssueId).toBe(issueA.id)
  })

  test('creates a relates_to link (symmetric)', async () => {
    const createRes = await createLink(issueA.id, issueB.id, 'relates_to')
    expect(createRes.status).toBe(201)

    const { links: aLinks } = await listLinks(issueA.id)
    expect(aLinks[0].type).toBe('relates_to')

    const { links: bLinks } = await listLinks(issueB.id)
    expect(bLinks[0].type).toBe('relates_to')
  })

  test('creates a duplicates link', async () => {
    const createRes = await createLink(issueA.id, issueB.id, 'duplicates')
    expect(createRes.status).toBe(201)

    const { links: aLinks } = await listLinks(issueA.id)
    expect(aLinks[0].type).toBe('duplicates')
  })

  test('rejects self-links', async () => {
    const res = await createLink(issueA.id, issueA.id, 'blocks')
    expect(res.status).toBe(400)
  })

  test('rejects duplicate pairs', async () => {
    await createLink(issueA.id, issueB.id, 'blocks')
    const res = await createLink(issueA.id, issueB.id, 'blocks')
    expect(res.status).toBe(409)
  })

  test('rejects duplicate pairs regardless of direction for symmetric types', async () => {
    await createLink(issueA.id, issueB.id, 'relates_to')
    // Reverse direction should also be rejected (same canonical pair)
    const res = await createLink(issueB.id, issueA.id, 'relates_to')
    expect(res.status).toBe(409)
  })

  test('rejects duplicate blocks/blocked_by pairs', async () => {
    await createLink(issueA.id, issueB.id, 'blocks')
    // blocked_by is the same canonical pair
    const res = await createLink(issueB.id, issueA.id, 'blocked_by')
    expect(res.status).toBe(409)
  })

  test('deletes a link', async () => {
    const createRes = await createLink(issueA.id, issueB.id, 'relates_to')
    const { id: linkId } = await readNativeJson(createRes, IdResponse)

    const deleteRes = await fetchNativeApi(`http://localhost/api/issues/${issueA.id}/links/${linkId}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)

    const { links } = await listLinks(issueA.id)
    expect(links).toHaveLength(0)
  })

  test('returns 404 when deleting nonexistent link', async () => {
    const res = await fetchNativeApi(`http://localhost/api/issues/${issueA.id}/links/${crypto.randomUUID()}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  test('links are cascade-deleted when an issue is deleted', async () => {
    await createLink(issueA.id, issueB.id, 'blocks')

    // Delete issueA
    await fetchNativeApi(`http://localhost/api/issues/${issueA.id}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })

    // The link should be gone from issueB's perspective
    const { links } = await listLinks(issueB.id)
    expect(links).toHaveLength(0)
  })

  test('does not return links from another workspace', async () => {
    // Create a second workspace with its own issue
    const fixture2 = await seedFixture()
    const project2 = await seedProject(fixture2.workspace.id)
    const issueOther = await seedIssue(fixture2.workspace.id, project2.id, fixture2.user.id)

    // Directly insert a link into the DB scoped to workspace2 referencing issueOther and issueA
    // (won't happen via API due to workspace isolation, but checks the service layer)
    const now = currentEpochSeconds()
    await env.DB.prepare(
      `INSERT INTO issue_links (id, workspace_id, source_issue_id, target_issue_id, type, created_by_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        fixture2.workspace.id,
        issueOther.id,
        issueOther.id === issueA.id ? issueB.id : issueOther.id,
        'relates_to',
        fixture2.user.id,
        now,
      )
      .run()

    // workspace1's issueA should still have no links
    const { links } = await listLinks(issueA.id)
    expect(links).toHaveLength(0)
  })

  test('getIssue includes links array', async () => {
    await createLink(issueA.id, issueB.id, 'blocks')
    await createLink(issueA.id, issueC.id, 'relates_to')

    const res = await fetchNativeApi(`http://localhost/api/issues/${issueA.id}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const issueShape = Schema.Struct({
      links: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)).pipe(Schema.mutable),
    })
    const issue = await readNativeJson(res, issueShape)
    expect(Array.isArray(issue.links)).toBe(true)
    expect(issue.links).toHaveLength(2)
  })
})

describe('issue Links role guards', () => {
  test('viewer cannot create a link (403)', async () => {
    const roles = await seedWorkspaceRoles()
    const project = await seedProject(roles.workspace.id)
    const issue1 = await seedIssue(roles.workspace.id, project.id, roles.owner.user.id, {
      title: 'A',
    })
    const issue2 = await seedIssue(roles.workspace.id, project.id, roles.owner.user.id, {
      title: 'B',
    })

    const res = await fetchNativeApi(
      `http://localhost/api/issues/${issue1.id}/links`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.viewer.token, roles.workspace.slug),
        JSON.stringify({ targetIssueId: issue2.id, type: 'relates_to' }),
      ),
    )
    expect(res.status).toBe(403)
  })

  test('viewer cannot delete a link (403)', async () => {
    const roles = await seedWorkspaceRoles()
    const project = await seedProject(roles.workspace.id)
    const issue1 = await seedIssue(roles.workspace.id, project.id, roles.owner.user.id, {
      title: 'A',
    })
    const issue2 = await seedIssue(roles.workspace.id, project.id, roles.owner.user.id, {
      title: 'B',
    })

    const createRes = await fetchNativeApi(
      `http://localhost/api/issues/${issue1.id}/links`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ targetIssueId: issue2.id, type: 'relates_to' }),
      ),
    )
    const { id: linkId } = await readNativeJson(createRes, IdResponse)

    const deleteRes = await fetchNativeApi(`http://localhost/api/issues/${issue1.id}/links/${linkId}`, {
      headers: authHeaders(roles.viewer.token, roles.workspace.slug),
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(403)
  })
})

// PROJ-438: same as comments — the URL carries a ref, so the read takes one.
describe('covers PROJ-438 — links accept an issue ref', () => {
  test('handles GET /:ref/links returns the same links as GET /:uuid/links', async () => {
    const fixture = await seedFixture({ role: 'owner' })
    const slug = fixture.workspace.slug
    const project = await seedProject(fixture.workspace.id)
    const issue = await seedIssue(fixture.workspace.id, project.id, fixture.user.id, { title: 'A' })
    const currentIssue = await seedIssue(fixture.workspace.id, project.id, fixture.user.id, { title: 'B' })

    await fetchNativeApi(
      `http://localhost/api/issues/${issue.id}/links`,
      requestOptionsWithBody(
        'POST',
        authHeaders(fixture.token, slug),
        JSON.stringify({ targetIssueId: currentIssue.id, type: 'blocks' }),
      ),
    )

    const detail = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(fixture.token, slug),
    })
    const { project_key: key, number } = await readNativeJson(
      detail,
      Schema.Struct({ number: Schema.Number, project_key: Schema.String }),
    )

    const byRef = await fetchNativeApi(`http://localhost/api/issues/${key}-${number}/links`, {
      headers: authHeaders(fixture.token, slug),
    })
    const byUuid = await fetchNativeApi(`http://localhost/api/issues/${issue.id}/links`, {
      headers: authHeaders(fixture.token, slug),
    })

    expect(byRef.status).toBe(200)
    await expect(byRef.json()).resolves.toStrictEqual(await byUuid.json())
  })

  /*
   * Same key and number in both workspaces on purpose — see the matching test in
   * comments.test.ts for why distinct keys would let this pass with the resolver's
   * workspace filter removed.
   */
  test("resolves a colliding ref inside the caller's own workspace", async () => {
    const mine = await seedFixture({ role: 'owner' })
    const myProject = await seedProject(mine.workspace.id, 'DUP')
    const issue = await seedIssue(mine.workspace.id, myProject.id, mine.user.id, { title: 'A' })
    const currentIssue = await seedIssue(mine.workspace.id, myProject.id, mine.user.id, { title: 'B' })
    await fetchNativeApi(
      `http://localhost/api/issues/${issue.id}/links`,
      requestOptionsWithBody(
        'POST',
        authHeaders(mine.token, mine.workspace.slug),
        JSON.stringify({ targetIssueId: currentIssue.id, type: 'blocks' }),
      ),
    )

    const theirs = await seedFixture({ role: 'owner' })
    const theirProject = await seedProject(theirs.workspace.id, 'DUP')
    await seedIssue(theirs.workspace.id, theirProject.id, theirs.user.id, { title: 'Not yours' })

    const res = await fetchNativeApi('http://localhost/api/issues/DUP-1/links', {
      headers: authHeaders(mine.token, mine.workspace.slug),
    })

    expect(res.status).toBe(200)
    const links = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ linkedIssueId: Schema.String })).pipe(Schema.mutable),
    )
    expect(links.map((link) => link.linkedIssueId)).toStrictEqual([currentIssue.id])
  })

  test('a ref that exists only in another workspace is 404', async () => {
    const mine = await seedFixture({ role: 'owner' })
    const theirs = await seedFixture({ role: 'owner' })
    const theirProject = await seedProject(theirs.workspace.id, 'OTHER')
    await seedIssue(theirs.workspace.id, theirProject.id, theirs.user.id, { title: 'Not yours' })

    const res = await fetchNativeApi('http://localhost/api/issues/OTHER-1/links', {
      headers: authHeaders(mine.token, mine.workspace.slug),
    })

    expect(res.status).toBe(404)
  })

  test('handles POST /:ref/links accepts a ref (PROJ-713: write tools resolve refs too)', async () => {
    const fixture = await seedFixture({ role: 'owner' })
    const project = await seedProject(fixture.workspace.id)
    await seedIssue(fixture.workspace.id, project.id, fixture.user.id, { title: 'A' })
    const issue = await seedIssue(fixture.workspace.id, project.id, fixture.user.id, { title: 'B' })

    const res = await fetchNativeApi(
      `http://localhost/api/issues/${project.key}-1/links`,
      requestOptionsWithBody(
        'POST',
        authHeaders(fixture.token, fixture.workspace.slug),
        JSON.stringify({ targetIssueId: issue.id, type: 'blocks' }),
      ),
    )

    expect(res.status).toBe(201)
  })
})

describe('createLink target-visibility existence oracle', () => {
  test('an unresolvable target ref and a target in an unwritable project give the same message', async () => {
    const roles = await seedWorkspaceRoles()
    const writableProject = await seedProject(roles.workspace.id, 'WRIT')
    await seedGroupGrant(roles.workspace.id, roles.member.user.id, writableProject.id, 'member')
    const hiddenProject = await seedProject(roles.workspace.id, 'HIDE')

    const source = await seedIssue(roles.workspace.id, writableProject.id, roles.owner.user.id, {
      title: 'Source',
    })
    const hiddenTarget = await seedIssue(roles.workspace.id, hiddenProject.id, roles.owner.user.id, {
      title: 'Hidden target',
    })

    const missingRes = await fetchNativeApi(
      `http://localhost/api/issues/${source.id}/links`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.member.token, roles.workspace.slug),
        JSON.stringify({ targetIssueId: 'NOPE-1', type: 'blocks' }),
      ),
    )
    const unwritableRes = await fetchNativeApi(
      `http://localhost/api/issues/${source.id}/links`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.member.token, roles.workspace.slug),
        JSON.stringify({ targetIssueId: hiddenTarget.id, type: 'blocks' }),
      ),
    )

    expect(missingRes.status).toBe(404)
    expect(unwritableRes.status).toBe(404)
    await expect(missingRes.json()).resolves.toStrictEqual(await unwritableRes.json())
  })
})
