import { Schema, String, Predicate } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

// PROJ-857: issue list pagination + query plans.
import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedIssueFixture } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { ItemsResponse, readNativeJson } from './response-json.ts'

describe('covers PROJ-857: issue list cursor', () => {
  test('pages through 35 issues created in the same second with no gaps or duplicates', async () => {
    const testFixture = await seedIssueFixture()
    // The fixture issue plus 34 more, all stamped with the same created_at.
    const createdAt = currentEpochSeconds()
    for (let n = 2; n <= 35; n += 1) {
      await env.DB.prepare(
        `INSERT INTO issues (id, workspace_id, project_id, number, title, status, priority, labels, created_by_id, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, 'todo', 'none', '[]', ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          testFixture.workspaceId,
          testFixture.projectId,
          n,
          `same-second ${n}`,
          testFixture.userId,
          createdAt,
          createdAt,
        )
        .run()
    }
    await env.DB.prepare('UPDATE issues SET created_at = ? WHERE workspace_id = ?')
      .bind(createdAt, testFixture.workspaceId)
      .run()

    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    let firstTotal: number | null = null
    do {
      const qs = new URLSearchParams({ projectId: testFixture.projectId, limit: '10' })
      if (Predicate.isNotNullish(cursor) && String.isNonEmpty(cursor)) {
        qs.set('cursor', cursor)
      }
      const res = await fetchNativeApi(`http://localhost/api/issues?${qs}`, {
        headers: authHeaders(testFixture.token, testFixture.slug),
      })
      expect(res.status).toBe(200)
      const bodyShape = Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.mutable),
        nextCursor: Schema.Union([Schema.String, Schema.Null]),
        total: Schema.Union([Schema.Number, Schema.Null]),
      })
      const body = await readNativeJson(res, bodyShape)
      // Count only on the first page
      if (pages === 0) {
        firstTotal = body.total
      } else {
        expect(body.total).toBeNull()
      }
      seen.push(...body.items.map((item) => item.id))
      cursor = body.nextCursor
      pages += 1
    } while (Predicate.isNotNullish(cursor) && String.isNonEmpty(cursor) && pages < 10)

    expect(firstTotal).toBe(35)
    expect(seen).toHaveLength(35)
    expect(new Set(seen).size).toBe(35)
    expect(pages).toBe(4)
  })

  test('still accepts a legacy numeric cursor', async () => {
    const testFixture = await seedIssueFixture()
    const res = await fetchNativeApi(
      `http://localhost/api/issues?projectId=${testFixture.projectId}&cursor=${currentEpochSeconds() + 60}`,
      { headers: authHeaders(testFixture.token, testFixture.slug) },
    )
    expect(res.status).toBe(200)
    const body = await readNativeJson(res, ItemsResponse)
    expect(body.items).toHaveLength(1)
  })
})

describe('covers PROJ-857: hot queries use an index (no table scan, no temp sort)', () => {
  const plan = async function plan(q: string, ...binds: unknown[]): Promise<string> {
    const rows = await env.DB.prepare(`EXPLAIN QUERY PLAN ${q}`)
      .bind(...binds)
      .all<{ detail: string }>()
    return (rows.results ?? []).map((result) => result.detail).join(' | ')
  }

  test.each([
    [
      'project list',
      'SELECT id FROM issues WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC, id DESC LIMIT 31',
      ['w', 'p'],
    ],
    [
      'workspace list',
      'SELECT id FROM issues WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT 31',
      ['w'],
    ],
    [
      'issue by ref',
      'SELECT i.id FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.workspace_id = ? AND p.key = ? AND i.number = ?',
      ['w', 'PROJ', 1],
    ],
  ])('%s', async (_name, q, binds) => {
    const detail = await plan(q, ...(binds as unknown[]))
    expect(detail).not.toMatch(/TEMP B-TREE/u)
    expect(detail).not.toMatch(/SCAN (?:i|issues|p|projects)\b/)
  })
})
