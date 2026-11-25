import { Schema, Iterable } from 'effect'
import { assert, beforeEach, describe, expect, test } from 'vite-plus/test'

import { issuesTools } from '#api/mcp/issues.ts'
import { ListIssuesSchema } from '#contracts/inputs/issues.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { SQL_NULL } from '#db/sql-null.ts'
import { JSON_NULL } from '#tests/json-null.ts'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  seedCustomFieldDef,
  seedCustomFieldValue,
  seedFixture,
  seedGroupGrant,
  seedIssue,
  seedMember,
  seedProject,
  seedProjectFixture,
  seedTaskStatus,
  seedTaskType,
  seedUser,
  seedWorkspaceRoles,
  toolError,
} from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import {
  IssueTitlesResponse,
  JsonRecordResponse,
  RecordItemsResponse,
  TitleItemsResponse,
  ItemsResponse,
  parseNativeMcpText,
  IdResponse,
  JsonListResponse,
  TitleListResponse,
  readNativeJson,
  readNativeMcpResultText,
} from './response-json.ts'

const callMcpTool = async function callMcpTool(
  workspaceId: string,
  token: string,
  slug: string,
  params: unknown,
): Promise<{
  result?: { content: { text: string }[] }
  error?: { code?: number; message: string }
}> {
  const res = await fetchNativeApi(
    `http://localhost/mcp/${workspaceId}`,
    requestOptionsWithBody(
      'POST',
      { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
      JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/call', params }),
    ),
  )
  return res.json()
}

const seedOwnerProjectFixture = async function seedOwnerProjectFixture(): Promise<{
  token: string
  slug: string
  workspaceId: string
  projectId: string
}> {
  const fixture = await seedFixture({ role: 'owner' })
  const project = await seedProject(fixture.workspace.id)
  return {
    token: fixture.token,
    slug: fixture.workspace.slug,
    workspaceId: fixture.workspace.id,
    projectId: project.id,
  }
}

interface IssueProjectFixture {
  projectId: string
  slug: string
  token: string
  userId: string
  workspaceId: string
}

describe('issues API', () => {
  type IssuesPage = {
    items: Record<string, unknown>[]
    nextCursor: number | null
    total: number
  }

  const seedScenarioFixture = async function seedScenarioFixture(): Promise<
    IssueProjectFixture & {
      listIssues: (url?: string) => Promise<{ res: Response; page: IssuesPage }>
      patch: (id: string, body: Record<string, unknown>) => Promise<Response>
    }
  > {
    const { token, slug, workspaceId, userId, projectId }: IssueProjectFixture = await seedProjectFixture({
      role: 'owner',
    })

    const listIssues = async function listIssues(url = 'http://localhost/api/issues') {
      const res = await fetchNativeApi(url, { headers: authHeaders(token, slug) })
      return { res, page: (await res.json()) as IssuesPage }
    }

    /*
     * ─── PROJ-212: completed_at + date-range filters ──────────────────────────
     * The test rate limiter allows only RATE_LIMIT_API_MAX (5) API requests per
     * window, so set up state via env.DB and assert via env.DB where possible —
     * DB access bypasses both the rate limiter and the getIssue KV cache.
     */
    const patch = async function patch(id: string, body: Record<string, unknown>): Promise<Response> {
      return fetchNativeApi(`http://localhost/api/issues/${id}`, {
        body: JSON.stringify(body),
        headers: authHeaders(token, slug),
        method: 'PATCH',
      })
    }
    return { listIssues, patch, projectId, slug, token, userId, workspaceId }
  }

  test('handles GET /api/issues returns empty list initially', async () => {
    const { listIssues } = await seedScenarioFixture()
    const { res, page } = await listIssues()
    expect(res.status).toBe(200)
    expect(Array.isArray(page.items)).toBe(true)
    expect(page.items).toHaveLength(0)
    expect(page.nextCursor).toBeNull()
  })

  test('handles POST /api/issues creates an issue', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ priority: 'high', projectId, title: 'First issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const body = await readNativeJson(res, IdResponse)
    expect(body.id).toMatch(/./su)
  })

  /*
   * PROJ-396: author_kind is stamped from the authenticated principal type, not a
   * caller-supplied field — same convention as issue_comments.author_kind (PROJ-328).
   * Tests authenticate over Bearer tokens (see authHeaders), same as agents.
   */
  test('stamps author_kind from the auth transport, not a caller-supplied field', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Author kind test' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const body = await readNativeJson(res, IdResponse)

    const row = await env.DB.prepare('SELECT author_kind FROM issues WHERE id = ?')
      .bind(body.id)
      .first<{ author_kind: string | null }>()
    expect(row?.author_kind).toBe('agent')
  })

  test('covers PROJ-712: rejects an unrecognized field (e.g. a spoofed authorKind) instead of silently ignoring it', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ authorKind: 'human', projectId, title: 'Author kind test' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('handles POST then GET returns the created issue', async () => {
    const { listIssues, projectId, slug, token } = await seedScenarioFixture()
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Visible issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const { page } = await listIssues()
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('Visible issue')
  })

  test('exposes a resolvable url on list items and single-issue fetches (PROJ-307)', async () => {
    const { listIssues, projectId, slug, token } = await seedScenarioFixture()
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Wiki full-text search' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const created = await readNativeJson(createRes, Schema.Struct({ id: Schema.String, number: Schema.Number }))

    const { page } = await listIssues()
    expect(page.items[0].url).toBe(`/projects/PROJ/issues/${created.number}/wiki-full-text-search`)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${created.id}`, {
      headers: authHeaders(token, slug),
    })
    const fetched = await readNativeJson(getRes, Schema.Struct({ url: Schema.String }))
    expect(fetched.url).toBe(`/projects/PROJ/issues/${created.number}/wiki-full-text-search`)
  })

  test('auto-increments issue number per project', async () => {
    const { listIssues, projectId, slug, token } = await seedScenarioFixture()
    for (const title of ['Issue A', 'Issue B', 'Issue C']) {
      await fetchNativeApi('http://localhost/api/issues', {
        body: JSON.stringify({ projectId, title }),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
    }
    const { page } = await listIssues()
    const numbers = (page.items as { number: number }[]).map((i) => i.number).toSorted((left, right) => left - right)
    expect(numbers).toStrictEqual([1, 2, 3])
  })

  test('concurrent creates in the same project receive distinct issue numbers', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const [res1, res2] = await Promise.all([
      fetchNativeApi('http://localhost/api/issues', {
        body: JSON.stringify({ projectId, title: 'Concurrent A' }),
        headers: authHeaders(token, slug),
        method: 'POST',
      }),
      fetchNativeApi('http://localhost/api/issues', {
        body: JSON.stringify({ projectId, title: 'Concurrent B' }),
        headers: authHeaders(token, slug),
        method: 'POST',
      }),
    ])
    expect(res1.status).toBe(201)
    expect(res2.status).toBe(201)
    const { number: n1 } = await readNativeJson(res1, Schema.Struct({ number: Schema.Number }))
    const { number: n2 } = await readNativeJson(res2, Schema.Struct({ number: Schema.Number }))
    expect(n1).not.toBe(n2)
  })

  test('handles PATCH /api/issues/:id updates status', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'To update' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id } = await readNativeJson(createRes, IdResponse)

    const patchRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      body: JSON.stringify({ status: 'in_progress' }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(patchRes.status).toBe(200)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ status: Schema.String }))
    expect(issue.status).toBe('in_progress')
  })

  test('handles DELETE /api/issues/:id removes the issue', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'To delete' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id } = await readNativeJson(createRes, IdResponse)

    await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    expect(getRes.status).toBe(404)
  })

  test('filters issues by status', async () => {
    const { listIssues, projectId, slug, token } = await seedScenarioFixture()
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Backlog item' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'In progress item' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id } = await readNativeJson(createRes, IdResponse)
    await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      body: JSON.stringify({ status: 'in_progress' }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })

    const { page } = await listIssues('http://localhost/api/issues?status=in_progress')
    expect(page.items).toHaveLength(1)
    expect((page.items[0] as { title: string }).title).toBe('In progress item')
  })

  test('rejects requests from non-members', async () => {
    const { slug } = await seedScenarioFixture()
    const other = await seedFixture()
    const res = await fetchNativeApi('http://localhost/api/issues', {
      headers: authHeaders(other.token, slug),
    })
    expect(res.status).toBe(403)
  })

  test('handles POST with assigneeId and labels persists them', async () => {
    const { projectId, slug, token, workspaceId } = await seedScenarioFixture()
    const assignee = await seedUser('assignee@example.com')
    await seedMember(workspaceId, assignee.id)

    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({
        projectId,
        title: 'Assigned',
        assigneeId: assignee.id,
        labels: ['bug', 'urgent'],
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ assignee_id: Schema.String, labels: Schema.String }))
    expect(issue.assignee_id).toBe(assignee.id)
    expect(JSON.parse(issue.labels)).toStrictEqual(['bug', 'urgent'])
  })

  test('handles PATCH with assigneeId (camelCase) updates the assignee', async () => {
    const { projectId, slug, token, workspaceId } = await seedScenarioFixture()
    const assignee = await seedUser('patch-assignee@example.com')
    await seedMember(workspaceId, assignee.id)

    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Unassigned' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id } = await readNativeJson(createRes, IdResponse)

    const patchRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      body: JSON.stringify({ assigneeId: assignee.id }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(patchRes.status).toBe(200)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ assignee_id: Schema.String }))
    expect(issue.assignee_id).toBe(assignee.id)
  })

  test('handles PATCH with labels updates labels', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ labels: ['old'], projectId, title: 'Label test' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id } = await readNativeJson(createRes, IdResponse)

    await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      body: JSON.stringify({ labels: ['new', 'tag'] }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ labels: Schema.String }))
    expect(JSON.parse(issue.labels)).toStrictEqual(['new', 'tag'])
  })

  test('filters issues by assignee', async () => {
    const { listIssues, projectId, slug, token, workspaceId } = await seedScenarioFixture()
    const assignee = await seedUser('filter-assignee@example.com')
    await seedMember(workspaceId, assignee.id)

    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Unassigned issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Assigned issue', assigneeId: assignee.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const { page } = await listIssues(`http://localhost/api/issues?assignee=${assignee.id}`)
    expect(page.items).toHaveLength(1)
    expect((page.items[0] as { title: string }).title).toBe('Assigned issue')
  })

  test('cursor pagination returns next page', async () => {
    const { listIssues, projectId, userId, workspaceId } = await seedScenarioFixture()
    // Seed with explicit distinct timestamps so cursor (created_at <) math works correctly
    const base = 1_700_000_000
    await seedIssue(workspaceId, projectId, userId, { title: 'Issue 1', createdAt: base + 100 })
    await seedIssue(workspaceId, projectId, userId, { title: 'Issue 2', createdAt: base + 200 })
    await seedIssue(workspaceId, projectId, userId, { title: 'Issue 3', createdAt: base + 300 })

    const { page: first } = await listIssues('http://localhost/api/issues?limit=2')
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const { page: second } = await listIssues(`http://localhost/api/issues?limit=2&cursor=${first.nextCursor}`)
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
  })

  // PROJ-248: seeds 35 issues sequentially; full-suite contention pushes this past the 5s default
  test('defaults to 30 rows per page when no limit is given (PROJ-201)', async () => {
    const { listIssues, projectId, userId, workspaceId } = await seedScenarioFixture()
    const base = 1_700_000_000
    for (let index = 0; index < 35; index += 1) {
      await seedIssue(workspaceId, projectId, userId, {
        title: `Issue ${index}`,
        createdAt: base + index,
      })
    }

    // No explicit limit → the service default (30) applies, with a cursor for the rest.
    const { page: first } = await listIssues('http://localhost/api/issues')
    expect(first.items).toHaveLength(30)
    expect(first.nextCursor).not.toBeNull()

    const { page: second } = await listIssues(`http://localhost/api/issues?cursor=${first.nextCursor}`)
    expect(second.items).toHaveLength(5)
    expect(second.nextCursor).toBeNull()
  }, 15_000)

  test('reports the real total match count, not just the loaded page size (PROJ-303)', async () => {
    const { listIssues, projectId, userId, workspaceId } = await seedScenarioFixture()
    const base = 1_700_000_000
    for (let index = 0; index < 35; index += 1) {
      await seedIssue(workspaceId, projectId, userId, {
        title: `Issue ${index}`,
        createdAt: base + index,
      })
    }

    /*
     * The first page only loads 30 rows, but `total` must reflect all 35 matches —
     * this is what the frontend header count relies on instead of items.length.
     */
    const { page: first } = await listIssues('http://localhost/api/issues')
    expect(first.items).toHaveLength(30)
    expect(first.total).toBe(35)

    // PROJ-857: later pages skip the COUNT(*) — the client keeps the first page's total.
    const { page: second } = await listIssues(`http://localhost/api/issues?cursor=${first.nextCursor}`)
    expect(second.total).toBeNull()
    expect(second.items).toHaveLength(5)
  })

  test('projectId filter scopes results to that project only', async () => {
    const { listIssues, projectId, userId, workspaceId } = await seedScenarioFixture()
    const otherProject = await seedProject(workspaceId, 'OTH')
    await seedIssue(workspaceId, projectId, userId, { title: 'Project A issue' })
    await seedIssue(workspaceId, otherProject.id, userId, { title: 'Project B issue' })

    const { page } = await listIssues(`http://localhost/api/issues?project=${projectId}`)
    expect(page.items).toHaveLength(1)
    expect((page.items[0] as { title: string }).title).toBe('Project A issue')
  })

  // PROJ-248: seeds 65 issues sequentially; full-suite contention pushes this past the 5s default
  test('projectId filter returns all project issues up to limit, not just newest workspace-wide', async () => {
    const { listIssues, projectId, userId, workspaceId } = await seedScenarioFixture()
    // Seed a second project with many newer issues so workspace-wide listing would return them first
    const newerProject = await seedProject(workspaceId, 'NEW')
    const base = currentEpochSeconds()
    for (let index = 0; index < 55; index += 1) {
      await seedIssue(workspaceId, newerProject.id, userId, {
        title: `Newer issue ${index}`,
        createdAt: base + index + 1,
      })
    }
    // Seed issues in projectId with older timestamps — would be cut off by workspace-wide limit=50
    for (let index = 0; index < 10; index += 1) {
      await seedIssue(workspaceId, projectId, userId, {
        title: `Older issue ${index}`,
        createdAt: base - 1000 + index,
      })
    }

    // Without projectId: only newest 50 come back — all from newerProject
    const { page: all } = await listIssues('http://localhost/api/issues?limit=50')
    const allTitles = all.items.map((item) => (item as { title: string }).title)
    expect(allTitles.some((title) => title.startsWith('Older issue'))).toBe(false)

    // With projectId: all 10 project-scoped issues come back regardless of workspace age
    const { page: scoped } = await listIssues(`http://localhost/api/issues?project=${projectId}&limit=100`)
    expect(scoped.items).toHaveLength(10)
    expect(scoped.items.every((item) => (item as { title: string }).title.startsWith('Older issue'))).toBe(true)
  }, 15_000)

  test('handles GET /api/issues/:id returns 404 for unknown id', async () => {
    const { slug, token } = await seedScenarioFixture()
    const res = await fetchNativeApi(`http://localhost/api/issues/${crypto.randomUUID()}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(404)
  })

  test('handles GET /api/issues/KEY-NUMBER looks up by ref', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    // The beforeEach hook seeds a project with key='PROJ'; first issue in it is PROJ-1
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Ref issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(createRes.status).toBe(201)

    const getRes = await fetchNativeApi('http://localhost/api/issues/PROJ-1', {
      headers: authHeaders(token, slug),
    })
    expect(getRes.status).toBe(200)
    const issue = await readNativeJson(getRes, Schema.Struct({ project_key: Schema.String, title: Schema.String }))
    expect(issue.title).toBe('Ref issue')
    expect(issue.project_key).toBe('PROJ')
  })

  test('handles GET /api/issues/KEY-NUMBER resolves for a project key containing digits (PROJ-440)', async () => {
    const { slug, token, workspaceId } = await seedScenarioFixture()
    const digitProject = await seedProject(workspaceId, 'WEB2')
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId: digitProject.id, title: 'Digit-key ref issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(createRes.status).toBe(201)
    const created = await readNativeJson(createRes, Schema.Struct({ id: Schema.String, number: Schema.Number }))

    const getRes = await fetchNativeApi(`http://localhost/api/issues/WEB2-${created.number}`, {
      headers: authHeaders(token, slug),
    })
    expect(getRes.status).toBe(200)
    const issue = await readNativeJson(getRes, Schema.Struct({ project_key: Schema.String, title: Schema.String }))
    expect(issue).toMatchObject({ project_key: 'WEB2', title: 'Digit-key ref issue' })

    const commentsRes = await fetchNativeApi(`http://localhost/api/issues/WEB2-${created.number}/comments`, {
      headers: authHeaders(token, slug),
    })
    expect(commentsRes.status).toBe(200)

    const linksRes = await fetchNativeApi(`http://localhost/api/issues/WEB2-${created.number}/links`, {
      headers: authHeaders(token, slug),
    })
    expect(linksRes.status).toBe(200)
  })

  test('handles GET /api/issues/:ref with an absurdly long number is a 404, not a 500 (PROJ-440)', async () => {
    const { slug, token } = await seedScenarioFixture()
    const res = await fetchNativeApi(`http://localhost/api/issues/PROJ-${'9'.repeat(400)}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(404)
  })

  test('handles GET /api/issues/:id includes project_key (PROJ-226 tab title regression)', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedScenarioFixture()
    const created = await seedIssue(workspaceId, projectId, userId, { title: 'By id' })

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${created.id}`, {
      headers: authHeaders(token, slug),
    })
    expect(getRes.status).toBe(200)
    const issue = await readNativeJson(getRes, Schema.Struct({ project_key: Schema.String }))
    expect(issue.project_key).toBe('PROJ')
  })

  test('handles GET /api/issues/search finds issues by title keyword', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({
        body: 'Login fails on Safari',
        projectId,
        title: 'Authentication bug',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({
        body: 'Slow query on dashboard',
        projectId,
        title: 'Performance regression',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/issues/search?q=Authentication', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const results = await readNativeJson(res, TitleListResponse)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Authentication bug')
  })

  test('handles GET /api/issues/search finds issues by body keyword', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ body: 'Contains wrangler reference', projectId, title: 'Some issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ body: 'Unrelated content', projectId, title: 'Other issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/issues/search?q=wrangler', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(res, TitleListResponse)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Some issue')
  })

  test('handles GET /api/issues/search respects workspace scoping', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ body: 'unique-sentinel', projectId, title: 'Workspace A issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const other = await seedFixture()
    const otherProject = await seedProject(other.workspace.id, 'OTH')
    await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        authHeaders(other.token, other.workspace.slug),
        JSON.stringify({
          body: 'unique-sentinel',
          projectId: otherProject.id,
          title: 'Workspace B issue',
        }),
      ),
    )

    const res = await fetchNativeApi('http://localhost/api/issues/search?q=unique-sentinel', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(res, TitleListResponse)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Workspace A issue')
  })

  test('handles GET /api/issues/search with projectId filters to that project', async () => {
    const { projectId, slug, token, workspaceId } = await seedScenarioFixture()
    const otherProject = await seedProject(workspaceId, 'SEC')
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ body: 'shared-term', projectId, title: 'Alpha project issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({
        body: 'shared-term',
        projectId: otherProject.id,
        title: 'Beta project issue',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi(`http://localhost/api/issues/search?q=shared-term&projectId=${projectId}`, {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(res, TitleListResponse)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Alpha project issue')
  })

  test('handles GET /api/issues/search returns project fields in results', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Field check issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/issues/search?q=Field+check', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(
      res,
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          number: Schema.Number,
          priority: Schema.String,
          project_key: Schema.String,
          status: Schema.String,
          title: Schema.String,
        }),
      ).pipe(Schema.mutable),
    )
    expect(results).toHaveLength(1)
    expect(results[0].project_key).toBe('PROJ')
    expect(results[0].status).toBeDefined()
    expect(results[0].priority).toBeDefined()
    expect(results[0].number).toBeDefined()
  })

  test('handles GET /api/issues/search returns 400 when query is missing', async () => {
    const { slug, token } = await seedScenarioFixture()
    const res = await fetchNativeApi('http://localhost/api/issues/search', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(400)
  })

  test('handles GET /api/issues/search ranks by bm25 (title+body match scores higher than body-only)', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    // Issue with the term in both title AND body — higher bm25 score
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({
        body: 'authentication flow is broken',
        projectId,
        title: 'Authentication bug',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    // Issue with the term only in body — lower bm25 score
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({
        body: 'unrelated to authentication',
        projectId,
        title: 'Performance regression',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/issues/search?q=authentication', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const results = await readNativeJson(res, TitleListResponse)
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('Authentication bug')
  })

  test('handles GET /api/issues/search FTS workspace isolation prevents cross-tenant results', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    // Seed an issue in the primary workspace
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ body: '', projectId, title: 'Primary workspace fts-sentinel' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    // Seed the same term in a completely separate workspace
    const other = await seedFixture()
    const otherProject = await seedProject(other.workspace.id, 'OTH')
    await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        authHeaders(other.token, other.workspace.slug),
        JSON.stringify({
          body: '',
          projectId: otherProject.id,
          title: 'Other workspace fts-sentinel',
        }),
      ),
    )

    // Search from the primary workspace must not see the other workspace's issue
    const res = await fetchNativeApi('http://localhost/api/issues/search?q=fts-sentinel', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(res, TitleListResponse)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Primary workspace fts-sentinel')
  })

  test('handles GET /api/issues/search returns empty results for whitespace-only query', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Noise issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const res = await fetchNativeApi('http://localhost/api/issues/search?q=+++', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const results = await readNativeJson(res, JsonListResponse)
    expect(results).toHaveLength(0)
  })

  test('handles GET /api/issues/search returns empty results for punctuation-only query', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Noise issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const res = await fetchNativeApi('http://localhost/api/issues/search?q=!!!', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const results = await readNativeJson(res, JsonListResponse)
    expect(results).toHaveLength(0)
  })

  // ---- Hierarchy (parent_id) tests ----

  test('handles POST creates a child issue with parentId', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const parentRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Parent issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: parentId } = await readNativeJson(parentRes, IdResponse)

    const childRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ parentId, projectId, title: 'Child issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(childRes.status).toBe(201)
    const { id: childId } = await readNativeJson(childRes, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${childId}`, {
      headers: authHeaders(token, slug),
    })
    const child = await readNativeJson(getRes, Schema.Struct({ parent_id: Schema.String }))
    expect(child.parent_id).toBe(parentId)
  })

  test('handles GET issue includes rollup of child status counts', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedScenarioFixture()
    const parentRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Parent for rollup' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: parentId } = await readNativeJson(parentRes, IdResponse)

    // Create 3 children: 2 backlog, 1 done
    await seedIssue(workspaceId, projectId, userId, { parentId, status: 'backlog' })
    await seedIssue(workspaceId, projectId, userId, { parentId, status: 'backlog' })
    await seedIssue(workspaceId, projectId, userId, { parentId, status: 'done' })

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${parentId}`, {
      headers: authHeaders(token, slug),
    })
    const issueShape = Schema.Struct({
      rollup: Schema.Struct({ byStatus: Schema.Record(Schema.String, Schema.Number), total: Schema.Number }),
    })
    const issue = await readNativeJson(getRes, issueShape)
    expect(issue.rollup.total).toBe(3)
    expect(issue.rollup.byStatus.backlog).toBe(2)
    expect(issue.rollup.byStatus.done).toBe(1)
  })

  test('handles GET issue with no children returns empty rollup', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Childless issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id } = await readNativeJson(createRes, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issueShape = Schema.Struct({
      rollup: Schema.Struct({ byStatus: Schema.Record(Schema.String, Schema.Number), total: Schema.Number }),
    })
    const issue = await readNativeJson(getRes, issueShape)
    expect(issue.rollup.total).toBe(0)
    expect(issue.rollup.byStatus).toStrictEqual({})
  })

  test('handles PATCH sets parentId on an existing issue', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const parentRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Parent' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: parentId } = await readNativeJson(parentRes, IdResponse)

    const childRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Child (no parent yet)' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: childId } = await readNativeJson(childRes, IdResponse)

    const patchRes = await fetchNativeApi(`http://localhost/api/issues/${childId}`, {
      body: JSON.stringify({ parentId }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(patchRes.status).toBe(200)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${childId}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ parent_id: Schema.String }))
    expect(issue.parent_id).toBe(parentId)
  })

  test('handles PATCH clears parentId by setting it to null', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const parentRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Parent to detach from' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: parentId } = await readNativeJson(parentRes, IdResponse)

    const childRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ parentId, projectId, title: 'Child' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: childId } = await readNativeJson(childRes, IdResponse)

    await fetchNativeApi(`http://localhost/api/issues/${childId}`, {
      body: JSON.stringify({ parentId: JSON_NULL }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${childId}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ parent_id: Schema.Union([Schema.String, Schema.Null]) }))
    expect(issue.parent_id).toBeNull()
  })

  test('handles POST rejects self as parent', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    // Create issue first, then try to set itself as parent via PATCH
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Self-ref' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id } = await readNativeJson(createRes, IdResponse)

    const patchRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      body: JSON.stringify({ parentId: id }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(patchRes.status).toBe(400)
  })

  test('handles PATCH rejects a parentId that would create a cycle', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedScenarioFixture()
    // A → B → C; try to set A.parentId = C (cycle: A is ancestor of C)
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'A' })
    const currentIssue = await seedIssue(workspaceId, projectId, userId, { title: 'B', parentId: issue.id })
    const c = await seedIssue(workspaceId, projectId, userId, { title: 'C', parentId: currentIssue.id })

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      body: JSON.stringify({ parentId: c.id }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(400)
  })

  test('handles POST rejects parent that would exceed depth cap of 5', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedScenarioFixture()
    // Build a chain root → L1 → L2 → L3 → L4 → L5 (L5 is at depth 5)
    const root = await seedIssue(workspaceId, projectId, userId, { title: 'Root' })
    const l1 = await seedIssue(workspaceId, projectId, userId, { title: 'L1', parentId: root.id })
    const l2 = await seedIssue(workspaceId, projectId, userId, { title: 'L2', parentId: l1.id })
    const l3 = await seedIssue(workspaceId, projectId, userId, { title: 'L3', parentId: l2.id })
    const l4 = await seedIssue(workspaceId, projectId, userId, { title: 'L4', parentId: l3.id })
    const l5 = await seedIssue(workspaceId, projectId, userId, { title: 'L5', parentId: l4.id })

    // L5 is at depth 5; adding a child would be depth 6 — must be rejected
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ parentId: l5.id, projectId, title: 'L6 (should fail)' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('handles POST accepts parent at depth 4 (child at depth 5 is allowed)', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedScenarioFixture()
    const root = await seedIssue(workspaceId, projectId, userId, { title: 'Root' })
    const l1 = await seedIssue(workspaceId, projectId, userId, { title: 'L1', parentId: root.id })
    const l2 = await seedIssue(workspaceId, projectId, userId, { title: 'L2', parentId: l1.id })
    const l3 = await seedIssue(workspaceId, projectId, userId, { title: 'L3', parentId: l2.id })
    const l4 = await seedIssue(workspaceId, projectId, userId, { title: 'L4', parentId: l3.id })

    // L4 is at depth 4; adding a child would be depth 5 — must be allowed
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ parentId: l4.id, projectId, title: 'L5 (should succeed)' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
  })

  test('handles GET /api/issues?parentId= filters to direct children', async () => {
    const { listIssues, projectId, userId, workspaceId } = await seedScenarioFixture()
    const parent = await seedIssue(workspaceId, projectId, userId, { title: 'Parent' })
    await seedIssue(workspaceId, projectId, userId, { title: 'Child 1', parentId: parent.id })
    await seedIssue(workspaceId, projectId, userId, { title: 'Child 2', parentId: parent.id })
    await seedIssue(workspaceId, projectId, userId, { title: 'Top-level issue' })

    const { page } = await listIssues(`http://localhost/api/issues?parentId=${parent.id}`)
    expect(page.items).toHaveLength(2)
    const titles = (page.items as { title: string }[]).map((i) => i.title)
    expect(titles).toContain('Child 1')
    expect(titles).toContain('Child 2')
  })

  test('handles POST rejects parentId from a different workspace', async () => {
    const { projectId, slug, token } = await seedScenarioFixture()
    const other = await seedFixture()
    const otherProject = await seedProject(other.workspace.id, 'OTH')
    const otherIssue = await seedIssue(other.workspace.id, otherProject.id, other.user.id, {
      title: 'Other ws issue',
    })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ parentId: otherIssue.id, projectId, title: 'Cross-ws child' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  test("covers PROJ-389: another workspace's owner cannot create an issue in this project", async () => {
    const { projectId } = await seedScenarioFixture()
    const other = await seedFixture({ role: 'owner' })
    const res = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        authHeaders(other.token, other.workspace.slug),
        JSON.stringify({ projectId, title: 'Cross-workspace write' }),
      ),
    )
    expect(res.status).toBe(404)
  })

  test('filters by multiple statusIds (OR)', async () => {
    const { listIssues, projectId, userId, workspaceId } = await seedScenarioFixture()
    const s1 = await seedTaskStatus(workspaceId, { category: 'todo', key: 'todo', name: 'Todo' })
    const s2 = await seedTaskStatus(workspaceId, { category: 'done', key: 'done', name: 'Done' })
    const s3 = await seedTaskStatus(workspaceId, {
      category: 'in_progress',
      key: 'in_progress',
      name: 'In Progress',
    })

    await seedIssue(workspaceId, projectId, userId, {
      title: 'Todo item',
      statusId: s1.id,
    })
    await seedIssue(workspaceId, projectId, userId, {
      title: 'Done item',
      statusId: s2.id,
    })
    await seedIssue(workspaceId, projectId, userId, {
      title: 'In progress item',
      statusId: s3.id,
    })

    const { page } = await listIssues(`http://localhost/api/issues?statusIds=${s1.id},${s2.id}`)
    expect(page.items).toHaveLength(2)
    const titles = (page.items as { title: string }[]).map((i) => i.title).toSorted()
    expect(titles).toStrictEqual(['Done item', 'Todo item'])
  })

  test('filters by multiple priorities (OR)', async () => {
    const { listIssues, projectId, slug, token } = await seedScenarioFixture()
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ priority: 'urgent', projectId, title: 'Urgent issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ priority: 'high', projectId, title: 'High issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ priority: 'low', projectId, title: 'Low issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const { page } = await listIssues('http://localhost/api/issues?priorities=urgent,high')
    expect(page.items).toHaveLength(2)
    const titles = (page.items as { title: string }[]).map((i) => i.title).toSorted()
    expect(titles).toStrictEqual(['High issue', 'Urgent issue'])
  })

  test('filters by projectId', async () => {
    const { listIssues, projectId, slug, token, workspaceId } = await seedScenarioFixture()
    const project2 = await seedProject(workspaceId)

    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Project 1 issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId: project2.id, title: 'Project 2 issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const { page } = await listIssues(`http://localhost/api/issues?project=${project2.id}`)
    expect(page.items).toHaveLength(1)
    expect((page.items[0] as { title: string }).title).toBe('Project 2 issue')
  })

  test('noParent=true returns only issues without a parent', async () => {
    const { listIssues, projectId, slug, token } = await seedScenarioFixture()
    const r1 = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Parent issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: parentId } = await readNativeJson(r1, IdResponse)

    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ parentId, projectId, title: 'Child issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const { page } = await listIssues('http://localhost/api/issues?noParent=true')
    expect(page.items).toHaveLength(1)
    expect((page.items[0] as { title: string }).title).toBe('Parent issue')
  })

  test('excludeTypeIds drops issues of those types but keeps untyped ones (PROJ-202)', async () => {
    const { listIssues, projectId, userId, workspaceId } = await seedScenarioFixture()
    const epic = await seedTaskType(workspaceId, { key: 'epic', name: 'Epic' })
    await seedIssue(workspaceId, projectId, userId, { title: 'An epic', typeId: epic.id })
    await seedIssue(workspaceId, projectId, userId, { title: 'A plain issue' })

    const { page } = await listIssues(`http://localhost/api/issues?excludeTypeIds=${epic.id}`)
    const titles = (page.items as { title: string }[]).map((i) => i.title).toSorted()
    // The epic is excluded; the untyped (NULL type_id) issue must NOT be dropped.
    expect(titles).toStrictEqual(['A plain issue'])
  })

  const completedAtOf = async function completedAtOf(id: string): Promise<number | null> {
    const row = await env.DB.prepare('SELECT completed_at FROM issues WHERE id = ?')
      .bind(id)
      .first<{ completed_at: number | null }>()
    return row?.completed_at ?? SQL_NULL
  }

  test('stamps completed_at when an issue enters a done status and clears it on exit (PROJ-212)', async () => {
    const { patch, projectId, userId, workspaceId } = await seedScenarioFixture()
    // 3 API requests (DB seed + 3 patch), under the rate-limit window.
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Will complete' })
    const { id } = issue
    await expect(completedAtOf(id)).resolves.toBeNull()

    await patch(id, {
      status: 'done',
      completionReport: { summary: 'Done', verification: 'pnpm test' },
    })
    const completed = await completedAtOf(id)
    expect(typeof completed).toBe('number')

    // Re-saving while still done keeps the original completion time.
    await patch(id, { priority: 'high' })
    await expect(completedAtOf(id)).resolves.toBe(completed)

    // Leaving done clears it.
    await patch(id, { status: 'in_progress' })
    await expect(completedAtOf(id)).resolves.toBeNull()
  })

  test('filters by completedAfter / completedBefore (PROJ-212)', async () => {
    const { listIssues, projectId, userId, workspaceId } = await seedScenarioFixture()
    // Seed + stamp completion via env.DB so only the 2 list calls hit the API.
    const older = await seedIssue(workspaceId, projectId, userId, { title: 'Completed long ago' })
    const recent = await seedIssue(workspaceId, projectId, userId, { title: 'Completed just now' })
    const now = currentEpochSeconds()
    await env.DB.prepare('UPDATE issues SET completed_at = ? WHERE id = ?')
      .bind(now - 10 * 86_400, older.id)
      .run()
    await env.DB.prepare('UPDATE issues SET completed_at = ? WHERE id = ?').bind(now, recent.id).run()

    // 1 day ago
    const cutoff = now - 86_400

    const before = await listIssues(`http://localhost/api/issues?completedBefore=${cutoff}`)
    expect((before.page.items as { title: string }[]).map((i) => i.title)).toStrictEqual(['Completed long ago'])

    const after = await listIssues(`http://localhost/api/issues?completedAfter=${cutoff}`)
    expect((after.page.items as { title: string }[]).map((i) => i.title)).toStrictEqual(['Completed just now'])
  })

  test('filters by updatedAfter / updatedBefore (PROJ-212)', async () => {
    const { listIssues, projectId, userId, workspaceId } = await seedScenarioFixture()
    const now = currentEpochSeconds()
    const stale = await seedIssue(workspaceId, projectId, userId, { title: 'Edited long ago' })
    const fresh = await seedIssue(workspaceId, projectId, userId, { title: 'Edited just now' })
    await env.DB.prepare('UPDATE issues SET updated_at = ? WHERE id = ?')
      .bind(now - 10 * 86_400, stale.id)
      .run()
    await env.DB.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').bind(now, fresh.id).run()

    const cutoff = now - 86_400

    const before = await listIssues(`http://localhost/api/issues?updatedBefore=${cutoff}`)
    expect((before.page.items as { title: string }[]).map((i) => i.title)).toStrictEqual(['Edited long ago'])

    const after = await listIssues(`http://localhost/api/issues?updatedAfter=${cutoff}`)
    expect((after.page.items as { title: string }[]).map((i) => i.title)).toStrictEqual(['Edited just now'])
  })

  // ─── PROJ-252: flow timestamps (ready_at/claimed_at/done_at) ──────────────
  const flowTimestampsOf = async function flowTimestampsOf(
    id: string,
  ): Promise<{ ready_at: number | null; claimed_at: number | null; done_at: number | null }> {
    const row = await env.DB.prepare('SELECT ready_at, claimed_at, done_at FROM issues WHERE id = ?')
      .bind(id)
      .first<{ ready_at: number | null; claimed_at: number | null; done_at: number | null }>()
    return row ?? { ready_at: SQL_NULL, claimed_at: SQL_NULL, done_at: SQL_NULL }
  }

  test('stamps ready_at/claimed_at/done_at once, on first entry, and never clears them', async () => {
    const { patch, projectId, userId, workspaceId } = await seedScenarioFixture()
    // 4 API requests (seed + 4 patches), under the rate-limit window.
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Flows through' })
    const { id } = issue
    await expect(flowTimestampsOf(id)).resolves.toStrictEqual({
      claimed_at: SQL_NULL,
      done_at: SQL_NULL,
      ready_at: SQL_NULL,
    })

    await patch(id, { status: 'todo' })
    const afterReady = await flowTimestampsOf(id)
    expect(typeof afterReady.ready_at).toBe('number')
    expect(afterReady.claimed_at).toBeNull()
    expect(afterReady.done_at).toBeNull()

    await patch(id, { status: 'in_progress' })
    const afterClaimed = await flowTimestampsOf(id)
    expect(afterClaimed.ready_at).toBe(afterReady.ready_at)
    expect(typeof afterClaimed.claimed_at).toBe('number')
    expect(afterClaimed.done_at).toBeNull()

    await patch(id, {
      status: 'done',
      completionReport: { summary: 'Done', verification: 'pnpm test' },
    })
    const afterDone = await flowTimestampsOf(id)
    expect(typeof afterDone.done_at).toBe('number')

    // Reopening does not clear done_at (unlike completed_at) — it's write-once history.
    await patch(id, { status: 'in_progress' })
    const afterReopen = await flowTimestampsOf(id)
    expect(afterReopen.ready_at).toBe(afterReady.ready_at)
    expect(afterReopen.claimed_at).toBe(afterClaimed.claimed_at)
    expect(afterReopen.done_at).toBe(afterDone.done_at)
  })

  test('stamps ready_at even when an issue skips straight from backlog to in_progress', async () => {
    const { patch, projectId, userId, workspaceId } = await seedScenarioFixture()
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Fast-tracked' })
    await patch(issue.id, { status: 'in_progress' })
    const stamps = await flowTimestampsOf(issue.id)
    expect(typeof stamps.ready_at).toBe('number')
    expect(typeof stamps.claimed_at).toBe('number')
  })

  // ─── PROJ-328: in_review_at + review_bounce_count ──────────────
  const reviewFieldsOf = async function reviewFieldsOf(
    id: string,
  ): Promise<{ in_review_at: number | null; review_bounce_count: number }> {
    const row = await env.DB.prepare('SELECT in_review_at, review_bounce_count FROM issues WHERE id = ?')
      .bind(id)
      .first<{ in_review_at: number | null; review_bounce_count: number }>()
    return row ?? { in_review_at: SQL_NULL, review_bounce_count: 0 }
  }

  test('stamps in_review_at once, on first entry, and counts bounces back to in_progress', async () => {
    const { patch, projectId, userId, workspaceId } = await seedScenarioFixture()
    const issue = await seedIssue(workspaceId, projectId, userId, {
      title: 'Reviewed and bounced',
    })
    const { id } = issue

    await patch(id, { status: 'in_progress' })
    await expect(reviewFieldsOf(id)).resolves.toStrictEqual({ in_review_at: SQL_NULL, review_bounce_count: 0 })

    await patch(id, { status: 'in_review' })
    const afterReview = await reviewFieldsOf(id)
    expect(typeof afterReview.in_review_at).toBe('number')
    expect(afterReview.review_bounce_count).toBe(0)

    await patch(id, { status: 'in_progress' })
    const afterBounce = await reviewFieldsOf(id)
    expect(afterBounce.in_review_at).toBe(afterReview.in_review_at)
    expect(afterBounce.review_bounce_count).toBe(1)

    await patch(id, { status: 'in_review' })
    const afterReReview = await reviewFieldsOf(id)
    // Write-once: re-entering review does not restamp in_review_at.
    expect(afterReReview.in_review_at).toBe(afterReview.in_review_at)
    expect(afterReReview.review_bounce_count).toBe(1)

    await patch(id, {
      status: 'done',
      completionReport: { summary: 'Done', verification: 'pnpm test' },
    })
    const afterDone = await reviewFieldsOf(id)
    // Going from review straight to done is not a bounce.
    expect(afterDone.review_bounce_count).toBe(1)
  })

  // ─── PROJ-334: gate rejections (in_review -> in_progress specifically) ──────
  const gateRejectionCountOf = async function gateRejectionCountOf(id: string): Promise<number> {
    const row = await env.DB.prepare('SELECT COUNT(*) as n FROM issue_gate_rejections WHERE issue_id = ?')
      .bind(id)
      .first<{ n: number }>()
    return row?.n ?? 0
  }

  /*
   * Split into two tests (each gets a fresh token from beforeEach) — the test rate
   * limiter allows only RATE_LIMIT_API_MAX (5) requests per token per window, and
   * each case alone already needs 3 patches.
   */
  test('records a gate-rejection event for in_review -> in_progress', async () => {
    const { patch, projectId, userId, workspaceId } = await seedScenarioFixture()
    const rejected = await seedIssue(workspaceId, projectId, userId, { title: 'Sent back' })
    await patch(rejected.id, { status: 'in_progress' })
    await patch(rejected.id, { status: 'in_review' })
    await patch(rejected.id, { status: 'in_progress' })
    await expect(gateRejectionCountOf(rejected.id)).resolves.toBe(1)
    // The review_bounce_count metric still counts it (PROJ-328's aggregate is unchanged).
    const result = await reviewFieldsOf(rejected.id)
    expect(result.review_bounce_count).toBe(1)
  })

  test('does not record a gate-rejection event for in_review -> cancelled', async () => {
    const { patch, projectId, userId, workspaceId } = await seedScenarioFixture()
    const killed = await seedIssue(workspaceId, projectId, userId, { title: 'Killed in review' })
    await patch(killed.id, { status: 'in_progress' })
    await patch(killed.id, { status: 'in_review' })
    await patch(killed.id, { status: 'cancelled' })
    /*
     * Not a gate rejection — the issue was cancelled, not sent back for rework —
     * even though the aggregate reviewBounceCount still increments for it.
     */
    await expect(gateRejectionCountOf(killed.id)).resolves.toBe(0)
    const resolvedValue = await reviewFieldsOf(killed.id)
    expect(resolvedValue.review_bounce_count).toBe(1)
  })
})

const seedIssueRollupFixture = async function seedIssueRollupFixture(): Promise<
  IssueProjectFixture & {
    listIssues: (url: string) => Promise<{ res: Response; page: { items: Record<string, unknown>[] } }>
  }
> {
  const { token, slug, workspaceId, userId, projectId }: IssueProjectFixture = await seedProjectFixture({
    role: 'owner',
  })

  const listIssues = async function listIssues(
    url: string,
  ): Promise<{ res: Response; page: { items: Record<string, unknown>[] } }> {
    const res = await fetchNativeApi(url, { headers: authHeaders(token, slug) })
    return { res, page: (await res.json()) as { items: Record<string, unknown>[] } }
  }
  return { listIssues, projectId, slug, token, userId, workspaceId }
}

// ─── PROJ-441/442/444: list-endpoint perf sweep ──────────────────────────────
describe('issues API — includeRollups/includeBody/assignee=me (perf sweep)', () => {
  // PROJ-441
  test('includeRollups=1 attaches a rollup per item for parents with mixed-status children', async () => {
    const { listIssues, projectId, slug, token, userId, workspaceId } = await seedIssueRollupFixture()
    const parentRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Parent with children' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: parentId } = await readNativeJson(parentRes, IdResponse)
    await seedIssue(workspaceId, projectId, userId, { parentId, status: 'backlog' })
    await seedIssue(workspaceId, projectId, userId, { parentId, status: 'backlog' })
    await seedIssue(workspaceId, projectId, userId, { parentId, status: 'done' })

    const { page } = await listIssues(`http://localhost/api/issues?noParent=true&includeRollups=1`)
    const parentItem = page.items.find((item) => item.id === parentId) as {
      rollup: { total: number; byStatus: Record<string, number>; done: number; remaining: number }
    }
    expect(parentItem).toBeDefined()
    expect(parentItem.rollup.total).toBe(3)
    expect(parentItem.rollup.byStatus.backlog).toBe(2)
    expect(parentItem.rollup.byStatus.done).toBe(1)
    expect(parentItem.rollup.done).toBe(1)
    expect(parentItem.rollup.remaining).toBe(2)
  })

  test('without includeRollups, items carry no rollup key', async () => {
    const { listIssues, projectId, slug, token } = await seedIssueRollupFixture()
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'No rollup wanted' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { page } = await listIssues('http://localhost/api/issues')
    expect(page.items).toHaveLength(1)
    expect('rollup' in page.items[0]).toBe(false)
  })

  test("includeRollups counts children in a different project the same as getIssue's own rollup", async () => {
    const { listIssues, projectId, slug, token, userId, workspaceId } = await seedIssueRollupFixture()
    const otherProject = await seedProject(workspaceId, 'OTH')
    const parentRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Cross-project parent' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: parentId } = await readNativeJson(parentRes, IdResponse)
    await seedIssue(workspaceId, otherProject.id, userId, { parentId, status: 'done' })

    // The rollup from getIssue (unaffected by this change) — the baseline to match.
    const getRes = await fetchNativeApi(`http://localhost/api/issues/${parentId}`, {
      headers: authHeaders(token, slug),
    })
    const single = await readNativeJson(
      getRes,
      Schema.Struct({ rollup: Schema.Struct({ done: Schema.Number, total: Schema.Number }) }),
    )
    expect(single.rollup.total).toBe(1)
    expect(single.rollup.done).toBe(1)

    const { page } = await listIssues(`http://localhost/api/issues?noParent=true&includeRollups=1`)
    const parentItem = page.items.find((item) => item.id === parentId) as {
      rollup: { total: number; done: number }
    }
    expect(parentItem.rollup.total).toBe(single.rollup.total)
    expect(parentItem.rollup.done).toBe(single.rollup.done)
  })

  test('includeRollups groups by raw status even when status_category diverges, matching getIssue', async () => {
    const { listIssues, projectId, slug, token, userId, workspaceId } = await seedIssueRollupFixture()
    const parentRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Category-divergent parent' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: parentId } = await readNativeJson(parentRes, IdResponse)
    const { id: childId } = await seedIssue(workspaceId, projectId, userId, {
      parentId,
      status: 'backlog',
    })
    /*
     * Custom-status issues carry a status_category distinct from their raw status;
     * the list rollup must still key byStatus on the raw status like getIssue does.
     */
    await env.DB.prepare("UPDATE issues SET status_category = 'done' WHERE id = ?").bind(childId).run()

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${parentId}`, {
      headers: authHeaders(token, slug),
    })
    const singleShape = Schema.Struct({
      rollup: Schema.Struct({
        byStatus: Schema.Record(Schema.String, Schema.Number),
        done: Schema.Number,
        total: Schema.Number,
      }),
    })
    const single = await readNativeJson(getRes, singleShape)

    const { page } = await listIssues(`http://localhost/api/issues?noParent=true&includeRollups=1`)
    const parentItem = page.items.find((item) => item.id === parentId) as {
      rollup: { total: number; byStatus: Record<string, number>; done: number }
    }
    expect(parentItem.rollup).toStrictEqual(single.rollup)
    expect(parentItem.rollup.byStatus).toStrictEqual({ backlog: 1 })
    expect(parentItem.rollup.done).toBe(0)
  })

  // PROJ-442
  test('list items omit body by default; includeBody=1 restores it', async () => {
    const { listIssues, projectId, slug, token } = await seedIssueRollupFixture()
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ body: 'Some body text', projectId, title: 'Has a body' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const { page: defaultPage } = await listIssues('http://localhost/api/issues')
    expect(defaultPage.items).toHaveLength(1)
    expect('body' in defaultPage.items[0]).toBe(false)

    const { page: withBody } = await listIssues('http://localhost/api/issues?includeBody=1')
    expect(withBody.items[0].body).toBe('Some body text')
  })

  // PROJ-444
  test("assignee=me returns the calling user's issues", async () => {
    const { listIssues, projectId, slug, token, userId } = await seedIssueRollupFixture()
    const other = await seedUser('me-filter-other@example.com')
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ assigneeId: userId, projectId, title: 'Assigned to me' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Assigned to someone else', assigneeId: other.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const { page } = await listIssues('http://localhost/api/issues?assignee=me')
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('Assigned to me')
  })

  test('assignee filter still accepts a literal user id', async () => {
    const { listIssues, projectId, slug, token, workspaceId } = await seedIssueRollupFixture()
    const other = await seedUser('literal-id-filter@example.com')
    await seedMember(workspaceId, other.id)
    await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Assigned to other', assigneeId: other.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const { page } = await listIssues(`http://localhost/api/issues?assignee=${other.id}`)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('Assigned to other')
  })
})

const seedOwnerMcpFixture = async function seedOwnerMcpFixture(): Promise<
  Omit<IssueProjectFixture, 'userId'> & { mcpCall: (params: unknown) => ReturnType<typeof callMcpTool> }
> {
  const { token, slug, workspaceId, projectId }: Omit<IssueProjectFixture, 'userId'> = await seedOwnerProjectFixture()

  const mcpCall = async function mcpCall(params: unknown): ReturnType<typeof callMcpTool> {
    return callMcpTool(workspaceId, token, slug, params)
  }
  return { mcpCall, projectId, slug, token, workspaceId }
}

describe('issues MCP — typeId', () => {
  test('covers MCP create_issue with typeId persists the type', async () => {
    const { mcpCall, projectId, slug, token, workspaceId } = await seedOwnerMcpFixture()
    const { id: typeId } = await seedTaskType(workspaceId, { key: 'epic', name: 'Epic' })

    const createResp = await mcpCall({
      arguments: { projectId, title: 'Epic issue', typeId },
      name: 'create_issue',
    })
    expect(createResp.error).toBeUndefined()
    const { id } = parseNativeMcpText(readNativeMcpResultText(createResp.result), IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ type_id: Schema.String, type_key: Schema.String }))
    expect(issue.type_id).toBe(typeId)
    expect(issue.type_key).toBe('epic')
  })

  /*
   * Regression for PROJ-69: seeded default task types use 32-char hex hash IDs
   * (not dashed UUIDs). The typeId schema must accept them, or the seeded Epic
   * type can never be assigned to an issue.
   */
  test('covers MCP create_issue accepts a seeded-style 32-hex (non-UUID) typeId', async () => {
    const { mcpCall, projectId, slug, token, workspaceId } = await seedOwnerMcpFixture()
    const hashId = 'ea3df70345804c3d26ebf139816cae8f'
    const { id: typeId } = await seedTaskType(workspaceId, {
      id: hashId,
      key: 'epic',
      name: 'Epic',
    })
    expect(typeId).toBe(hashId)

    const createResp = await mcpCall({
      arguments: { projectId, title: 'Epic via hash id', typeId },
      name: 'create_issue',
    })
    expect(createResp.error).toBeUndefined()
    const { id } = parseNativeMcpText(readNativeMcpResultText(createResp.result), IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ type_id: Schema.String }))
    expect(issue.type_id).toBe(hashId)
  })

  test('covers MCP update_issue sets typeId on an existing issue', async () => {
    const { mcpCall, projectId, slug, token, workspaceId } = await seedOwnerMcpFixture()
    const { id: typeId } = await seedTaskType(workspaceId, { key: 'story', name: 'Story' })

    const createResp = await mcpCall({
      arguments: { projectId, title: 'No type yet' },
      name: 'create_issue',
    })
    const { id } = parseNativeMcpText(readNativeMcpResultText(createResp.result), IdResponse)

    const updateResp = await mcpCall({ arguments: { id, typeId }, name: 'update_issue' })
    expect(updateResp.error).toBeUndefined()

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ type_id: Schema.String }))
    expect(issue.type_id).toBe(typeId)
  })

  test('covers MCP update_issue clears typeId with null', async () => {
    const { mcpCall, projectId, slug, token, workspaceId } = await seedOwnerMcpFixture()
    const { id: typeId } = await seedTaskType(workspaceId, { key: 'bug', name: 'Bug' })

    const createResp = await mcpCall({
      arguments: { projectId, title: 'Typed issue', typeId },
      name: 'create_issue',
    })
    const { id } = parseNativeMcpText(readNativeMcpResultText(createResp.result), IdResponse)

    await mcpCall({ arguments: { id, typeId: JSON_NULL }, name: 'update_issue' })

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ type_id: Schema.Union([Schema.String, Schema.Null]) }))
    expect(issue.type_id).toBeNull()
  })

  /*
   * PROJ-571: changing an epic's type away from Epic while it still has children
   * silently orphans them from the epic UI/rollups — block it at the service layer
   * so both REST and MCP callers get the guard.
   */
  test('covers MCP update_issue rejects demoting an epic that still has children', async () => {
    const { mcpCall, projectId, slug, token, workspaceId } = await seedOwnerMcpFixture()
    const { id: epicTypeId } = await seedTaskType(workspaceId, { key: 'epic', name: 'Epic' })
    const { id: storyTypeId } = await seedTaskType(workspaceId, { key: 'story', name: 'Story' })

    const createResp = await mcpCall({
      arguments: { projectId, title: 'Parent epic', typeId: epicTypeId },
      name: 'create_issue',
    })
    const { id: epicId } = parseNativeMcpText(readNativeMcpResultText(createResp.result), IdResponse)

    await mcpCall({
      arguments: { parentId: epicId, projectId, title: 'Child of epic' },
      name: 'create_issue',
    })

    const updateResp = await mcpCall({
      arguments: { id: epicId, typeId: storyTypeId },
      name: 'update_issue',
    })
    expect(updateResp.error).toBeUndefined()
    expect(toolError(updateResp)?.code).toBe('validation')
    expect(toolError(updateResp)?.message).toContain('child issues')

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${epicId}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ type_id: Schema.String }))
    expect(issue.type_id).toBe(epicTypeId)
  })

  test('covers MCP update_issue allows retyping a non-epic parent that still has children', async () => {
    const { mcpCall, projectId, slug, token, workspaceId } = await seedOwnerMcpFixture()
    const { id: storyTypeId } = await seedTaskType(workspaceId, { key: 'story', name: 'Story' })
    const { id: bugTypeId } = await seedTaskType(workspaceId, { key: 'bug', name: 'Bug' })

    const createResp = await mcpCall({
      arguments: { projectId, title: 'Story parent', typeId: storyTypeId },
      name: 'create_issue',
    })
    const { id: parentId } = parseNativeMcpText(readNativeMcpResultText(createResp.result), IdResponse)

    await mcpCall({
      arguments: { parentId, projectId, title: 'Child of story' },
      name: 'create_issue',
    })

    const updateResp = await mcpCall({
      arguments: { id: parentId, typeId: bugTypeId },
      name: 'update_issue',
    })
    expect(updateResp.error).toBeUndefined()

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${parentId}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ type_id: Schema.String }))
    expect(issue.type_id).toBe(bugTypeId)
  })

  test("covers MCP update_issue allows changing an epic's type once it has no children", async () => {
    const { mcpCall, projectId, slug, token, workspaceId } = await seedOwnerMcpFixture()
    const { id: epicTypeId } = await seedTaskType(workspaceId, { key: 'epic', name: 'Epic' })
    const { id: storyTypeId } = await seedTaskType(workspaceId, { key: 'story', name: 'Story' })

    const createResp = await mcpCall({
      arguments: { projectId, title: 'Childless epic', typeId: epicTypeId },
      name: 'create_issue',
    })
    const { id: epicId } = parseNativeMcpText(readNativeMcpResultText(createResp.result), IdResponse)

    const updateResp = await mcpCall({
      arguments: { id: epicId, typeId: storyTypeId },
      name: 'update_issue',
    })
    expect(updateResp.error).toBeUndefined()

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${epicId}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ type_id: Schema.String }))
    expect(issue.type_id).toBe(storyTypeId)
  })

  test('covers MCP list_issues typeId filter returns only matching issues', async () => {
    const { mcpCall, projectId, workspaceId } = await seedOwnerMcpFixture()
    const { id: bugTypeId } = await seedTaskType(workspaceId, { key: 'bug', name: 'Bug' })
    const { id: storyTypeId } = await seedTaskType(workspaceId, { key: 'story', name: 'Story' })

    await mcpCall({
      arguments: { projectId, title: 'Bug issue', typeId: bugTypeId },
      name: 'create_issue',
    })
    await mcpCall({
      arguments: { projectId, title: 'Story issue', typeId: storyTypeId },
      name: 'create_issue',
    })
    await mcpCall({ arguments: { projectId, title: 'Untyped issue' }, name: 'create_issue' })

    const listResp = await mcpCall({ arguments: { typeId: bugTypeId }, name: 'list_issues' })
    expect(listResp.error).toBeUndefined()
    const page = parseNativeMcpText(readNativeMcpResultText(listResp.result), TitleItemsResponse)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('Bug issue')
  })
})

describe('issues MCP — list_issues filter parity (PROJ-243)', () => {
  test('advertises all ListIssuesSchema optional filter keys in its inputSchema', async () => {
    expect.hasAssertions()
    const { slug, token, workspaceId } = await seedOwnerMcpFixture()
    const res = await fetchNativeApi(
      `http://localhost/mcp/${workspaceId}`,
      requestOptionsWithBody(
        'POST',
        { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
        JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/list' }),
      ),
    )
    const bodyShape = Schema.Struct({
      result: Schema.Struct({
        tools: Schema.Array(
          Schema.Struct({
            inputSchema: Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) }),
            name: Schema.String,
          }),
        ).pipe(Schema.mutable),
      }),
    })
    const body = await readNativeJson(res, bodyShape)
    const listIssuesTool = body.result.tools.find((tool) => tool.name === 'list_issues')
    assert.isDefined(listIssuesTool)
    const advertised = Object.keys(listIssuesTool.inputSchema.properties)
    Iterable.forEach(Object.keys(ListIssuesSchema.shape), (key) => {
      expect(advertised).toContain(key)
    })
  })

  test('respects the noParent filter', async () => {
    const { mcpCall, projectId } = await seedOwnerMcpFixture()
    const parentResp = await mcpCall({
      arguments: { projectId, title: 'Parent issue' },
      name: 'create_issue',
    })
    const { id: parentId } = parseNativeMcpText(readNativeMcpResultText(parentResp.result), IdResponse)
    await mcpCall({
      arguments: { parentId, projectId, title: 'Child issue' },
      name: 'create_issue',
    })

    const listResp = await mcpCall({ arguments: { noParent: true }, name: 'list_issues' })
    expect(listResp.error).toBeUndefined()
    const page = parseNativeMcpText(readNativeMcpResultText(listResp.result), TitleItemsResponse)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('Parent issue')
  })
})

describe('issues KV cache', () => {
  test('getIssue: row is always fresh; rollup/custom fields come from the KV cache (PROJ-863)', async () => {
    const { projectId, slug, token } = await seedProjectFixture()
    const createRes = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        {
          Authorization: `Bearer ${token}`,
          'X-Workspace-Slug': slug,
          'Content-Type': 'application/json',
        },
        JSON.stringify({ projectId, title: 'Cache me' }),
      ),
    )
    const { id } = await readNativeJson(createRes, IdResponse)

    // First GET populates KV cache
    const first = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Workspace-Slug': slug,
        'Content-Type': 'application/json',
      },
    })
    const firstIssue = await readNativeJson(first, Schema.Struct({ title: Schema.String }))
    expect(firstIssue.title).toBe('Cache me')

    // Change the row AND add a child behind the service's back: the row is re-read
    // (fresh title), the rollup comes from the cache (child not counted yet).
    await env.DB.prepare("UPDATE issues SET title = 'D1 was read' WHERE id = ?").bind(id).run()
    await env.DB.prepare(
      `INSERT INTO issues (id, workspace_id, project_id, number, title, status, priority, labels,
			   parent_id, created_by_id, created_at, updated_at)
			 SELECT ?, workspace_id, project_id, number + 1000, 'sneaky child', 'todo', 'none', '[]',
			   id, created_by_id, created_at, updated_at FROM issues WHERE id = ?`,
    )
      .bind(crypto.randomUUID(), id)
      .run()

    // Second GET should return the cached value, not the corrupted D1 row
    const second = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Workspace-Slug': slug,
        'Content-Type': 'application/json',
      },
    })
    const secondIssue = await readNativeJson(
      second,
      Schema.Struct({ rollup: Schema.Struct({ total: Schema.Number }), title: Schema.String }),
    )
    expect(secondIssue.title).toBe('D1 was read')
    expect(secondIssue.rollup.total).toBe(0)
  })

  test('updateIssue invalidates the cache so next getIssue re-fetches from D1', async () => {
    const { projectId, slug, token } = await seedProjectFixture()
    const createRes = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        {
          Authorization: `Bearer ${token}`,
          'X-Workspace-Slug': slug,
          'Content-Type': 'application/json',
        },
        JSON.stringify({ projectId, title: 'Before update' }),
      ),
    )
    const { id } = await readNativeJson(createRes, IdResponse)

    // Warm the cache
    await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Workspace-Slug': slug,
        'Content-Type': 'application/json',
      },
    })

    // PATCH should invalidate the cache
    await fetchNativeApi(
      `http://localhost/api/issues/${id}`,
      requestOptionsWithBody(
        'PATCH',
        {
          Authorization: `Bearer ${token}`,
          'X-Workspace-Slug': slug,
          'Content-Type': 'application/json',
        },
        JSON.stringify({ title: 'After update' }),
      ),
    )

    // Next GET must reflect the new value (fetched from D1, not stale cache)
    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Workspace-Slug': slug,
        'Content-Type': 'application/json',
      },
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ title: Schema.String }))
    expect(issue.title).toBe('After update')
  })

  /*
   * PROJ-359: ref lookups ("PROJ-42", the primary MCP agent read path) resolve
   * via fetchIssueByRef rather than the id-keyed cache check at the top of
   * getIssue, so they never got any cache benefit before this fix.
   */
  test('getIssue by ref: row is always fresh; rollup/custom fields come from the KV cache (PROJ-863)', async () => {
    const { projectId, slug, token } = await seedProjectFixture()
    const createRes = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        {
          Authorization: `Bearer ${token}`,
          'X-Workspace-Slug': slug,
          'Content-Type': 'application/json',
        },
        JSON.stringify({ projectId, title: 'Cache me by ref' }),
      ),
    )
    const { id, number } = await readNativeJson(createRes, Schema.Struct({ id: Schema.String, number: Schema.Number }))
    const ref = `PROJ-${number}`

    // First GET by ref populates KV cache
    const first = await fetchNativeApi(`http://localhost/api/issues/${ref}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Workspace-Slug': slug,
        'Content-Type': 'application/json',
      },
    })
    const firstIssue = await readNativeJson(first, Schema.Struct({ title: Schema.String }))
    expect(firstIssue.title).toBe('Cache me by ref')

    // Change the row AND add a child behind the service's back: the row is re-read
    // (fresh title), the rollup comes from the cache (child not counted yet).
    await env.DB.prepare("UPDATE issues SET title = 'D1 was read' WHERE id = ?").bind(id).run()
    await env.DB.prepare(
      `INSERT INTO issues (id, workspace_id, project_id, number, title, status, priority, labels,
			   parent_id, created_by_id, created_at, updated_at)
			 SELECT ?, workspace_id, project_id, number + 1000, 'sneaky child', 'todo', 'none', '[]',
			   id, created_by_id, created_at, updated_at FROM issues WHERE id = ?`,
    )
      .bind(crypto.randomUUID(), id)
      .run()

    // Second GET by ref should return the cached value, not the corrupted D1 row
    const second = await fetchNativeApi(`http://localhost/api/issues/${ref}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Workspace-Slug': slug,
        'Content-Type': 'application/json',
      },
    })
    const secondIssue = await readNativeJson(
      second,
      Schema.Struct({ rollup: Schema.Struct({ total: Schema.Number }), title: Schema.String }),
    )
    expect(secondIssue.title).toBe('D1 was read')
    expect(secondIssue.rollup.total).toBe(0)
  })
})

describe('issues role guards', () => {
  test('viewer cannot create an issue (403)', async () => {
    const roles = await seedWorkspaceRoles()
    const project = await seedProject(roles.workspace.id)
    // PROJ-311: a viewer grant makes the project visible; the write is still denied.
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, project.id, 'viewer')

    const res = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.viewer.token, roles.workspace.slug),
        JSON.stringify({ projectId: project.id, title: 'Should fail' }),
      ),
    )
    expect(res.status).toBe(403)
  })

  test('viewer cannot update an issue (403)', async () => {
    const roles = await seedWorkspaceRoles()
    const project = await seedProject(roles.workspace.id)
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, project.id, 'viewer')

    const createRes = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ projectId: project.id, title: 'Issue to patch' }),
      ),
    )
    const { id } = await readNativeJson(createRes, IdResponse)

    const patchRes = await fetchNativeApi(
      `http://localhost/api/issues/${id}`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(roles.viewer.token, roles.workspace.slug),
        JSON.stringify({ title: 'Hacked' }),
      ),
    )
    expect(patchRes.status).toBe(403)
  })

  test('member cannot delete an issue (403)', async () => {
    const roles = await seedWorkspaceRoles()
    const project = await seedProject(roles.workspace.id)

    const createRes = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ projectId: project.id, title: 'Issue to delete' }),
      ),
    )
    const { id } = await readNativeJson(createRes, IdResponse)

    const deleteRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(roles.member.token, roles.workspace.slug),
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(403)
  })

  test('owner can delete an issue', async () => {
    const roles = await seedWorkspaceRoles()
    const project = await seedProject(roles.workspace.id)

    const createRes = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ projectId: project.id, title: 'Issue to delete' }),
      ),
    )
    const { id } = await readNativeJson(createRes, IdResponse)

    const deleteRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)
  })
})

const seedPrioritizedMcpFixture = async function seedPrioritizedMcpFixture(): Promise<
  IssueProjectFixture & {
    callPrioritized: (
      args?: Record<string, unknown>,
    ) => Promise<{ result?: { content: { text: string }[] }; error?: { code: number; message: string } }>
  }
> {
  const { token, slug, workspaceId, userId, projectId }: IssueProjectFixture = await seedProjectFixture({
    role: 'owner',
  })

  const callPrioritized = async function callPrioritized(args: Record<string, unknown> = {}) {
    const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: args, name: 'get_prioritized_issues' },
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    return res.json() as Promise<{
      result?: { content: { text: string }[] }
      error?: { code: number; message: string }
    }>
  }
  return { callPrioritized, projectId, slug, token, userId, workspaceId }
}

describe('get_prioritized_issues MCP tool', () => {
  test('returns [] (not 500) when no open issues exist', async () => {
    const { callPrioritized } = await seedPrioritizedMcpFixture()
    const body = await callPrioritized({ includeNotReady: true })
    expect(body.error).toBeUndefined()
    const data = parseNativeMcpText(
      readNativeMcpResultText(body.result),
      Schema.Struct({ issues: Schema.Array(Schema.Unknown).pipe(Schema.mutable) }),
    )
    expect(Array.isArray(data.issues)).toBe(true)
    expect(data.issues).toHaveLength(0)
  })

  test('returns non-empty array with _score fields when open issues exist', async () => {
    expect.hasAssertions()
    const { callPrioritized, projectId, userId, workspaceId } = await seedPrioritizedMcpFixture()
    await seedIssue(workspaceId, projectId, userId, { priority: 'high', title: 'High prio' })
    await seedIssue(workspaceId, projectId, userId, { priority: 'low', title: 'Low prio' })

    const body = await callPrioritized({ includeNotReady: true })
    expect(body.error).toBeUndefined()
    const data = JSON.parse(readNativeMcpResultText(body.result)) as {
      issues: {
        title: string
        _score: number
        _score_breakdown: { centrality: number; priority: number; story_points: number }
      }[]
    }
    expect(data.issues.length).toBeGreaterThan(0)
    expect(data.issues.some((issue) => issue.title === 'High prio')).toBe(true)
    Iterable.forEach(data.issues, (issue) => {
      expect(typeof issue._score).toBe('number')
      expect(issue._score_breakdown).toHaveProperty('centrality')
      expect(issue._score_breakdown).toHaveProperty('priority')
      expect(issue._score_breakdown).toHaveProperty('story_points')
    })
  })

  test('handles more open issues than a single D1 query can bind (chunked enrichment)', async () => {
    const { callPrioritized, projectId, userId, workspaceId } = await seedPrioritizedMcpFixture()
    /* The getPrioritizedIssues operation fetches every open issue, then batch-loads links + story points
     * keyed by those ids. On real D1 (100-param cap) an un-chunked load throws once there
     * are ~100 open issues; this guards the inChunks split and that results merge across
     * chunk boundaries. (SQLite's cap is higher, so this asserts correctness, not the cap.) */
    const COUNT = 105
    for (let index = 0; index < COUNT; index += 1) {
      await seedIssue(workspaceId, projectId, userId, { title: `Open ${index}`, priority: 'medium' })
    }

    const body = await callPrioritized({ includeNotReady: true, limit: 100 })
    expect(body.error).toBeUndefined()
    const data = parseNativeMcpText(readNativeMcpResultText(body.result), IssueTitlesResponse)
    expect(data.issues).toHaveLength(100)
  })

  test('excludes done and cancelled issues', async () => {
    const { callPrioritized, projectId, userId, workspaceId } = await seedPrioritizedMcpFixture()
    await seedIssue(workspaceId, projectId, userId, { title: 'Open' })
    await seedIssue(workspaceId, projectId, userId, { status: 'done', title: 'Done' })
    await seedIssue(workspaceId, projectId, userId, { status: 'cancelled', title: 'Cancelled' })

    const body = await callPrioritized({ includeNotReady: true })
    expect(body.error).toBeUndefined()
    const data = parseNativeMcpText(readNativeMcpResultText(body.result), IssueTitlesResponse)
    const titles = data.issues.map((issue) => issue.title)
    expect(titles).toContain('Open')
    expect(titles).not.toContain('Done')
    expect(titles).not.toContain('Cancelled')
  })

  test('scores issues with story points correctly (smaller SP = higher score)', async () => {
    const { callPrioritized, projectId, userId, workspaceId } = await seedPrioritizedMcpFixture()
    const field = await seedCustomFieldDef(workspaceId, {
      key: 'story_points',
      label: 'Story Points',
      type: 'number',
    })
    const small = await seedIssue(workspaceId, projectId, userId, {
      priority: 'none',
      title: 'Small',
    })
    const large = await seedIssue(workspaceId, projectId, userId, {
      priority: 'none',
      title: 'Large',
    })
    await seedCustomFieldValue(small.id, field.id, '1')
    await seedCustomFieldValue(large.id, field.id, '8')

    const body = await callPrioritized({ includeNotReady: true })
    expect(body.error).toBeUndefined()
    const data = parseNativeMcpText(
      readNativeMcpResultText(body.result),
      Schema.Struct({
        issues: Schema.Array(Schema.Struct({ _score: Schema.Number, title: Schema.String })).pipe(Schema.mutable),
      }),
    )
    const smallRow = data.issues.find((issue) => issue.title === 'Small')
    const largeRow = data.issues.find((issue) => issue.title === 'Large')
    assert.exists(largeRow)
    assert.exists(smallRow)
    expect(smallRow._score).toBeGreaterThan(largeRow._score)
  })

  // ─── PROJ-253: definition-of-ready filtering ──────────────────────────────
  test('drops not-ready issues by default, and surfaces them with includeNotReady', async () => {
    const { callPrioritized, projectId, userId, workspaceId } = await seedPrioritizedMcpFixture()
    const ready = await seedIssue(workspaceId, projectId, userId, { title: 'Ready' })
    await env.DB.prepare('UPDATE issues SET body = ? WHERE id = ?')
      .bind(
        [
          '## Acceptance criteria',
          '- Does the thing',
          '',
          '## Scope',
          '`src/thing.ts`',
          '',
          '## Verification',
          '`pnpm test`',
        ].join('\n'),
        ready.id,
      )
      .run()
    await seedIssue(workspaceId, projectId, userId, { title: 'Not ready' })

    const defaultBody = await callPrioritized()
    const defaultParsed = parseNativeMcpText(
      readNativeMcpResultText(defaultBody.result),
      Schema.Struct({
        droppedNotReady: Schema.Number,
        issues: Schema.Array(Schema.Struct({ title: Schema.String })).pipe(Schema.mutable),
      }),
    )
    const defaultTitles = defaultParsed.issues.map((issue) => issue.title)
    expect(defaultTitles).toContain('Ready')
    expect(defaultTitles).not.toContain('Not ready')
    // PROJ-291: dropped not-ready issues are surfaced as a count, not silently gone.
    expect(defaultParsed.droppedNotReady).toBeGreaterThanOrEqual(1)

    const withNotReady = await callPrioritized({ includeNotReady: true })
    const data = parseNativeMcpText(
      readNativeMcpResultText(withNotReady.result),
      Schema.Struct({
        issues: Schema.Array(
          Schema.Struct({
            missingCriteria: Schema.optional(Schema.Array(Schema.String).pipe(Schema.mutable)),
            needsGrooming: Schema.optional(Schema.Boolean),
            title: Schema.String,
          }),
        ).pipe(Schema.mutable),
      }),
    )
    const notReadyRow = data.issues.find((issue) => issue.title === 'Not ready')
    expect(notReadyRow?.needsGrooming).toBe(true)
    expect(notReadyRow?.missingCriteria).toStrictEqual(expect.arrayContaining(['acceptance criteria', 'scope/files']))
    const readyRow = data.issues.find((issue) => issue.title === 'Ready')
    expect(readyRow?.needsGrooming).toBeUndefined()
  })

  // ─── PROJ-324: projectId scoping ───────────────────────────────────────────
  test('scopes ranking to projectId, and droppedNotReady reflects only that project', async () => {
    const { callPrioritized, projectId, userId, workspaceId } = await seedPrioritizedMcpFixture()
    const otherProject = await seedProject(workspaceId, 'OTHER')
    await seedIssue(workspaceId, projectId, userId, { title: 'In target project' })
    await seedIssue(workspaceId, otherProject.id, userId, { title: 'In other project' })

    const body = await callPrioritized({ includeNotReady: true, projectId })
    expect(body.error).toBeUndefined()
    const data = parseNativeMcpText(readNativeMcpResultText(body.result), IssueTitlesResponse)
    const titles = data.issues.map((issue) => issue.title)
    expect(titles).toContain('In target project')
    expect(titles).not.toContain('In other project')
  })

  test('degrades to the ranked not-ready list when nothing passes the bar (PROJ-738)', async () => {
    const { callPrioritized, projectId, userId, workspaceId } = await seedPrioritizedMcpFixture()
    await seedIssue(workspaceId, projectId, userId, { title: 'Not ready' })

    const body = await callPrioritized()
    expect(body.error).toBeUndefined()
    const data = parseNativeMcpText(
      readNativeMcpResultText(body.result),
      Schema.Struct({
        degraded: Schema.optional(Schema.Boolean),
        droppedNotReady: Schema.Number,
        issues: Schema.Array(
          Schema.Struct({ needsGrooming: Schema.optional(Schema.Boolean), title: Schema.String }),
        ).pipe(Schema.mutable),
      }),
    )
    expect(data.issues.map((issue) => issue.title)).toContain('Not ready')
    expect(data.issues.find((issue) => issue.title === 'Not ready')?.needsGrooming).toBe(true)
    expect(data.droppedNotReady).toBe(1)
    expect(data.degraded).toBe(true)
  })

  test('computes droppedNotReady scoped to projectId', async () => {
    const { callPrioritized, projectId, userId, workspaceId } = await seedPrioritizedMcpFixture()
    const otherProject = await seedProject(workspaceId, 'OTHER')
    // Neither issue has a body, so both fail the definition-of-ready check.
    await seedIssue(workspaceId, projectId, userId, { title: 'Not ready in target' })
    await seedIssue(workspaceId, otherProject.id, userId, { title: 'Not ready in other' })

    const body = await callPrioritized({ projectId })
    expect(body.error).toBeUndefined()
    const data = parseNativeMcpText(
      readNativeMcpResultText(body.result),
      Schema.Struct({ droppedNotReady: Schema.Number }),
    )
    expect(data.droppedNotReady).toBe(1)
  })

  test('workspace-wide behavior (no projectId) is unchanged', async () => {
    const { callPrioritized, projectId, userId, workspaceId } = await seedPrioritizedMcpFixture()
    const otherProject = await seedProject(workspaceId, 'OTHER')
    await seedIssue(workspaceId, projectId, userId, { title: 'In target project' })
    await seedIssue(workspaceId, otherProject.id, userId, { title: 'In other project' })

    const body = await callPrioritized({ includeNotReady: true })
    expect(body.error).toBeUndefined()
    const data = parseNativeMcpText(readNativeMcpResultText(body.result), IssueTitlesResponse)
    const titles = data.issues.map((issue) => issue.title)
    expect(titles).toContain('In target project')
    expect(titles).toContain('In other project')
  })
})

const seedPrioritizedApiFixture = async function seedPrioritizedApiFixture(): Promise<
  IssueProjectFixture & {
    getPrioritized: (
      query?: Record<string, string>,
    ) => Promise<{ res: Response; body: { issues: { title: string }[] } }>
  }
> {
  const { token, slug, workspaceId, userId, projectId }: IssueProjectFixture = await seedProjectFixture({
    role: 'owner',
  })

  const getPrioritized = async function getPrioritized(
    query: Record<string, string> = {},
  ): Promise<{ res: Response; body: { issues: { title: string }[] } }> {
    const qs = new URLSearchParams(query).toString()
    const res = await fetchNativeApi(`http://localhost/api/issues/prioritized${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(token, slug),
    })
    return { res, body: (await res.json()) as { issues: { title: string }[] } }
  }
  return { getPrioritized, projectId, slug, token, userId, workspaceId }
}

// PROJ-633: REST parity for get_prioritized_issues
describe('handles GET /api/issues/prioritized', () => {
  test('ranks higher-priority issues first', async () => {
    const { getPrioritized, projectId, userId, workspaceId } = await seedPrioritizedApiFixture()
    await seedIssue(workspaceId, projectId, userId, { priority: 'low', title: 'Low prio' })
    await seedIssue(workspaceId, projectId, userId, { priority: 'high', title: 'High prio' })

    const { res, body } = await getPrioritized({ includeNotReady: 'true' })
    expect(res.status).toBe(200)
    /*
     * Seeded low-first so a route that returned insertion order rather than the
     * service's ranking would fail here instead of passing by coincidence.
     */
    expect(body.issues.map((issue) => issue.title)).toStrictEqual(['High prio', 'Low prio'])
  })

  /*
   * Proves query-string coercion actually happens — a route that passed the raw
   * string "3" through unparsed would fail `typeof input.limit === "number"` and
   * silently fall back to the default of 10, returning all 5 seeded issues.
   */
  test('limit is honoured', async () => {
    const { getPrioritized, projectId, userId, workspaceId } = await seedPrioritizedApiFixture()
    for (let index = 0; index < 5; index += 1) {
      await seedIssue(workspaceId, projectId, userId, { title: `Issue ${index}` })
    }

    const { res, body } = await getPrioritized({ limit: '3', includeNotReady: 'true' })
    expect(res.status).toBe(200)
    expect(body.issues).toHaveLength(3)
  })

  test('projectId scopes results to that project', async () => {
    const { getPrioritized, projectId, userId, workspaceId } = await seedPrioritizedApiFixture()
    const otherProject = await seedProject(workspaceId, 'OTHER')
    await seedIssue(workspaceId, projectId, userId, { title: 'In target project' })
    await seedIssue(workspaceId, otherProject.id, userId, { title: 'In other project' })

    const { res, body } = await getPrioritized({ projectId, includeNotReady: 'true' })
    expect(res.status).toBe(200)
    const titles = body.issues.map((issue) => issue.title)
    expect(titles).toContain('In target project')
    expect(titles).not.toContain('In other project')
  })
})

const seedIssueInputValidationFixture = async function seedIssueInputValidationFixture(): Promise<
  IssueProjectFixture & { mcpCall: (params: unknown) => ReturnType<typeof callMcpTool> }
> {
  const { token, slug, workspaceId, userId, projectId }: IssueProjectFixture = await seedProjectFixture({
    role: 'owner',
  })

  const mcpCall = async function mcpCall(params: unknown): ReturnType<typeof callMcpTool> {
    return callMcpTool(workspaceId, token, slug, params)
  }
  return { mcpCall, projectId, slug, token, userId, workspaceId }
}

describe('covers PROJ-712 — unrecognized MCP params are rejected, not silently dropped', () => {
  test('list_issues rejects an unknown param instead of ignoring it', async () => {
    const { mcpCall, projectId, userId, workspaceId } = await seedIssueInputValidationFixture()
    await seedIssue(workspaceId, projectId, userId, { title: 'Some issue' })
    const res = await mcpCall({ arguments: { projectKey: projectId }, name: 'list_issues' })
    expect(res.error).toBeUndefined()
    expect(toolError(res)?.code).toBe('validation')
  })

  test('get_issue rejects an unknown param instead of ignoring it', async () => {
    const { mcpCall, projectId } = await seedIssueInputValidationFixture()
    const createResp = await mcpCall({
      arguments: { projectId, title: 'For get_issue' },
      name: 'create_issue',
    })
    const { id } = parseNativeMcpText(readNativeMcpResultText(createResp.result), IdResponse)

    const res = await mcpCall({ arguments: { bogus: 'x', id }, name: 'get_issue' })
    expect(res.error).toBeUndefined()
    expect(toolError(res)?.code).toBe('validation')
  })

  test('create_issue_link rejects an unknown param instead of ignoring it', async () => {
    const { mcpCall, projectId } = await seedIssueInputValidationFixture()
    const rpcResponse = await mcpCall({ arguments: { projectId, title: 'A' }, name: 'create_issue' })
    const b = await mcpCall({ arguments: { projectId, title: 'B' }, name: 'create_issue' })
    const { id: aId } = parseNativeMcpText(readNativeMcpResultText(rpcResponse.result), IdResponse)
    const { id: bId } = parseNativeMcpText(readNativeMcpResultText(b.result), IdResponse)

    const res = await mcpCall({
      arguments: { extra: 'x', sourceIssueId: aId, targetIssueId: bId, type: 'blocks' },
      name: 'create_issue_link',
    })
    expect(res.error).toBeUndefined()
    expect(toolError(res)?.code).toBe('validation')
  })
})

describe('covers PROJ-713 — write tools resolve refs/keys server-side', () => {
  let token: string, slug: string, workspaceId: string, projectId: string, userId: string, projectKey: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture({
      role: 'owner',
    }))
    const row = await env.DB.prepare('SELECT key FROM projects WHERE id = ?').bind(projectId).first<{ key: string }>()
    assert.exists(row)
    projectKey = row.key
  })

  const mcpCall = async function mcpCall(params: unknown): ReturnType<typeof callMcpTool> {
    return callMcpTool(workspaceId, token, slug, params)
  }

  test('update_issue accepts a ref in place of id', async () => {
    const { number } = await seedIssue(workspaceId, projectId, userId, { title: 'Ref update' })
    const ref = `${projectKey}-${number}`

    const res = await mcpCall({
      arguments: { id: ref, title: 'Renamed via ref' },
      name: 'update_issue',
    })
    expect(res.error).toBeUndefined()

    const getRes = await mcpCall({ arguments: { ref }, name: 'get_issue' })
    const issue = parseNativeMcpText(readNativeMcpResultText(getRes.result), Schema.Struct({ title: Schema.String }))
    expect(issue.title).toBe('Renamed via ref')
  })

  test('delete_issue accepts a ref in place of id', async () => {
    const { number } = await seedIssue(workspaceId, projectId, userId, { title: 'Ref delete' })
    const ref = `${projectKey}-${number}`

    const res = await mcpCall({ arguments: { id: ref }, name: 'delete_issue' })
    expect(res.error).toBeUndefined()

    const getRes = await mcpCall({ arguments: { ref }, name: 'get_issue' })
    expect(getRes.error).toBeUndefined()
    expect(toolError(getRes)?.code).toBe('not_found')
  })

  test('create_issue_link accepts refs for sourceIssueId/targetIssueId', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'A' })
    const currentIssue = await seedIssue(workspaceId, projectId, userId, { title: 'B' })

    const res = await mcpCall({
      name: 'create_issue_link',
      arguments: {
        sourceIssueId: `${projectKey}-${issue.number}`,
        targetIssueId: `${projectKey}-${currentIssue.number}`,
        type: 'blocks',
      },
    })
    expect(res.error).toBeUndefined()

    const linksRes = await mcpCall({ name: 'list_issue_links', arguments: { issueId: issue.id } })
    const links = parseNativeMcpText(
      readNativeMcpResultText(linksRes.result),
      Schema.Array(Schema.Struct({ linkedIssueId: Schema.String })).pipe(Schema.mutable),
    )
    expect(links.map((link) => link.linkedIssueId)).toStrictEqual([currentIssue.id])
  })

  test('create_issue accepts a project key in place of projectId', async () => {
    const res = await mcpCall({
      name: 'create_issue',
      arguments: { projectId: projectKey, title: 'Via project key' },
    })
    expect(res.error).toBeUndefined()
    const { id } = parseNativeMcpText(readNativeMcpResultText(res.result), IdResponse)

    const getRes = await mcpCall({ arguments: { id, verbose: true }, name: 'get_issue' })
    const issue = parseNativeMcpText(
      readNativeMcpResultText(getRes.result),
      Schema.Struct({ project_id: Schema.String }),
    )
    expect(issue.project_id).toBe(projectId)
  })

  test('list_issues accepts a project key in place of projectId', async () => {
    await seedIssue(workspaceId, projectId, userId, { title: 'In project' })

    const res = await mcpCall({ name: 'list_issues', arguments: { projectId: projectKey } })
    expect(res.error).toBeUndefined()
    const page = parseNativeMcpText(readNativeMcpResultText(res.result), TitleItemsResponse)
    expect(page.items.map((item) => item.title)).toContain('In project')
  })

  test('an unresolvable ref returns NotFoundError, not a silent empty result', async () => {
    const res = await mcpCall({ arguments: { id: 'NOPE-1', title: 'x' }, name: 'update_issue' })
    expect(res.error).toBeUndefined()
    expect(toolError(res)?.code).toBe('not_found')
  })

  test('an unresolvable project key returns NotFoundError, not a silent empty result', async () => {
    const res = await mcpCall({
      arguments: { projectId: 'NOPE', title: 'x' },
      name: 'create_issue',
    })
    expect(res.error).toBeUndefined()
    expect(toolError(res)?.code).toBe('not_found')
  })

  test('update_issue with a parentId ref to an invisible project fails the same as an unresolvable ref', async () => {
    const roles = await seedWorkspaceRoles()
    const writableProject = await seedProject(roles.workspace.id, 'WRIT')
    await seedGroupGrant(roles.workspace.id, roles.member.user.id, writableProject.id, 'member')
    const hiddenProject = await seedProject(roles.workspace.id, 'HIDE')

    const mine = await seedIssue(roles.workspace.id, writableProject.id, roles.owner.user.id, {
      title: 'Mine',
    })
    const hidden = await seedIssue(roles.workspace.id, hiddenProject.id, roles.owner.user.id, {
      title: 'Hidden',
    })

    const missingRes = await callMcpTool(roles.workspace.id, roles.member.token, roles.workspace.slug, {
      name: 'update_issue',
      arguments: { id: mine.id, parentId: crypto.randomUUID() },
    })
    const invisibleRes = await callMcpTool(roles.workspace.id, roles.member.token, roles.workspace.slug, {
      name: 'update_issue',
      arguments: { id: mine.id, parentId: hidden.id },
    })

    expect(missingRes.error).toBeUndefined()
    expect(invisibleRes.error).toBeUndefined()
    const missingErr = toolError(missingRes)
    const invisibleErr = toolError(invisibleRes)
    expect(missingErr).toBeDefined()
    expect(invisibleErr?.code).toBe(missingErr?.code)
    expect(invisibleErr?.message).toBe(missingErr?.message)
    expect(invisibleErr?.hint).toBe(missingErr?.hint)
  })

  test("list_issues with a project key the caller can't see returns an empty page, not a 404, same as a nonexistent key", async () => {
    const roles = await seedWorkspaceRoles()
    const hiddenProject = await seedProject(roles.workspace.id, 'HIDE')
    await seedIssue(roles.workspace.id, hiddenProject.id, roles.owner.user.id, {
      title: 'Hidden',
    })

    const nonexistentRes = await callMcpTool(roles.workspace.id, roles.member.token, roles.workspace.slug, {
      arguments: { projectId: 'NOPE' },
      name: 'list_issues',
    })
    const invisibleRes = await callMcpTool(roles.workspace.id, roles.member.token, roles.workspace.slug, {
      arguments: { projectId: 'HIDE' },
      name: 'list_issues',
    })

    expect(nonexistentRes.error).toBeUndefined()
    expect(invisibleRes.error).toBeUndefined()
    const nonexistentPage = parseNativeMcpText(readNativeMcpResultText(nonexistentRes.result), ItemsResponse)
    const invisiblePage = parseNativeMcpText(readNativeMcpResultText(invisibleRes.result), ItemsResponse)
    expect(nonexistentPage.items).toStrictEqual([])
    expect(invisiblePage.items).toStrictEqual([])
  })

  test('search_issues with a visible project key returns matching results', async () => {
    const createRes = await mcpCall({
      name: 'create_issue',
      arguments: { projectId, title: 'Findable via key search' },
    })
    expect(createRes.error).toBeUndefined()

    const res = await mcpCall({
      name: 'search_issues',
      arguments: { query: 'Findable', projectId: projectKey },
    })
    expect(res.error).toBeUndefined()
    const results = parseNativeMcpText(readNativeMcpResultText(res.result), TitleItemsResponse).items
    expect(results.map((result) => result.title)).toContain('Findable via key search')
  })

  test('get_prioritized_issues with a visible project key returns results', async () => {
    await seedIssue(workspaceId, projectId, userId, {
      priority: 'urgent',
      title: 'Prioritizable',
    })

    const res = await mcpCall({
      name: 'get_prioritized_issues',
      arguments: { projectId: projectKey, includeNotReady: true },
    })
    expect(res.error).toBeUndefined()
    const { issues } = parseNativeMcpText(readNativeMcpResultText(res.result), IssueTitlesResponse)
    expect(issues.map((issue) => issue.title)).toContain('Prioritizable')
  })

  test('list_issues rejects an unrecognized param with the field name in the error', async () => {
    const res = await mcpCall({
      arguments: { parentRef: 'PROJ-1' },
      name: 'list_issues',
    })
    expect(res.error).toBeUndefined()
    expect(toolError(res)?.code).toBe('validation')
    const err = toolError(res)
    expect(`${err?.message} ${JSON.stringify(err?.fields)} ${err?.hint}`).toContain('parentRef')
  })
})

// PROJ-785: assigneeId must reference a member of the issue's workspace.
describe('issues — assignee workspace membership (PROJ-785)', () => {
  test('covers REST POST rejects an assigneeId from another workspace with 400', async () => {
    const { projectId, slug, token } = await seedOwnerMcpFixture()
    const otherFixture = await seedFixture()
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Bad assignee', assigneeId: otherFixture.user.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
    const bodyShape = Schema.Struct({
      error: Schema.Struct({
        fieldErrors: Schema.Record(Schema.String, Schema.Array(Schema.String).pipe(Schema.mutable)),
      }),
    })
    const body = await readNativeJson(res, bodyShape)
    expect(body.error.fieldErrors.assigneeId).toBeDefined()
  })

  test('covers REST POST accepts an assigneeId that is a real workspace member', async () => {
    const { projectId, slug, token, workspaceId } = await seedOwnerMcpFixture()
    const assignee = await seedUser('proj785-member@example.com')
    await seedMember(workspaceId, assignee.id)
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Good assignee', assigneeId: assignee.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
  })

  test('covers REST PATCH rejects reassigning to a user from another workspace with 400', async () => {
    const { projectId, slug, token } = await seedOwnerMcpFixture()
    const otherFixture = await seedFixture()
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'To reassign' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id } = await readNativeJson(createRes, IdResponse)

    const patchRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      body: JSON.stringify({ assigneeId: otherFixture.user.id }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(patchRes.status).toBe(400)
  })

  test('covers REST PATCH null clears the assignee without a membership check', async () => {
    const { projectId, slug, token, workspaceId } = await seedOwnerMcpFixture()
    const assignee = await seedUser('proj785-clear@example.com')
    await seedMember(workspaceId, assignee.id)
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Will be cleared', assigneeId: assignee.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id } = await readNativeJson(createRes, IdResponse)

    const patchRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      body: JSON.stringify({ assigneeId: JSON_NULL }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(patchRes.status).toBe(200)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(
      getRes,
      Schema.Struct({ assignee_id: Schema.Union([Schema.String, Schema.Null]) }),
    )
    expect(issue.assignee_id).toBeNull()
  })

  test('covers MCP create_issue rejects an assigneeId from another workspace', async () => {
    const { mcpCall, projectId } = await seedOwnerMcpFixture()
    const otherFixture = await seedFixture()
    const res = await mcpCall({
      name: 'create_issue',
      arguments: { projectId, title: 'Bad assignee via MCP', assigneeId: otherFixture.user.id },
    })
    expect(res.error).toBeUndefined()
    expect(toolError(res)?.code).toBe('validation')
    expect(toolError(res)?.fields?.assigneeId).toBeDefined()
  })

  test('covers MCP create_issue accepts a real workspace member as assignee', async () => {
    const { mcpCall, projectId, workspaceId } = await seedOwnerMcpFixture()
    const assignee = await seedUser('proj785-mcp-member@example.com')
    await seedMember(workspaceId, assignee.id)
    const res = await mcpCall({
      name: 'create_issue',
      arguments: { projectId, title: 'Good assignee via MCP', assigneeId: assignee.id },
    })
    expect(res.error).toBeUndefined()
  })

  test('covers MCP update_issue rejects reassigning to a user from another workspace', async () => {
    const { mcpCall, projectId } = await seedOwnerMcpFixture()
    const otherFixture = await seedFixture()
    const createResp = await mcpCall({
      arguments: { projectId, title: 'To reassign via MCP' },
      name: 'create_issue',
    })
    const { id } = parseNativeMcpText(readNativeMcpResultText(createResp.result), IdResponse)

    const res = await mcpCall({
      name: 'update_issue',
      arguments: { id, assigneeId: otherFixture.user.id },
    })
    expect(res.error).toBeUndefined()
    expect(toolError(res)?.code).toBe('validation')
    expect(toolError(res)?.fields?.assigneeId).toBeDefined()
  })

  test('covers MCP update_issue null clears the assignee without a membership check', async () => {
    const { mcpCall, projectId, slug, token, workspaceId } = await seedOwnerMcpFixture()
    const assignee = await seedUser('proj785-mcp-clear@example.com')
    await seedMember(workspaceId, assignee.id)
    const createResp = await mcpCall({
      name: 'create_issue',
      arguments: { projectId, title: 'Will be cleared via MCP', assigneeId: assignee.id },
    })
    const { id } = parseNativeMcpText(readNativeMcpResultText(createResp.result), IdResponse)

    const res = await mcpCall({
      arguments: { assigneeId: JSON_NULL, id },
      name: 'update_issue',
    })
    expect(res.error).toBeUndefined()

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(
      getRes,
      Schema.Struct({ assignee_id: Schema.Union([Schema.String, Schema.Null]) }),
    )
    expect(issue.assignee_id).toBeNull()
  })
})

describe('covers PROJ-931 — compact MCP responses', () => {
  let token: string, slug: string, workspaceId: string, projectId: string, userId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture({
      role: 'owner',
    }))
  })

  const mcpCall = async function mcpCall(params: unknown): ReturnType<typeof callMcpTool> {
    return callMcpTool(workspaceId, token, slug, params)
  }

  test('covers MCP tool result text is minified (no pretty-printing whitespace)', async () => {
    await seedIssue(workspaceId, projectId, userId, { title: 'Minified check' })
    const res = await mcpCall({ arguments: {}, name: 'list_issues' })
    expect(res.error).toBeUndefined()
    const text = readNativeMcpResultText(res.result)
    expect(text).not.toContain('\n')
    expect(text).not.toContain('  ')
    expect(parseNativeMcpText(text, ItemsResponse).items).toBeInstanceOf(globalThis.Array)
  })

  test('covers REST get_issue is still pretty-shaped (unaffected) and keeps null/empty fields', async () => {
    const { id } = await seedIssue(workspaceId, projectId, userId, { title: 'REST unaffected' })
    const res = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(res, Schema.Record(Schema.String, Schema.Unknown))
    // REST keeps the full shape: empty/null fields are still present.
    expect(issue.links).toStrictEqual([])
    expect(issue.customFields).toStrictEqual([])
    expect(issue).toHaveProperty('sprint_id', JSON_NULL)
    expect(issue).toHaveProperty('assignee_id', JSON_NULL)
    expect(issue).toHaveProperty('parent_id', JSON_NULL)
  })

  test('get_issue omits empty links/rollup/customFields and null sprint/assignee/parent/labels by default', async () => {
    const { id } = await seedIssue(workspaceId, projectId, userId, { title: 'Compact me' })
    const res = await mcpCall({ arguments: { id }, name: 'get_issue' })
    expect(res.error).toBeUndefined()
    const issue = parseNativeMcpText(readNativeMcpResultText(res.result), JsonRecordResponse)
    expect(issue).not.toHaveProperty('links')
    expect(issue).not.toHaveProperty('rollup')
    expect(issue).not.toHaveProperty('customFields')
    expect(issue).not.toHaveProperty('sprint_id')
    expect(issue).not.toHaveProperty('assignee_id')
    expect(issue).not.toHaveProperty('parent_id')
    expect(issue).not.toHaveProperty('labels')
    // Non-empty/non-default fields survive untouched.
    expect(issue.title).toBe('Compact me')
  })

  test('get_issue with verbose:true restores the full shape', async () => {
    const { id } = await seedIssue(workspaceId, projectId, userId, { title: 'Verbose me' })
    const res = await mcpCall({ arguments: { id, verbose: true }, name: 'get_issue' })
    expect(res.error).toBeUndefined()
    const issue = parseNativeMcpText(readNativeMcpResultText(res.result), JsonRecordResponse)
    expect(issue).toHaveProperty('links', [])
    expect(issue).toHaveProperty('rollup')
    expect(issue).toHaveProperty('customFields', [])
    expect(issue).toHaveProperty('sprint_id', JSON_NULL)
    expect(issue).toHaveProperty('assignee_id', JSON_NULL)
    expect(issue).toHaveProperty('parent_id', JSON_NULL)
  })

  test('get_issue keeps non-empty links/customFields/rollup/assignee/parent/labels', async () => {
    const assignee = await seedUser('proj931-assignee@example.com')
    await seedMember(workspaceId, assignee.id)
    const parent = await seedIssue(workspaceId, projectId, userId, { title: 'Parent' })
    const field = await seedCustomFieldDef(workspaceId, { key: 'proj931_cf', type: 'text' })
    const { id: childId } = await seedIssue(workspaceId, projectId, userId, {
      title: 'Child with everything',
      assigneeId: assignee.id,
      parentId: parent.id,
    })
    await seedCustomFieldValue(childId, field.id, 'hello')
    await mcpCall({
      arguments: { id: childId, labels: ['bug'] },
      name: 'update_issue',
    })
    await seedIssue(workspaceId, projectId, userId, { title: 'Grandchild', parentId: parent.id })

    const parentRes = await mcpCall({ name: 'get_issue', arguments: { id: parent.id } })
    const parentIssue = parseNativeMcpText(readNativeMcpResultText(parentRes.result), JsonRecordResponse)
    expect(parentIssue.rollup).toStrictEqual({
      byStatus: { backlog: 2 },
      done: 0,
      remaining: 2,
      total: 2,
    })

    const childRes = await mcpCall({ arguments: { id: childId }, name: 'get_issue' })
    const child = parseNativeMcpText(readNativeMcpResultText(childRes.result), JsonRecordResponse)
    expect(child.assignee_id).toBe(assignee.id)
    expect(child.parent_id).toBe(parent.id)
    expect(child.customFields).toStrictEqual([expect.objectContaining({ key: 'proj931_cf', value: 'hello' })])
    expect(child.labels).toStrictEqual(['bug'])
  })

  test('list_issues items are compacted the same way as get_issue', async () => {
    await seedIssue(workspaceId, projectId, userId, { title: 'Compact list item' })
    const res = await mcpCall({ arguments: { includeRollups: true }, name: 'list_issues' })
    expect(res.error).toBeUndefined()
    const page = parseNativeMcpText(readNativeMcpResultText(res.result), RecordItemsResponse)
    expect(page.items[0]).not.toHaveProperty('rollup')
    expect(page.items[0]).not.toHaveProperty('customFields')
    expect(page.items[0]).not.toHaveProperty('assignee_id')
  })

  test('fields:[...] returns only the named fields', async () => {
    const { id } = await seedIssue(workspaceId, projectId, userId, {
      priority: 'high',
      title: 'Fields test',
    })
    const res = await mcpCall({
      arguments: { fields: ['id', 'title', 'priority'], id },
      name: 'get_issue',
    })
    expect(res.error).toBeUndefined()
    const issue = parseNativeMcpText(readNativeMcpResultText(res.result), JsonRecordResponse)
    expect(Object.keys(issue).toSorted()).toStrictEqual(['id', 'priority', 'title'])
    expect(issue.title).toBe('Fields test')
  })

  test('get_issues fetches up to 50 issues in one call by ref and id', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Batch A' })
    const currentIssue = await seedIssue(workspaceId, projectId, userId, { title: 'Batch B' })
    const row = await env.DB.prepare('SELECT key FROM projects WHERE id = ?').bind(projectId).first<{ key: string }>()
    assert.exists(row)
    const ref = `${row.key}-${issue.number}`

    const res = await mcpCall({ name: 'get_issues', arguments: { refs: [ref], ids: [currentIssue.id] } })
    expect(res.error).toBeUndefined()
    const data = parseNativeMcpText(readNativeMcpResultText(res.result), TitleItemsResponse)
    const titles = data.items.map((item) => item.title).toSorted()
    expect(titles).toStrictEqual(['Batch A', 'Batch B'])
  })

  test('fields:[...] always returns every named key: real value, or null when unset', async () => {
    const { id } = await seedIssue(workspaceId, projectId, userId, { title: 'Null fields test' })
    const res = await mcpCall({
      arguments: { fields: ['id', 'assignee_id', 'sprint_id', 'links', 'rollup'], id },
      name: 'get_issue',
    })
    expect(res.error).toBeUndefined()
    const issue = parseNativeMcpText(readNativeMcpResultText(res.result), JsonRecordResponse)
    expect(Object.keys(issue).toSorted()).toStrictEqual(['assignee_id', 'id', 'links', 'rollup', 'sprint_id'])
    expect(issue.assignee_id).toBeNull()
    expect(issue.sprint_id).toBeNull()
    // Requested fields keep their real value — empty/zero is not the same as absent.
    expect(issue.links).toStrictEqual([])
    expect(issue.rollup).toMatchObject({ total: 0 })
    expect(issue.id).toBe(id)
  })

  test('get_issues rejects more than 50 combined ids', async () => {
    const ids = Array.from({ length: 51 }, () => crypto.randomUUID())
    const res = await mcpCall({ name: 'get_issues', arguments: { ids } })
    expect(res.error).toBeUndefined()
    expect(toolError(res)?.code).toBe('validation')
  })

  test('get_issues preserves request order and reports unresolved/invisible refs+ids as missing', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Order A' })
    const currentIssue = await seedIssue(workspaceId, projectId, userId, { title: 'Order B' })
    const row = await env.DB.prepare('SELECT key FROM projects WHERE id = ?').bind(projectId).first<{ key: string }>()
    assert.exists(row)
    const refA = `${row.key}-${issue.number}`
    const missingRef = `${row.key}-999999`
    const missingId = crypto.randomUUID()

    const res = await mcpCall({
      name: 'get_issues',
      arguments: { refs: [missingRef, refA], ids: [missingId, currentIssue.id] },
    })
    expect(res.error).toBeUndefined()
    const data = parseNativeMcpText(
      readNativeMcpResultText(res.result),
      Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
        missing: Schema.Array(Schema.String).pipe(Schema.mutable),
      }),
    )
    expect(data.items.map((item) => item.id)).toStrictEqual([issue.id, currentIssue.id])
    expect(data.missing).toStrictEqual([missingRef, missingId])
  })

  test("every compacting tool's description states the omission contract", () => {
    Iterable.forEach(['get_issue', 'list_issues', 'get_issues'], (name) => {
      const tool = issuesTools.find((t) => t.name === name)
      expect(tool?.description).toContain('Omitted keys are null/empty/false; pass verbose:true for the raw shape.')
    })
  })

  test('verbose/fields wrong types are rejected with a validation tool error before reaching the service', async () => {
    const { id } = await seedIssue(workspaceId, projectId, userId, { title: 'Bad opts' })
    const errorCode = (
      res: unknown,
    ): undefined | 'validation' | 'not_found' | 'forbidden' | 'conflict' | 'payload_too_large' | 'rate_limited' =>
      toolError(res)?.code

    const badVerbose = await mcpCall({ arguments: { id, verbose: 'yes' }, name: 'get_issue' })
    expect(errorCode(badVerbose)).toBe('validation')

    const badFields = await mcpCall({ arguments: { fields: 'nope', id }, name: 'get_issue' })
    expect(errorCode(badFields)).toBe('validation')

    const badFieldsList = await mcpCall({
      arguments: { fields: [1, 2] },
      name: 'list_issues',
    })
    expect(errorCode(badFieldsList)).toBe('validation')
  })

  test('covers REST GET /api/issues/batch has parity with the MCP get_issues tool', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'REST Batch A' })
    const currentIssue = await seedIssue(workspaceId, projectId, userId, { title: 'REST Batch B' })
    const res = await fetchNativeApi(`http://localhost/api/issues/batch?ids=${issue.id},${currentIssue.id}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const dataShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ title: Schema.String })).pipe(Schema.mutable),
    })
    const data = await readNativeJson(res, dataShape)
    expect(data.items.map((item) => item.title).toSorted()).toStrictEqual(['REST Batch A', 'REST Batch B'])
  })

  test('covers PROJ-931: get_issue MCP bytes drop by at least 40% vs the full pretty shape', async () => {
    /*
     * A "typical" seeded issue per the ticket: no assignee, no custom fields, no
     * children/parent, no links — exactly the empty/default fields PROJ-931 targets.
     */
    const { id } = await seedIssue(workspaceId, projectId, userId, {
      priority: 'high',
      title: 'A typical seeded issue for byte measurement',
    })

    /*
     * "Before": the full shape, pretty-printed — what every MCP tool result looked like
     * pre-PROJ-931 (REST returns exactly this shape and formatting is reproduced here).
     */
    const restRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const fullIssue = await restRes.json()
    const beforeBytes = JSON.stringify(fullIssue, undefined, 2).length

    // "After": the actual MCP get_issue tool result (minified + compacted).
    const mcpRes = await mcpCall({ arguments: { id }, name: 'get_issue' })
    const afterBytes = readNativeMcpResultText(mcpRes.result).length

    const reduction = (beforeBytes - afterBytes) / beforeBytes
    console.log(`PROJ-931 get_issue bytes: before=${beforeBytes} after=${afterBytes}`)
    expect(reduction).toBeGreaterThanOrEqual(0.4)
    // Omission must pull its own weight, not hide behind minification alone.
    expect(afterBytes).toBeLessThan(JSON.stringify(fullIssue).length * 0.8)
  })

  const projectKey = async function projectKey(): Promise<string> {
    const row = await env.DB.prepare('SELECT key FROM projects WHERE id = ?').bind(projectId).first<{ key: string }>()
    assert.exists(row)
    return row.key
  }

  test('get_issues resolves zero-padded refs like get_issue does', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Padded' })
    const padded = `${await projectKey()}-00${issue.number}`
    const res = await mcpCall({ arguments: { refs: [padded] }, name: 'get_issues' })
    const data = parseNativeMcpText(
      readNativeMcpResultText(res.result),
      Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
        missing: Schema.Array(Schema.String).pipe(Schema.mutable),
      }),
    )
    expect(data.items.map((item) => item.id)).toStrictEqual([issue.id])
    expect(data.missing).toStrictEqual([])
  })

  test('get_issues lists a repeated missing ref once', async () => {
    const ref = `${await projectKey()}-999999`
    const res = await mcpCall({ arguments: { refs: [ref, ref] }, name: 'get_issues' })
    const data = parseNativeMcpText(
      readNativeMcpResultText(res.result),
      Schema.Struct({ missing: Schema.Array(Schema.String).pipe(Schema.mutable) }),
    )
    expect(data.missing).toStrictEqual([ref])
  })

  test('get_issues omits body unless includeBody:true', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Bodied' })
    await env.DB.prepare('UPDATE issues SET body = ? WHERE id = ?').bind('hello', issue.id).run()
    const without = await mcpCall({ name: 'get_issues', arguments: { ids: [issue.id] } })
    const parsedResult = parseNativeMcpText(readNativeMcpResultText(without.result), RecordItemsResponse)
    expect(parsedResult.items[0]).not.toHaveProperty('body')
    const withBody = await mcpCall({
      name: 'get_issues',
      arguments: { ids: [issue.id], includeBody: true },
    })
    const b = parseNativeMcpText(readNativeMcpResultText(withBody.result), RecordItemsResponse)
    expect(b.items[0].body).toBe('hello')
  })

  test('fields keeps false as false and rejects unknown field names', async () => {
    const { id } = await seedIssue(workspaceId, projectId, userId, { title: 'Audit flag' })
    const ok = await mcpCall({ arguments: { fields: ['needs_audit'], id }, name: 'get_issue' })
    const issue = parseNativeMcpText(readNativeMcpResultText(ok.result), JsonRecordResponse)
    expect(issue.needs_audit).toBe(false)

    const typo = await mcpCall({ arguments: { fields: ['titel'], id }, name: 'get_issue' })
    expect(toolError(typo)?.code).toBe('validation')
    const proto = await mcpCall({ arguments: { fields: ['constructor'], id }, name: 'get_issue' })
    expect(toolError(proto)?.code).toBe('validation')
  })

  test('covers REST /api/issues/batch: refs with spaces, missing in request order, 400 over 50', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'REST ref A' })
    const key = await projectKey()
    const gone = `${key}-999999`
    const res = await fetchNativeApi(
      `http://localhost/api/issues/batch?refs=${encodeURIComponent(`${gone}, ${key}-${issue.number}`)}`,
      { headers: authHeaders(token, slug) },
    )
    expect(res.status).toBe(200)
    const dataShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
      missing: Schema.Array(Schema.String).pipe(Schema.mutable),
    })
    const data = await readNativeJson(res, dataShape)
    expect(data.items.map((item) => item.id)).toStrictEqual([issue.id])
    expect(data.missing).toStrictEqual([gone])

    const ids = Array.from({ length: 51 }, () => crypto.randomUUID()).join(',')
    const tooMany = await fetchNativeApi(`http://localhost/api/issues/batch?ids=${ids}`, {
      headers: authHeaders(token, slug),
    })
    expect(tooMany.status).toBe(400)
  })
})

describe('covers PROJ-931 — get_issues project visibility', () => {
  test('a member without a grant gets refs and ids from a hidden project as missing (MCP + REST)', async () => {
    const roles = await seedWorkspaceRoles()
    const granted = await seedProject(roles.workspace.id, 'SEEN')
    await seedGroupGrant(roles.workspace.id, roles.member.user.id, granted.id, 'member')
    const hiddenProject = await seedProject(roles.workspace.id, 'HIDN')
    const visible = await seedIssue(roles.workspace.id, granted.id, roles.owner.user.id, {
      title: 'Visible',
    })
    const hidden = await seedIssue(roles.workspace.id, hiddenProject.id, roles.owner.user.id, {
      title: 'Hidden',
    })
    const hiddenRef = `HIDN-${hidden.number}`
    const visibleRef = `SEEN-${visible.number}`

    const res = await callMcpTool(roles.workspace.id, roles.member.token, roles.workspace.slug, {
      name: 'get_issues',
      arguments: { refs: [hiddenRef, visibleRef], ids: [hidden.id] },
    })
    expect(res.error).toBeUndefined()
    const data = parseNativeMcpText(
      readNativeMcpResultText(res.result),
      Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
        missing: Schema.Array(Schema.String).pipe(Schema.mutable),
      }),
    )
    expect(data.items.map((item) => item.id)).toStrictEqual([visible.id])
    expect(data.missing).toStrictEqual([hiddenRef, hidden.id])

    const rest = await fetchNativeApi(
      `http://localhost/api/issues/batch?refs=${hiddenRef},${visibleRef}&ids=${hidden.id}`,
      { headers: authHeaders(roles.member.token, roles.workspace.slug) },
    )
    const restDataShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
      missing: Schema.Array(Schema.String).pipe(Schema.mutable),
    })
    const restData = await readNativeJson(rest, restDataShape)
    expect(restData.items.map((item) => item.id)).toStrictEqual([visible.id])
    expect(restData.missing).toStrictEqual([hiddenRef, hidden.id])
  })

  test('a ref whose key also exists in another workspace never resolves across workspaces', async () => {
    const mine = await seedWorkspaceRoles()
    const theirs = await seedWorkspaceRoles()
    await seedProject(mine.workspace.id, 'DUPE')
    const theirProject = await seedProject(theirs.workspace.id, 'DUPE')
    const theirIssue = await seedIssue(theirs.workspace.id, theirProject.id, theirs.owner.user.id, {
      title: 'Other tenant',
    })
    const ref = `DUPE-${theirIssue.number}`
    const res = await callMcpTool(mine.workspace.id, mine.owner.token, mine.workspace.slug, {
      name: 'get_issues',
      arguments: { refs: [ref], ids: [theirIssue.id] },
    })
    const data = parseNativeMcpText(
      readNativeMcpResultText(res.result),
      Schema.Struct({
        items: Schema.Array(Schema.Unknown).pipe(Schema.mutable),
        missing: Schema.Array(Schema.String).pipe(Schema.mutable),
      }),
    )
    expect(data.items).toStrictEqual([])
    expect(data.missing).toStrictEqual([ref, theirIssue.id])
  })
})
