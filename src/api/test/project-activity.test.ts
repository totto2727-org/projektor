import { Data, Iterable, Predicate, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { ApiResults } from '#contracts/api-results.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { SQL_NULL } from '#db/sql-null.ts'
import { runIndexedInOrder } from '#tests/run-effect.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedComment, seedIssue, seedProject, seedProjectFixture, toolError } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { JsonListResponse, McpRpcResponse, parseNativeMcpText, readNativeJson } from './response-json.ts'

const ActivityPage = Schema.Struct({ items: ApiResults.apiListProjectActivity })

class ProjectActivityRpcError extends Data.TaggedError('ProjectActivityRpcError')<Readonly<{ message: string }>> {}

const mcpCall = async function mcpCall(
  workspaceId: string,
  toolName: string,
  args: unknown,
  headers: Record<string, string>,
): Promise<typeof McpRpcResponse.Type> {
  const res = await fetchNativeApi(
    `http://localhost/mcp/${workspaceId}`,
    requestOptionsWithBody(
      'POST',
      headers,
      JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: args, name: toolName },
      }),
    ),
  )
  return readNativeJson(res, McpRpcResponse)
}

const parseEvents = function parseEvents(res: typeof McpRpcResponse.Type): typeof ActivityPage.Type.items {
  if (res.error) {
    throw new ProjectActivityRpcError({ message: `MCP error: ${res.error.message}` })
  }
  const text = res.result?.content?.[0]?.text
  if (!Predicate.isString(text)) {
    throw new ProjectActivityRpcError({ message: 'Expected the project activity result to contain a first text item.' })
  }
  return parseNativeMcpText(text, ActivityPage).items
}

const seedSprint = async function seedSprint(
  workspaceId: string,
  projectId: string,
  opts: Readonly<{ name?: string; status?: string; startDate?: number; endDate?: number }> = {},
) {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await env.DB.prepare(
    `INSERT INTO sprints (id, workspace_id, project_id, name, status, start_date, end_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      projectId,
      opts.name ?? 'Sprint 1',
      opts.status ?? 'planned',
      opts.startDate ?? SQL_NULL,
      opts.endDate ?? SQL_NULL,
      now,
      now,
    )
    .run()
  return { id, name: opts.name ?? 'Sprint 1' }
}

const seedWikiPage = async function seedWikiPage(
  workspaceId: string,
  projectId: string,
  authorId: string,
  opts: Readonly<{ title?: string; slug?: string; updatedAt?: number; deletedAt?: number }> = {},
) {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  const slug = opts.slug ?? (opts.title ?? 'test-page').toLowerCase().replaceAll(/\s+/gu, '-')
  const updatedAt = opts.updatedAt ?? now
  await env.DB.prepare(
    `INSERT INTO wiki_pages (id, workspace_id, project_id, slug, title, content, created_by_id, updated_by_id,
       created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      projectId,
      slug,
      opts.title ?? 'Test Page',
      authorId,
      authorId,
      now,
      updatedAt,
      opts.deletedAt ?? SQL_NULL,
    )
    .run()
  return { id, slug }
}

describe('list_project_activity MCP tool', () => {
  type TestData = Readonly<{
    headers: Record<string, string>
    projectId: string
    slug: string
    token: string
    userId: string
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const { token, slug, workspaceId, userId, projectId } = await seedProjectFixture()
    const headers = authHeaders(token, slug)
    return { headers, projectId, slug, token, userId, workspaceId }
  }

  test('returns empty array when project has no activity', async () => {
    const { headers, projectId, workspaceId } = await seedTestData()
    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)
    expect(Array.isArray(events)).toBe(true)
    expect(events).toHaveLength(0)
  })

  test('returns issue_created events', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    await seedIssue(workspaceId, projectId, userId, { title: 'My Issue' })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)

    const created = events.filter((selectedEvent) => selectedEvent.type === 'issue_created')
    expect(created).toHaveLength(1)
    expect(created[0].summary).toBe('My Issue')
    expect(created[0].entity_type).toBe('issue')
    expect(created[0].entity_ref).toMatch(/^PROJ-\d+$/u)
    expect(created[0].created_at).toSatisfy(Predicate.isNumber)
  })

  test('returns issue_commented events', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    const issue = await seedIssue(workspaceId, projectId, userId)
    await seedComment(issue.id, userId, 'Hello world')

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)

    const commented = events.filter((selectedEvent) => selectedEvent.type === 'issue_commented')
    expect(commented).toHaveLength(1)
    expect(commented[0].actor).toBe(userId)
  })

  test('returns wiki_page_created events', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    await seedWikiPage(workspaceId, projectId, userId, { title: 'Design Doc' })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)

    const wikiCreated = events.filter((selectedEvent) => selectedEvent.type === 'wiki_page_created')
    expect(wikiCreated).toHaveLength(1)
    expect(wikiCreated[0].summary).toBe('Design Doc')
    expect(wikiCreated[0].entity_type).toBe('wiki_page')
    expect(wikiCreated[0].entity_ref).toBe('design-doc')
  })

  test('returns wiki_page_edited events when updated_at differs from created_at', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    await seedWikiPage(workspaceId, projectId, userId, {
      title: 'Edited Doc',
      updatedAt: currentEpochSeconds() + 10,
    })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)

    const edited = events.filter((selectedEvent) => selectedEvent.type === 'wiki_page_edited')
    expect(edited).toHaveLength(1)
  })

  test('does not return wiki_page_edited when page was never updated', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    await seedWikiPage(workspaceId, projectId, userId, { title: 'Untouched' })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)

    const edited = events.filter((selectedEvent) => selectedEvent.type === 'wiki_page_edited')
    expect(edited).toHaveLength(0)
  })

  test('excludes trashed wiki pages from wiki_page_created/wiki_page_edited events', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    await seedWikiPage(workspaceId, projectId, userId, {
      title: 'Trashed Doc',
      deletedAt: currentEpochSeconds(),
      updatedAt: currentEpochSeconds() + 10,
    })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)

    expect(events.some((selectedEvent) => selectedEvent.type === 'wiki_page_created')).toBe(false)
    expect(events.some((selectedEvent) => selectedEvent.type === 'wiki_page_edited')).toBe(false)
  })

  test('returns sprint_started events for active sprints with a start_date', async () => {
    const { headers, projectId, workspaceId } = await seedTestData()
    const now = currentEpochSeconds()
    await seedSprint(workspaceId, projectId, {
      name: 'Sprint Alpha',
      startDate: now,
      status: 'active',
    })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)

    const started = events.filter((selectedEvent) => selectedEvent.type === 'sprint_started')
    expect(started).toHaveLength(1)
    expect(started[0].summary).toContain('Sprint Alpha')
    expect(started[0].entity_type).toBe('sprint')
  })

  test('returns sprint_completed events for completed sprints', async () => {
    const { headers, projectId, workspaceId } = await seedTestData()
    const now = currentEpochSeconds()
    await seedSprint(workspaceId, projectId, {
      name: 'Sprint Beta',
      status: 'completed',
      startDate: now - 100,
      endDate: now,
    })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)

    const completed = events.filter((selectedEvent) => selectedEvent.type === 'sprint_completed')
    expect(completed).toHaveLength(1)
    expect(completed[0].summary).toContain('Sprint Beta')

    const started = events.filter((selectedEvent) => selectedEvent.type === 'sprint_started')
    expect(started).toHaveLength(1)
  })

  test('respects the limit parameter', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    await runIndexedInOrder(5, async (index): Promise<void> => {
      await seedIssue(workspaceId, projectId, userId, { title: `Issue ${index}` })
    })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId, limit: 2 }, headers)
    const events = parseEvents(res)
    expect(events).toHaveLength(2)
  })

  test('respects the since filter', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    const past = currentEpochSeconds() - 3600
    await seedIssue(workspaceId, projectId, userId, { title: 'Old issue', createdAt: past - 1 })
    await seedIssue(workspaceId, projectId, userId, { title: 'New issue' })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId, since: past }, headers)
    const events = parseEvents(res)

    const titles = events.map((selectedEvent) => selectedEvent.summary)
    expect(titles).toContain('New issue')
    expect(titles).not.toContain('Old issue')
  })

  test('returns events ordered most-recent first', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    const base = currentEpochSeconds() - 100
    await seedIssue(workspaceId, projectId, userId, { createdAt: base, title: 'Older' })
    await seedIssue(workspaceId, projectId, userId, { title: 'Newer', createdAt: base + 50 })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)

    const created = events.filter(
      (selectedEvent) => selectedEvent.summary === 'Older' || selectedEvent.summary === 'Newer',
    )
    expect(created[0].summary).toBe('Newer')
    expect(created[1].summary).toBe('Older')
  })

  test('scopes events to the given project and not other projects', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    const other = await seedProject(workspaceId, 'OTHER')
    await seedIssue(workspaceId, other.id, userId, { title: 'Other project issue' })
    await seedIssue(workspaceId, projectId, userId, { title: 'This project issue' })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)

    const summaries = events.map((selectedEvent) => selectedEvent.summary)
    expect(summaries).toContain('This project issue')
    expect(summaries).not.toContain('Other project issue')
  })

  test('returns error for unknown project', async () => {
    const { headers, workspaceId } = await seedTestData()
    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId: crypto.randomUUID() }, headers)
    const err = toolError(res)
    expect(err?.code).toBe('not_found')
    expect(err?.message).toMatch(/not found/iu)
  })

  test('returns error when projectId is missing', async () => {
    const { headers, workspaceId } = await seedTestData()
    const res = await mcpCall(workspaceId, 'list_project_activity', {}, headers)
    expect(toolError(res)?.code).toBe('validation')
  })

  test('response shape is flat (no nested objects)', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    await seedIssue(workspaceId, projectId, userId, { title: 'Flat check' })

    const res = await mcpCall(workspaceId, 'list_project_activity', { projectId }, headers)
    const events = parseEvents(res)

    Iterable.forEach(events, (event) => {
      Iterable.forEach(Object.values(event), (val) => {
        expect(Predicate.isObject(val)).toBe(false)
      })
    })
  })
})

describe('handles GET /api/projects/:id/activity (PROJ-245)', () => {
  type TestData = Readonly<{
    headers: Record<string, string>
    projectId: string
    slug: string
    token: string
    userId: string
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const { token, slug, workspaceId, userId, projectId } = await seedProjectFixture()
    const headers = authHeaders(token, slug)
    return { headers, projectId, slug, token, userId, workspaceId }
  }

  test('returns empty array when project has no activity', async () => {
    const { headers, projectId } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/projects/${projectId}/activity`, {
      headers,
    })
    expect(res.status).toBe(200)
    const events = await readNativeJson(res, JsonListResponse)
    expect(events).toStrictEqual([])
  })

  test("returns issue_created events, matching the MCP tool's behavior", async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    await seedIssue(workspaceId, projectId, userId, { title: 'REST activity issue' })

    const res = await fetchNativeApi(`http://localhost/api/projects/${projectId}/activity`, {
      headers,
    })
    expect(res.status).toBe(200)
    const events = await readNativeJson(res, ApiResults.apiListProjectActivity)
    const created = events.filter((selectedEvent) => selectedEvent.type === 'issue_created')
    expect(created).toHaveLength(1)
    expect(created[0].summary).toBe('REST activity issue')
  })

  test('respects the limit query param', async () => {
    const { headers, projectId, userId, workspaceId } = await seedTestData()
    await runIndexedInOrder(5, async (index): Promise<void> => {
      await seedIssue(workspaceId, projectId, userId, { title: `Issue ${index}` })
    })

    const res = await fetchNativeApi(`http://localhost/api/projects/${projectId}/activity?limit=2`, {
      headers,
    })
    const events = await readNativeJson(res, JsonListResponse)
    expect(events).toHaveLength(2)
  })

  test('returns 404 for an unknown project', async () => {
    const { headers } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/projects/${crypto.randomUUID()}/activity`, {
      headers,
    })
    expect(res.status).toBe(404)
  })
})
