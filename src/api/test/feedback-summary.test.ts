import { describe, expect, test } from 'vite-plus/test'

import { ApiResults } from '#contracts/api-results.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { SQL_NULL } from '#db/sql-null.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { TokenResponse, readNativeJson } from './response-json.ts'

const mintSource = async function mintSource(
  f: Readonly<{ projectId: string; token: string; slug: string }>,
  body: Record<string, unknown> = { name: 'Widget' },
): Promise<string> {
  const res = await fetchNativeApi(
    `http://localhost/api/projects/${f.projectId}/feedback-sources`,
    requestOptionsWithBody('POST', authHeaders(f.token, f.slug), JSON.stringify(body)),
  )
  const response = await readNativeJson(res, TokenResponse)
  return response.token
}

const seedFeedbackRow = async function seedFeedbackRow(
  sourceId: string,
  workspaceId: string,
  projectId: string,
  opts: Readonly<{
    rating?: number
    ratingScale?: string
    body?: string
    appVersion?: string
    createdAt?: number
  }> = {},
): Promise<string> {
  const id = crypto.randomUUID()
  const now = opts.createdAt ?? currentEpochSeconds()
  await env.DB.prepare(
    `INSERT INTO feedback
       (id, source_id, workspace_id, project_id, rating, rating_scale, body, app_version, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
  )
    .bind(
      id,
      sourceId,
      workspaceId,
      projectId,
      opts.rating ?? SQL_NULL,
      opts.ratingScale ?? SQL_NULL,
      opts.body ?? SQL_NULL,
      opts.appVersion ?? SQL_NULL,
      now,
    )
    .run()
  return id
}

describe('handles GET /api/projects/:id/feedback/summary', () => {
  test('aggregates thumbs %, five-star avg, and comment counts per source+version', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture, { name: 'Widget A' })
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()

    // Version v1.0.0: 2 thumbs up, 1 thumbs down, 1 with a comment
    await seedFeedbackRow(src!.id, testFixture.workspaceId, testFixture.projectId, {
      appVersion: 'v1.0.0',
      createdAt: 100,
      rating: 1,
      ratingScale: 'thumbs',
    })
    await seedFeedbackRow(src!.id, testFixture.workspaceId, testFixture.projectId, {
      appVersion: 'v1.0.0',
      body: 'Love it',
      createdAt: 101,
      rating: 1,
      ratingScale: 'thumbs',
    })
    await seedFeedbackRow(src!.id, testFixture.workspaceId, testFixture.projectId, {
      appVersion: 'v1.0.0',
      createdAt: 102,
      rating: -1,
      ratingScale: 'thumbs',
    })
    // Version v1.1.0 (more recent): 5-star avg of 4.5
    await seedFeedbackRow(src!.id, testFixture.workspaceId, testFixture.projectId, {
      appVersion: 'v1.1.0',
      createdAt: 200,
      rating: 4,
      ratingScale: 'five_star',
    })
    await seedFeedbackRow(src!.id, testFixture.workspaceId, testFixture.projectId, {
      appVersion: 'v1.1.0',
      createdAt: 201,
      rating: 5,
      ratingScale: 'five_star',
    })

    const res = await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback/summary`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    expect(res.status).toBe(200)
    const summary = await readNativeJson(res, ApiResults.apiGetFeedbackSummary)

    expect(summary).toHaveLength(1)
    expect(summary[0].sourceName).toBe('Widget A')
    expect(summary[0].totalCount).toBe(5)
    expect(summary[0].versions).toHaveLength(2)

    expect(summary[0].versions[0].appVersion).toBe('v1.1.0')
    expect(summary[0].versions[0].avgFiveStar).toBe(4.5)
    expect(summary[0].versions[0].thumbsUpPct).toBeNull()
    expect(summary[0].versions[0].withCommentCount).toBe(0)

    expect(summary[0].versions[1].appVersion).toBe('v1.0.0')
    expect(summary[0].versions[1].thumbsUpPct).toBe(67)
    expect(summary[0].versions[1].avgFiveStar).toBeNull()
    expect(summary[0].versions[1].withCommentCount).toBe(1)
  })

  test('groups rows with a null app_version under a null bucket', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    await mintSource(testFixture)
    const src = await env.DB.prepare('SELECT id FROM feedback_sources WHERE project_id = ?')
      .bind(testFixture.projectId)
      .first<{ id: string }>()
    await seedFeedbackRow(src!.id, testFixture.workspaceId, testFixture.projectId, { body: 'no version here' })

    const res = await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback/summary`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    const summary = await readNativeJson(res, ApiResults.apiGetFeedbackSummary)
    expect(summary[0].versions[0].appVersion).toBeNull()
  })

  test('404s for a caller with no project access', async () => {
    const owner = await seedProjectFixture({ role: 'owner' })
    const stranger = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi(`http://localhost/api/projects/${owner.projectId}/feedback/summary`, {
      headers: authHeaders(stranger.token, stranger.slug),
    })
    expect(res.status).toBe(404)
  })

  test('is readable by a viewer', async () => {
    const testFixture = await seedProjectFixture({ role: 'viewer' })
    const res = await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback/summary`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    expect(res.status).toBe(200)
  })

  test('returns an empty array for a project with no feedback', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback/summary`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual([])
  })
})
