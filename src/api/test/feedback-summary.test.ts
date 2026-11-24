import { describe, expect, test } from 'vite-plus/test'

import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

const mintSource = async function mintSource(
  f: Readonly<{ projectId: string; token: string; slug: string }>,
  body: Record<string, unknown> = { name: 'Widget' },
): Promise<string> {
  const res = await fetchNativeApi(`http://localhost/api/projects/${f.projectId}/feedback-sources`, {
    method: 'POST',
    headers: authHeaders(f.token, f.slug),
    body: JSON.stringify(body),
  })
  return ((await res.json()) as { token: string }).token
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
      opts.rating ?? null,
      opts.ratingScale ?? null,
      opts.body ?? null,
      opts.appVersion ?? null,
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

    // v1.0.0: 2 thumbs up, 1 thumbs down, 1 with a comment
    await seedFeedbackRow(src!.id, testFixture.workspaceId, testFixture.projectId, {
      rating: 1,
      ratingScale: 'thumbs',
      appVersion: 'v1.0.0',
      createdAt: 100,
    })
    await seedFeedbackRow(src!.id, testFixture.workspaceId, testFixture.projectId, {
      rating: 1,
      ratingScale: 'thumbs',
      appVersion: 'v1.0.0',
      body: 'Love it',
      createdAt: 101,
    })
    await seedFeedbackRow(src!.id, testFixture.workspaceId, testFixture.projectId, {
      rating: -1,
      ratingScale: 'thumbs',
      appVersion: 'v1.0.0',
      createdAt: 102,
    })
    // v1.1.0 (more recent): 5-star avg of 4.5
    await seedFeedbackRow(src!.id, testFixture.workspaceId, testFixture.projectId, {
      rating: 4,
      ratingScale: 'five_star',
      appVersion: 'v1.1.0',
      createdAt: 200,
    })
    await seedFeedbackRow(src!.id, testFixture.workspaceId, testFixture.projectId, {
      rating: 5,
      ratingScale: 'five_star',
      appVersion: 'v1.1.0',
      createdAt: 201,
    })

    const res = await fetchNativeApi(`http://localhost/api/projects/${testFixture.projectId}/feedback/summary`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    expect(res.status).toBe(200)
    const summary = (await res.json()) as {
      sourceId: string
      sourceName: string | null
      totalCount: number
      versions: Array<{
        appVersion: string | null
        totalCount: number
        withCommentCount: number
        thumbsUpPct: number | null
        avgFiveStar: number | null
      }>
    }[]

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
    const summary = (await res.json()) as { versions: Array<{ appVersion: string | null }> }[]
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
