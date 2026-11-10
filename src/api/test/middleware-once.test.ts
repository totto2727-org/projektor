// PROJ-856: auth + workspace middleware must run exactly once per request, including on
// bare collection paths. Hono's `/x/*` also matches `/x`, so registering both `/x` and
// `/x/*` ran the pair twice. Observe only the middleware's named authenticate
// dispatch. Domain operations must still independently reauthorize inside Core.

import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { getCoreObservations, resetCoreObservations } from './fixture-api'
import { authHeaders, seedIssueFixture } from './helpers'

describe('PROJ-856: middleware runs once per request', () => {
  let f: Awaited<ReturnType<typeof seedIssueFixture>>
  beforeEach(async () => {
    f = await seedIssueFixture()
    await resetCoreObservations()
  })

  it.each([
    ['GET', '/api/issues'],
    ['GET', '/api/wiki'],
    ['GET', '/api/sprints'],
    ['GET', '/api/task-types'],
    ['GET', '/api/task-statuses'],
    ['GET', '/api/custom-fields'],
    ['GET', '/api/files'],
  ])('%s %s authenticates once', async (method, path) => {
    const res = await SELF.fetch(`http://localhost${path}`, {
      method,
      headers: authHeaders(f.token, f.slug),
    })
    expect([401, 403]).not.toContain(res.status)
    expect((await getCoreObservations()).authenticateCalls).toBe(1)
  })

  it('GET /api/issues/:id authenticates once', async () => {
    const res = await SELF.fetch(`http://localhost/api/issues/${f.issueId}`, {
      headers: authHeaders(f.token, f.slug),
    })
    expect(res.status).toBe(200)
    expect((await getCoreObservations()).authenticateCalls).toBe(1)
  })

  it('GET /api/workspaces/:slug authenticates once', async () => {
    const res = await SELF.fetch(`http://localhost/api/workspaces/${f.slug}`, {
      headers: authHeaders(f.token, f.slug),
    })
    expect([401, 403]).not.toContain(res.status)
    expect((await getCoreObservations()).authenticateCalls).toBe(1)
  })

  it('POST /api/issues authenticates once', async () => {
    const res = await SELF.fetch('http://localhost/api/issues', {
      method: 'POST',
      headers: authHeaders(f.token, f.slug),
      body: JSON.stringify({ projectId: f.projectId, title: 'once' }),
    })
    expect(res.status).toBe(201)
    expect((await getCoreObservations()).authenticateCalls).toBe(1)
  })

  it.each(['/api/issues', '/api/wiki', '/api/files', '/api/sprints'])(
    'bare %s without credentials is still 401',
    async (path) => {
      const res = await SELF.fetch(`http://localhost${path}`)
      expect(res.status).toBe(401)
    },
  )
})
