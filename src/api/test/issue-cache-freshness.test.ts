import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { getIssue } from '#commands/issues.ts'
import type { ServiceCtx } from '#commands/types.ts'
import { ApiResults } from '#contracts/api-results.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedIssue, seedIssueFixture, seedTaskStatus } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
/*
 * PROJ-863: GET of an issue never shows stale data about OTHER entities (linked
 * issues, status/type names, project key, sprint) after those change.
 */
import { IdResponse, readNativeJson } from './response-json.ts'

let fixture: Awaited<ReturnType<typeof seedIssueFixture>>
let otherId: string

const call = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetchNativeApi(
    `http://localhost${path}`,
    requestOptionsWithBody(
      method,
      authHeaders(fixture.token, fixture.slug),
      body === undefined ? undefined : JSON.stringify(body),
    ),
  )
const get = async function get(id: string): Promise<typeof ApiResults.apiGetIssue.Type> {
  const response = await call('GET', `/api/issues/${id}`)
  return readNativeJson(response, ApiResults.apiGetIssue)
}

// These tests make more calls per token than vite.config.ts's RATE_LIMIT_API_MAX.
const prevApiMax = env.RATE_LIMIT_API_MAX
beforeAll(() => {
  env.RATE_LIMIT_API_MAX = '1000'
})
afterAll(() => {
  env.RATE_LIMIT_API_MAX = prevApiMax
})

beforeEach(async () => {
  fixture = await seedIssueFixture({ role: 'owner' })
  const result = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, { title: 'Other' })
  otherId = result.id
  const link = await call('POST', `/api/issues/${fixture.issueId}/links`, {
    targetIssueId: otherId,
    type: 'blocks',
  })
  expect(link.status).toBeLessThan(300)
  // Warm the cache
  await get(fixture.issueId)
})
afterEach(() => vi.restoreAllMocks())

describe('covers PROJ-863: no stale embedded data', () => {
  test('renaming the linked issue', async () => {
    await call('PATCH', `/api/issues/${otherId}`, { title: 'Other (renamed)' })
    const result = await get(fixture.issueId)
    expect(result.links[0].linkedIssueTitle).toBe('Other (renamed)')
  })

  test("changing the linked issue's status", async () => {
    const todo = await seedTaskStatus(fixture.workspaceId, { category: 'todo' })
    const done = await seedTaskStatus(fixture.workspaceId, { category: 'done' })
    await env.DB.prepare("UPDATE issues SET status_id = ?, status_category = 'todo' WHERE id = ?")
      .bind(todo.id, otherId)
      .run()
    const resolvedValue = await get(fixture.issueId)
    expect(resolvedValue.links[0].linkedIssueStatusCategory).toBe('todo')
    await call('PATCH', `/api/issues/${otherId}`, { statusId: done.id })
    const response = await get(fixture.issueId)
    expect(response.links[0].linkedIssueStatusCategory).toBe('done')
  })

  test('deleting the linked issue', async () => {
    await call('DELETE', `/api/issues/${otherId}`)
    const response = await get(fixture.issueId)
    expect(response.links).toStrictEqual([])
  })

  test("renaming the issue's status", async () => {
    const st = await seedTaskStatus(fixture.workspaceId, { name: 'Doing' })
    await env.DB.prepare('UPDATE issues SET status_id = ? WHERE id = ?').bind(st.id, fixture.issueId).run()
    const response = await get(fixture.issueId)
    expect(response.status_name).toBe('Doing')
    await call('PATCH', `/api/task-statuses/${st.id}`, { name: 'In flight' })
    const apiResponse = await get(fixture.issueId)
    expect(apiResponse.status_name).toBe('In flight')
  })

  test('changing the project key', async () => {
    await call('PATCH', `/api/projects/${fixture.projectId}`, { key: 'NEWK' })
    const issue = await get(fixture.issueId)
    expect(issue.project_key).toBe('NEWK')
    expect(issue.url).toContain('/NEWK/')
  })

  test("deleting the issue's sprint", async () => {
    const created = await call('POST', '/api/sprints', { projectId: fixture.projectId, name: 'S1' })
    const sprint = await readNativeJson(created, IdResponse)
    expect(created.status, JSON.stringify(sprint)).toBe(201)
    await env.DB.prepare('UPDATE issues SET sprint_id = ? WHERE id = ?').bind(sprint.id, fixture.issueId).run()
    const response = await get(fixture.issueId)
    expect(response.sprint_id).toBe(sprint.id)
    const del = await call('DELETE', `/api/sprints/${sprint.id}`)
    expect(del.status, await del.text()).toBe(200)
    const after = await get(fixture.issueId)
    expect(after.sprint_id, JSON.stringify(after).slice(0, 300)).toBeNull()
  })
})

describe('covers PROJ-863: a cache hit stays cheap', () => {
  test('getIssue by ref makes <= 5 D1 queries on a hit', async () => {
    const ctx: ServiceCtx = {
      db: env.DB,
      kv: env.KV,
      r2: env.R2,
      workspaceId: fixture.workspaceId,
      userId: fixture.userId,
      role: 'owner',
    }
    const { project_key, number } = (await getIssue(ctx, { id: fixture.issueId })) as {
      project_key: string
      number: number
    }
    let queries = 0
    const orig = env.DB.prepare.bind(env.DB)
    vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      queries += 1
      return orig(sql)
    })
    await getIssue(ctx, { ref: `${project_key}-${number}` })
    expect(queries).toBeLessThanOrEqual(5)
  })
})
