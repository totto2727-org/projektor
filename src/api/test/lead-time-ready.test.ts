import { Schema } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import m0062 from '#migrations/0062_repair_zero_lead_time.sql?raw'

import { env } from './fixture-api.ts'
import { authHeaders, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { readNativeJson } from './response-json.ts'

/*
 * PROJ-921: lead time (ready -> done) came out as a 0s median because an issue moved
 * straight from backlog to done in one update got ready_at = done_at. ready_at is now
 * stamped only when an issue actually enters a ready status (including on create), and
 * issues that never did are excluded from lead time and counted separately.
 */
describe('covers PROJ-921: ready_at and lead time', () => {
  let token: string
  let slug: string
  let projectId: string

  beforeEach(async () => {
    ;({ token, slug, projectId } = await seedProjectFixture({ role: 'owner' }))
  })

  const create = async function create(status: string): Promise<string> {
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: `t-${status}`, status }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  const patch = async function patch(id: string, status: string): Promise<void> {
    const res = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      body: JSON.stringify({ status }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(200)
  }

  const stamps = async function stamps(
    id: string,
  ): Promise<{ ready_at: number | null; done_at: number | null } | null> {
    return env.DB.prepare('SELECT ready_at, done_at FROM issues WHERE id = ?')
      .bind(id)
      .first<{ ready_at: number | null; done_at: number | null }>()
  }

  test('an issue created in todo is ready from creation', async () => {
    const id = await create('todo')
    const result = await stamps(id)
    expect(result?.ready_at).not.toBeNull()
  })

  test('backlog -> done in one update never passed through ready: no ready_at', async () => {
    const id = await create('backlog')
    await patch(id, 'done')
    const s = await stamps(id)
    expect(s?.done_at).not.toBeNull()
    expect(s?.ready_at).toBeNull()
  })

  test('backlog -> todo and backlog -> in_progress (fast-tracked, PROJ-252) both stamp it', async () => {
    const readied = await create('backlog')
    await patch(readied, 'todo')
    const resolvedValue = await stamps(readied)
    expect(resolvedValue?.ready_at).not.toBeNull()

    const fastTracked = await create('backlog')
    await patch(fastTracked, 'in_progress')
    expect((await stamps(fastTracked))?.ready_at).not.toBeNull()
  })

  test('an issue created already done never was ready', async () => {
    const id = await create('done')
    expect((await stamps(id))?.ready_at).toBeNull()
  })

  test('flow metrics exclude skipped-ready issues from lead time and report how many', async () => {
    const skipped = await create('backlog')
    await patch(skipped, 'done')
    const normal = await create('todo')
    await patch(normal, 'done')

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
      { id: crypto.randomUUID(), ready: 100, done: 100 }, // skipped ready
      { id: crypto.randomUUID(), ready: 50, done: 100 }, // real lead time
      { id: crypto.randomUUID(), ready: 50, done: null }, // still open
    ]
    let n = 1000
    for (const row of rows) {
      await env.DB.prepare(
        `INSERT INTO issues (id, workspace_id, project_id, number, title, body, status, created_by_id, created_at, updated_at, ready_at, done_at)
				 VALUES (?, ?, ?, ?, 't', '', 'todo', ?, 0, 0, ?, ?)`,
      )
        .bind(row.id, workspaceId, projectId, n++, userId, row.ready, row.done)
        .run()
    }
    const repair = m0062
      .replace(/--[^\n]*/g, '')
      .split(';')
      .map((statement) => statement.trim())
      .find((statement) => statement.startsWith('UPDATE'))
    await env.DB.prepare(repair as string).run()

    const after = await Promise.all(
      rows.map((row) =>
        env.DB.prepare('SELECT ready_at FROM issues WHERE id = ?').bind(row.id).first<{ ready_at: number | null }>(),
      ),
    )
    expect(after.map((a) => a?.ready_at)).toStrictEqual([null, 50, 50])
  })
})
