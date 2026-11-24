import { Schema, Iterable } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { SQL_NULL } from '#db/sql-null.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedIssue, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { readNativeJson } from './response-json.ts'

const mintSource = async function mintSource(
  f: Readonly<{ projectId: string; token: string; slug: string }>,
  body: Record<string, unknown> = { name: 'Widget' },
): Promise<void> {
  await fetchNativeApi(
    `http://localhost/api/projects/${f.projectId}/feedback-sources`,
    requestOptionsWithBody('POST', authHeaders(f.token, f.slug), JSON.stringify(body)),
  )
}

const seedFeedbackRow = async function seedFeedbackRow(
  sourceId: string,
  workspaceId: string,
  projectId: string,
  opts: Readonly<{
    rating?: number
    ratingScale?: string
    body?: string
    submitterLabel?: string
    status?: string
    linkedIssueId?: string
  }> = {},
): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO feedback
       (id, source_id, workspace_id, project_id, rating, rating_scale, body, submitter_label,
        status, linked_issue_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      sourceId,
      workspaceId,
      projectId,
      opts.rating ?? SQL_NULL,
      opts.ratingScale ?? SQL_NULL,
      opts.body ?? SQL_NULL,
      opts.submitterLabel ?? SQL_NULL,
      opts.status ?? 'new',
      opts.linkedIssueId ?? SQL_NULL,
      100,
    )
    .run()
  return id
}

const firstSourceId = async function firstSourceId(projectId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
    .bind(projectId)
    .first<{ id: string }>()
  return row!.id
}

describe('handles POST /api/projects/:id/feedback/bulk-mark-reviewed', () => {
  test('marks all selected rows reviewed regardless of starting status', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await firstSourceId(testFixture.projectId)
    const id1 = await seedFeedbackRow(src, testFixture.workspaceId, testFixture.projectId, { status: 'new' })
    const id2 = await seedFeedbackRow(src, testFixture.workspaceId, testFixture.projectId, { status: 'actioned' })

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/bulk-mark-reviewed`,
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ feedbackIds: [id1, id2] }),
      ),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual({ updated: 2 })

    const rows = await env.DB.prepare('SELECT status FROM feedback WHERE id IN (?, ?)')
      .bind(id1, id2)
      .all<{ status: string }>()
    expect(rows.results.every((result) => result.status === 'reviewed')).toBe(true)
  })

  test('ignores feedbackIds from another project', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const other = await seedProjectFixture({ role: 'owner' })
    await mintSource(other)
    const otherSrc = await firstSourceId(other.projectId)
    const foreignId = await seedFeedbackRow(otherSrc, other.workspaceId, other.projectId)

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/bulk-mark-reviewed`,
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ feedbackIds: [foreignId] }),
      ),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual({ updated: 0 })

    const row = await env.DB.prepare('SELECT status FROM feedback WHERE id = ?')
      .bind(foreignId)
      .first<{ status: string }>()
    expect(row!.status).toBe('new')
  })

  test('403s for a viewer', async () => {
    const testFixture = await seedProjectFixture({ role: 'viewer' })
    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/bulk-mark-reviewed`,
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ feedbackIds: ['nonexistent'] }),
      ),
    )
    expect(res.status).toBe(403)
  })
})

describe('handles POST /api/projects/:id/feedback/bulk-convert-to-issue', () => {
  test('creates one combined issue and links all selected rows', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await firstSourceId(testFixture.projectId)
    const id1 = await seedFeedbackRow(src, testFixture.workspaceId, testFixture.projectId, {
      body: 'Love it',
      rating: 1,
      ratingScale: 'thumbs',
      submitterLabel: 'a@b.com',
    })
    const id2 = await seedFeedbackRow(src, testFixture.workspaceId, testFixture.projectId, {
      rating: -1,
      ratingScale: 'thumbs',
    })

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/bulk-convert-to-issue`,
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ feedbackIds: [id1, id2] }),
      ),
    )
    expect(res.status).toBe(201)
    const created = await readNativeJson(res, Schema.Struct({ convertedCount: Schema.Number, id: Schema.String }))
    expect(created.convertedCount).toBe(2)

    const rows = await env.DB.prepare('SELECT linked_issue_id, status FROM feedback WHERE id IN (?, ?)')
      .bind(id1, id2)
      .all<{ linked_issue_id: string; status: string }>()
    expect(rows.results).toHaveLength(2)
    Iterable.forEach(rows.results, (row) => {
      expect(row.linked_issue_id).toBe(created.id)
      expect(row.status).toBe('actioned')
    })

    const issue = await env.DB.prepare('SELECT title, body FROM issues WHERE id = ?')
      .bind(created.id)
      .first<{ title: string; body: string }>()
    expect(issue!.title).toBe('2 feedback items')
    expect(issue!.body).toContain('Love it')
    expect(issue!.body).toContain('a@b.com')
  })

  test('rejects the whole batch (creates no issue, mutates nothing) if any row is already converted', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await firstSourceId(testFixture.projectId)
    const freshId = await seedFeedbackRow(src, testFixture.workspaceId, testFixture.projectId)
    const existingIssue = await seedIssue(testFixture.workspaceId, testFixture.projectId, testFixture.userId)
    const convertedId = await seedFeedbackRow(src, testFixture.workspaceId, testFixture.projectId, {
      linkedIssueId: existingIssue.id,
      status: 'actioned',
    })

    const issueCountBefore = await env.DB.prepare('SELECT COUNT(*) as count FROM issues WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ count: number }>()

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/bulk-convert-to-issue`,
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ feedbackIds: [freshId, convertedId] }),
      ),
    )
    expect(res.status).toBe(409)

    const fresh = await env.DB.prepare('SELECT linked_issue_id, status FROM feedback WHERE id = ?')
      .bind(freshId)
      .first<{ linked_issue_id: string | null; status: string }>()
    expect(fresh!.linked_issue_id).toBeNull()
    expect(fresh!.status).toBe('new')

    const issueCountAfter = await env.DB.prepare('SELECT COUNT(*) as count FROM issues WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ count: number }>()
    expect(issueCountAfter!.count).toBe(issueCountBefore!.count)
  })

  test("404s if a feedbackId doesn't belong to the project", async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await firstSourceId(testFixture.projectId)
    const id1 = await seedFeedbackRow(src, testFixture.workspaceId, testFixture.projectId)

    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/bulk-convert-to-issue`,
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ feedbackIds: [id1, 'nonexistent-id'] }),
      ),
    )
    expect(res.status).toBe(404)
  })

  test('403s for a viewer', async () => {
    const testFixture = await seedProjectFixture({ role: 'viewer' })
    const res = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback/bulk-convert-to-issue`,
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ feedbackIds: ['nonexistent'] }),
      ),
    )
    expect(res.status).toBe(403)
  })
})
