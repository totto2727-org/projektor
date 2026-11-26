import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import m0062 from '#migrations/0062_repair_zero_lead_time.sql?raw'

import { env } from './fixture-api.ts'
import { authHeaders, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { IdResponse, readNativeJson } from './response-json.ts'

type LeadTimeFixture = Pick<Awaited<ReturnType<typeof seedProjectFixture>>, 'projectId' | 'slug' | 'token'>

const create = async function create({ projectId, slug, token }: LeadTimeFixture, status: string): Promise<string> {
  const res = await fetchNativeApi('http://localhost/api/issues', {
    body: JSON.stringify({ projectId, status, title: `t-${status}` }),
    headers: authHeaders(token, slug),
    method: 'POST',
  })
  expect(res.status).toBe(201)
  const issue = await readNativeJson(res, IdResponse)
  return issue.id
}

const patch = async function patch({ slug, token }: LeadTimeFixture, id: string, status: string): Promise<void> {
  const res = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
    body: JSON.stringify({ status }),
    headers: authHeaders(token, slug),
    method: 'PATCH',
  })
  expect(res.status).toBe(200)
}

const stamps = async function stamps(id: string): Promise<{ ready_at: number | null; done_at: number | null } | null> {
  return env.DB.prepare('SELECT ready_at, done_at FROM issues WHERE id = ?')
    .bind(id)
    .first<{ ready_at: number | null; done_at: number | null }>()
}

/*
 * PROJ-921: lead time (ready -> done) came out as a 0s median because an issue moved
 * straight from backlog to done in one update got ready_at = done_at. ready_at is now
 * stamped only when an issue actually enters a ready status (including on create), and
 * issues that never did are excluded from lead time and counted separately.
 */
describe('covers PROJ-921: ready_at and lead time', () => {
  test('an issue created in todo is ready from creation', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const id = await create(testFixture, 'todo')
    const result = await stamps(id)
    expect(result?.ready_at).not.toBeNull()
  })

  test('backlog -> done in one update never passed through ready: no ready_at', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const id = await create(testFixture, 'backlog')
    await patch(testFixture, id, 'done')
    const statusStamps = await stamps(id)
    expect(statusStamps?.done_at).not.toBeNull()
    expect(statusStamps?.ready_at).toBeNull()
  })

  test('backlog -> todo and backlog -> in_progress (fast-tracked, PROJ-252) both stamp it', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const readied = await create(testFixture, 'backlog')
    await patch(testFixture, readied, 'todo')
    const resolvedValue = await stamps(readied)
    expect(resolvedValue?.ready_at).not.toBeNull()

    const fastTracked = await create(testFixture, 'backlog')
    await patch(testFixture, fastTracked, 'in_progress')
    const result = await stamps(fastTracked)
    expect(result?.ready_at).not.toBeNull()
  })

  test('an issue created already done never was ready', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const id = await create(testFixture, 'done')
    const result = await stamps(id)
    expect(result?.ready_at).toBeNull()
  })

  test('flow metrics exclude skipped-ready issues from lead time and report how many', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const { projectId, slug, token } = testFixture
    const skipped = await create(testFixture, 'backlog')
    await patch(testFixture, skipped, 'done')
    const normal = await create(testFixture, 'todo')
    await patch(testFixture, normal, 'done')

    const res = await fetchNativeApi(`http://localhost/api/projects/${projectId}/flow-metrics`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const responseBody = await readNativeJson(
      res,
      Schema.Struct({ leadTime: Schema.Struct({ count: Schema.Number }), leadTimeExcluded: Schema.Number }),
    )
    expect(responseBody.leadTime.count).toBe(1)
    expect(responseBody.leadTimeExcluded).toBe(1)
  })
})

describe('covers PROJ-921: migration 0062 clears zero lead times', () => {
  test('nulls ready_at only where it equals done_at', async () => {
    const { workspaceId, projectId, userId } = await seedProjectFixture({ role: 'owner' })
    const rows = [
      // Skipped ready
      { id: crypto.randomUUID(), ready: 100, done: 100 },
      // Real lead time
      { id: crypto.randomUUID(), ready: 50, done: 100 },
      // Still open
      { id: crypto.randomUUID(), ready: 50, done: null },
    ]
    let nextIssueNumber = 1000
    for (const row of rows) {
      await env.DB.prepare(
        `INSERT INTO issues (id, workspace_id, project_id, number, title, body, status, created_by_id, created_at, updated_at, ready_at, done_at)
				 VALUES (?, ?, ?, ?, 't', '', 'todo', ?, 0, 0, ?, ?)`,
      )
        .bind(row.id, workspaceId, projectId, nextIssueNumber++, userId, row.ready, row.done)
        .run()
    }
    const repair = m0062
      .replaceAll(/--[^\n]*/gu, '')
      .split(';')
      .map((statement) => statement.trim())
      .find((statement) => statement.startsWith('UPDATE'))
    await env.DB.prepare(repair as string).run()

    const after = await Promise.all(
      rows.map((row) =>
        env.DB.prepare('SELECT ready_at FROM issues WHERE id = ?').bind(row.id).first<{ ready_at: number | null }>(),
      ),
    )
    expect(after.map((row) => row?.ready_at)).toStrictEqual([null, 50, 50])
  })
})
