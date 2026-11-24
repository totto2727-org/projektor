import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { authHeaders, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { IdResponse, readNativeJson } from './response-json.ts'

const createSource = async function createSource(
  f: Readonly<{ projectId: string; token: string; slug: string }>,
): Promise<string> {
  const res = await fetchNativeApi(
    `http://localhost/api/projects/${f.projectId}/feedback-sources`,
    requestOptionsWithBody('POST', authHeaders(f.token, f.slug), JSON.stringify({ name: 'Onboarding survey' })),
  )
  const { id } = await readNativeJson(res, IdResponse)
  return id
}

describe('handles GET /api/feedback-sources/:sourceId (PROJ-724)', () => {
  test('returns the source including projectId', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const sourceId = await createSource(testFixture)

    const res = await fetchNativeApi(`http://localhost/api/feedback-sources/${sourceId}`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(
      res,
      Schema.Struct({ id: Schema.String, name: Schema.String, projectId: Schema.String }),
    )
    expect(body.id).toBe(sourceId)
    expect(body.projectId).toBe(testFixture.projectId)
    expect(body.name).toBe('Onboarding survey')
  })

  test('404s for an unknown sourceId', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi(`http://localhost/api/feedback-sources/${crypto.randomUUID()}`, {
      headers: authHeaders(testFixture.token, testFixture.slug),
    })
    expect(res.status).toBe(404)
  })

  test('404s (not leaks) a source from another workspace', async () => {
    const owner = await seedProjectFixture({ role: 'owner' })
    const sourceId = await createSource(owner)

    const outsider = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi(`http://localhost/api/feedback-sources/${sourceId}`, {
      headers: authHeaders(outsider.token, outsider.slug),
    })
    expect(res.status).toBe(404)
  })
})
