import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { submitFeedback } from '#api/examples/feedback-widget-submit.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'

/*
 * Proves the maintained client example works against the real API Worker,
 * including successful persistence and rejected credentials.
 */
describe('feedback widget example', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('submitFeedback() submits to a live feedback source', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const created = await fetchNativeApi(
      `http://localhost/api/projects/${testFixture.projectId}/feedback-sources`,
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ name: 'Docs example source' }),
      ),
    )
    const { token } = (await created.json()) as { token: string }

    /*
     * The example calls the ambient global `fetch`, exactly as it would in a
     * browser; stub it to dispatch into the worker under test instead of the
     * real network.
     */
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => fetchNativeApi(url, init))

    const result = await submitFeedback('http://localhost/api/feedback/submit', token, {
      rating: 1,
      ratingScale: 'thumbs',
      body: 'Docs example works',
    })
    expect(isNonEmptyText(result.id)).toBe(true)

    const row = await env.DB.prepare('SELECT body, rating FROM feedback WHERE id = ?')
      .bind(result.id)
      .first<{ body: string; rating: number }>()
    expect(row?.body).toBe('Docs example works')
    expect(row?.rating).toBe(1)
  })

  test('submitFeedback() surfaces a thrown error on rejection (e.g. bad token)', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => fetchNativeApi(url, init))

    await expect(
      submitFeedback('http://localhost/api/feedback/submit', 'not-a-real-token', { body: 'x' }),
    ).rejects.toThrow(/Feedback submit failed: 401/u)
  })
})
