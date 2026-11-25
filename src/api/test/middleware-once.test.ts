/*
 * PROJ-856: auth + workspace middleware must run exactly once per request, including on
 * bare collection paths. Hono's `/x/*` also matches `/x`, so registering both `/x` and
 * `/x/*` ran the pair twice. Observe only the middleware's named authenticate
 * dispatch. Domain operations must still independently reauthorize inside Core.
 */
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { getCoreObservations, resetCoreObservations } from './fixture-api.ts'
import { authHeaders, seedIssueFixture } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'

describe('covers PROJ-856: middleware runs once per request', () => {
  let fixture: Awaited<ReturnType<typeof seedIssueFixture>>
  beforeEach(async () => {
    fixture = await seedIssueFixture()
    await resetCoreObservations()
  })

  test.each([
    ['GET', '/api/issues'],
    ['GET', '/api/wiki'],
    ['GET', '/api/sprints'],
    ['GET', '/api/task-types'],
    ['GET', '/api/task-statuses'],
    ['GET', '/api/custom-fields'],
    ['GET', '/api/files'],
  ])('%s %s authenticates once', async (method, path) => {
    const res = await fetchNativeApi(`http://localhost${path}`, {
      headers: authHeaders(fixture.token, fixture.slug),
      method,
    })
    expect([401, 403]).not.toContain(res.status)
    const result = await getCoreObservations()
    expect(result.authenticateCalls).toBe(1)
  })

  test('handles GET /api/issues/:id authenticates once', async () => {
    const res = await fetchNativeApi(`http://localhost/api/issues/${fixture.issueId}`, {
      headers: authHeaders(fixture.token, fixture.slug),
    })
    expect(res.status).toBe(200)
    const resolvedValue = await getCoreObservations()
    expect(resolvedValue.authenticateCalls).toBe(1)
  })

  test('handles GET /api/workspaces/:slug authenticates once', async () => {
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${fixture.slug}`, {
      headers: authHeaders(fixture.token, fixture.slug),
    })
    expect([401, 403]).not.toContain(res.status)
    const observations = await getCoreObservations()
    expect(observations.authenticateCalls).toBe(1)
  })

  test('handles POST /api/issues authenticates once', async () => {
    const res = await fetchNativeApi(
      'http://localhost/api/issues',
      requestOptionsWithBody(
        'POST',
        authHeaders(fixture.token, fixture.slug),
        JSON.stringify({ projectId: fixture.projectId, title: 'once' }),
      ),
    )
    expect(res.status).toBe(201)
    const observations = await getCoreObservations()
    expect(observations.authenticateCalls).toBe(1)
  })

  test.each(['/api/issues', '/api/wiki', '/api/files', '/api/sprints'])(
    'bare %s without credentials is still 401',
    async (path) => {
      const res = await fetchNativeApi(`http://localhost${path}`)
      expect(res.status).toBe(401)
    },
  )
})
