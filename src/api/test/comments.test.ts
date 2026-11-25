import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { ApiResults } from '#contracts/api-results.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  seedComment,
  seedFixture,
  seedGroupGrant,
  seedIssue,
  seedProject,
  seedProjectFixture,
  seedWorkspaceRoles,
  toolError,
} from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { IdResponse, JsonListResponse, readNativeJson } from './response-json.ts'

const mcpCall = async function mcpCall<T>(
  workspaceId: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
): Promise<JsonRpcResult<T> | JsonRpcError> {
  const res = await fetchNativeApi(
    `http://localhost/mcp/${workspaceId}`,
    requestOptionsWithBody('POST', headers, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })),
  )
  return res.json()
}

describe('comments REST API', () => {
  type TestData = Readonly<{
    issueId: string
    slug: string
    token: string
    userId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedProjectFixture()
    const { token, slug, userId } = fixture

    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId: fixture.projectId, title: 'Issue with comments' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const body = await readNativeJson(res, IdResponse)
    const issueId = body.id
    return { issueId, slug, token, userId }
  }

  test('handles GET /:issueId/comments returns empty list', async () => {
    const { issueId, slug, token } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const data = await readNativeJson(res, JsonListResponse)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })

  test('handles POST /:issueId/comments creates a comment', async () => {
    const { issueId, slug, token } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments`, {
      body: JSON.stringify({ body: 'Hello world' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const data = await readNativeJson(res, IdResponse)
    expect(isNonEmptyText(data.id)).toBe(true)
  })

  /*
   * PROJ-328: author_kind is stamped from the authenticated principal type, not a
   * caller-supplied field. Tests authenticate over Bearer tokens (see authHeaders),
   * same as agents — see middleware/auth.ts / conventions.md for the human/agent split.
   */
  test('stamps author_kind from the auth transport, not a caller-supplied field', async () => {
    const { issueId, slug, token } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments`, {
      body: JSON.stringify({ authorKind: 'human', body: 'Hello world' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const data = await readNativeJson(res, IdResponse)

    const row = await env.DB.prepare('SELECT author_kind FROM issue_comments WHERE id = ?')
      .bind(data.id)
      .first<{ author_kind: string | null }>()
    expect(row?.author_kind).toBe('agent')
  })

  test('handles GET after POST returns the comment', async () => {
    const { issueId, slug, token } = await seedTestData()
    await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments`, {
      body: JSON.stringify({ body: 'First comment' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments`, {
      headers: authHeaders(token, slug),
    })
    const data = await readNativeJson(res, Schema.Array(Schema.Struct({ body: Schema.String })).pipe(Schema.mutable))
    expect(data).toHaveLength(1)
    expect(data[0].body).toBe('First comment')
  })

  test('handles POST rejects body that exceeds 10000 chars', async () => {
    const { issueId, slug, token } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments`, {
      body: JSON.stringify({ body: 'x'.repeat(10_001) }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('handles POST rejects empty body', async () => {
    const { issueId, slug, token } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments`, {
      body: JSON.stringify({ body: '' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  /*
   * PROJ-374: addComment was missing the viewer-role guard every other write path
   * enforces (comments.ts:76) — a workspace/project viewer could post comments.
   */
  test('handles POST returns 403 for a project viewer', async () => {
    await seedTestData()
    const roles = await seedWorkspaceRoles()
    const project = await seedProject(roles.workspace.id)
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, project.id, 'viewer')

    const issueRes = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ projectId: project.id, title: 'Viewer-visible issue' }),
      ),
    )
    const { id: viewerIssueId } = await readNativeJson(issueRes, IdResponse)

    const res = await fetchNativeApi(
      `http://localhost/api/issues/${viewerIssueId}/comments`,
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.viewer.token, roles.workspace.slug),
        JSON.stringify({ body: "Viewers shouldn't be able to post this" }),
      ),
    )
    expect(res.status).toBe(403)
  })

  test('handles GET returns 404 for issue in another workspace', async () => {
    const { issueId } = await seedTestData()
    const other = await seedFixture()
    // The issueId value belongs to the first workspace; use other workspace's token+slug
    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments`, {
      headers: authHeaders(other.token, other.workspace.slug),
    })
    expect(res.status).toBe(404)
  })

  test('handles PATCH updates own comment', async () => {
    const { issueId, slug, token, userId } = await seedTestData()
    const comment = await seedComment(issueId, userId)

    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments/${comment.id}`, {
      body: JSON.stringify({ body: 'Updated text' }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(200)

    const listRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments`, {
      headers: authHeaders(token, slug),
    })
    const data = await readNativeJson(
      listRes,
      Schema.Array(Schema.Struct({ body: Schema.String })).pipe(Schema.mutable),
    )
    expect(data[0].body).toBe('Updated text')
  })

  test("handles PATCH returns 403 when editing another user's comment", async () => {
    const { issueId, slug, token } = await seedTestData()
    const other = await seedFixture()
    // Seed a comment by a different user on the same issue (cross-user test within same ws)
    const comment = await seedComment(issueId, other.user.id)

    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments/${comment.id}`, {
      body: JSON.stringify({ body: 'Hijacked' }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(403)
  })

  test('handles DELETE removes own comment', async () => {
    const { issueId, slug, token, userId } = await seedTestData()
    const comment = await seedComment(issueId, userId)

    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments/${comment.id}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(200)

    const listRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}/comments`, {
      headers: authHeaders(token, slug),
    })
    const data = await readNativeJson(listRes, JsonListResponse)
    expect(data).toHaveLength(0)
  })
})

describe('comments MCP cross-workspace security', () => {
  test('covers MCP add_comment rejects issueId belonging to another workspace', async () => {
    const wsA = await seedFixture({ slug: `ws-a-${crypto.randomUUID().slice(0, 6)}` })
    const wsB = await seedFixture({ slug: `ws-b-${crypto.randomUUID().slice(0, 6)}` })
    const projB = await seedProject(wsB.workspace.id, 'VIC')
    await seedGroupGrant(wsB.workspace.id, wsB.user.id, projB.id)

    const issueRes = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        authHeaders(wsB.token, wsB.workspace.slug),
        JSON.stringify({ projectId: projB.id, title: 'Secret issue' }),
      ),
    )
    const { id: victimIssueId } = await readNativeJson(issueRes, IdResponse)

    const res = (await mcpCall<{ content: { text: string }[] }>(
      wsA.workspace.id,
      'tools/call',
      { arguments: { issueId: victimIssueId, body: 'Injected comment' }, name: 'add_comment' },
      authHeaders(wsA.token, wsA.workspace.slug),
    )) as JsonRpcError

    expect(res.error).toBeUndefined()
    expect(toolError(res)?.code).toBe('not_found')
  })

  test('covers MCP list_comments rejects issueId belonging to another workspace', async () => {
    const wsA = await seedFixture({ slug: `ws-c-${crypto.randomUUID().slice(0, 6)}` })
    const wsB = await seedFixture({ slug: `ws-d-${crypto.randomUUID().slice(0, 6)}` })
    const projB = await seedProject(wsB.workspace.id, 'SEC')
    await seedGroupGrant(wsB.workspace.id, wsB.user.id, projB.id)

    const issueRes = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        authHeaders(wsB.token, wsB.workspace.slug),
        JSON.stringify({ projectId: projB.id, title: 'Private issue' }),
      ),
    )
    const { id: victimIssueId } = await readNativeJson(issueRes, IdResponse)

    // Add a comment so there's something to leak if scoping breaks
    await fetchNativeApi(
      `http://localhost/api/issues/${victimIssueId}/comments`,
      requestOptionsWithBody(
        'POST',
        authHeaders(wsB.token, wsB.workspace.slug),
        JSON.stringify({ body: 'Secret comment content' }),
      ),
    )

    const res = (await mcpCall<{ content: { text: string }[] }>(
      wsA.workspace.id,
      'tools/call',
      { arguments: { issueId: victimIssueId }, name: 'list_comments' },
      authHeaders(wsA.token, wsA.workspace.slug),
    )) as JsonRpcError

    expect(res.error).toBeUndefined()
    expect(toolError(res)?.code).toBe('not_found')
  })
})

/*
 * PROJ-438: the browser reaches an issue page by ref, so making it resolve the UUID
 * before it can ask for comments put a whole round trip of dead time on the critical
 * path. These reads now take either identifier.
 */
describe('covers PROJ-438 — comments accept an issue ref', () => {
  test('handles GET /:ref/comments returns the same comments as GET /:uuid/comments', async () => {
    const fixture = await seedProjectFixture({ role: 'owner' })
    const issue = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, {
      title: 'Referenced issue',
    })
    await seedComment(issue.id, fixture.userId, 'visible via both identifiers')

    const detail = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(fixture.token, fixture.slug),
    })
    const { project_key: key, number } = await readNativeJson(
      detail,
      Schema.Struct({ number: Schema.Number, project_key: Schema.String }),
    )

    const byRef = await fetchNativeApi(`http://localhost/api/issues/${key}-${number}/comments`, {
      headers: authHeaders(fixture.token, fixture.slug),
    })
    const byUuid = await fetchNativeApi(`http://localhost/api/issues/${issue.id}/comments`, {
      headers: authHeaders(fixture.token, fixture.slug),
    })

    expect(byRef.status).toBe(200)
    await expect(byRef.json()).resolves.toStrictEqual(await byUuid.json())
  })

  /*
   * The whole point of resolving inside the caller's workspace. A ref is guessable in a
   * way a UUID isn't — KEY-1 exists almost everywhere — so this is the case that would
   * turn refs into a cross-tenant read.
   *
   * Both workspaces get the *same* project key and the same issue number deliberately.
   * With distinct keys this would still pass with the resolver's workspace filter
   * deleted, because listComments re-filters on workspace and 404s anyway — the test
   * would be green while the thing it names was broken.
   */
  test("resolves a colliding ref inside the caller's own workspace, not the other one", async () => {
    const mine = await seedFixture({ role: 'owner' })
    const myProject = await seedProject(mine.workspace.id, 'DUP')
    const myIssue = await seedIssue(mine.workspace.id, myProject.id, mine.user.id, {
      title: 'Mine',
    })
    await seedComment(myIssue.id, mine.user.id, 'mine')

    const theirs = await seedFixture({ role: 'owner' })
    const theirProject = await seedProject(theirs.workspace.id, 'DUP')
    const theirIssue = await seedIssue(theirs.workspace.id, theirProject.id, theirs.user.id, {
      title: 'Not yours',
    })
    await seedComment(theirIssue.id, theirs.user.id, 'secret')

    const res = await fetchNativeApi('http://localhost/api/issues/DUP-1/comments', {
      headers: authHeaders(mine.token, mine.workspace.slug),
    })

    expect(res.status).toBe(200)
    const comments = await readNativeJson(res, ApiResults.apiListComments)
    const bodies = comments.map((c) => c.body)
    expect(bodies).toStrictEqual(['mine'])
  })

  test('a ref that exists only in another workspace is 404', async () => {
    const mine = await seedProjectFixture({ role: 'owner' })
    const theirs = await seedFixture({ role: 'owner' })
    const theirProject = await seedProject(theirs.workspace.id, 'OTHER')
    const theirIssue = await seedIssue(theirs.workspace.id, theirProject.id, theirs.user.id, {
      title: 'Not yours',
    })
    await seedComment(theirIssue.id, theirs.user.id, 'secret')

    const res = await fetchNativeApi('http://localhost/api/issues/OTHER-1/comments', {
      headers: authHeaders(mine.token, mine.slug),
    })

    expect(res.status).toBe(404)
  })

  // The ref path must not become a way around PROJ-311 project grants.
  test('a ref for an issue in a project the caller has no grant on is 404', async () => {
    const fixture = await seedProjectFixture({ role: 'member' })
    const ungranted = await seedProject(fixture.workspaceId, 'NOGRANT')
    const issue = await seedIssue(fixture.workspaceId, ungranted.id, fixture.userId, {
      title: 'Invisible',
    })
    await seedComment(issue.id, fixture.userId, 'secret')

    const res = await fetchNativeApi('http://localhost/api/issues/NOGRANT-1/comments', {
      headers: authHeaders(fixture.token, fixture.slug),
    })

    expect(res.status).toBe(404)
  })
})
