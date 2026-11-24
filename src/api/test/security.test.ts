import { describe, expect, test } from 'vite-plus/test'

import { seedFixture, seedMember } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

describe('PROJ-16: API token workspace scope', () => {
  test('rejects a token for workspace A used against workspace B, even when the user is a member of both', async () => {
    const wsA = await seedFixture()
    const wsB = await seedFixture()
    // Make wsA's user a member of wsB so the only rejection reason is the token's workspace scope
    await seedMember(wsB.workspace.id, wsA.user.id)

    const res = await fetchNativeApi('http://localhost/api/issues', {
      headers: {
        Authorization: `Bearer ${wsA.token}`,
        'X-Workspace-Slug': wsB.workspace.slug,
      },
    })
    expect(res.status).toBe(403)
  })

  test('allows a valid token used against its own workspace', async () => {
    const fixture = await seedFixture()
    const res = await fetchNativeApi('http://localhost/api/issues', {
      headers: {
        Authorization: `Bearer ${fixture.token}`,
        'X-Workspace-Slug': fixture.workspace.slug,
      },
    })
    expect(res.status).toBe(200)
  })
})

/*
 * Vite.config.ts sets ENVIRONMENT=development and BOOTSTRAP_SECRET=test-bootstrap-secret-...
 * Tests cover the secret-validation path; the "non-development env → 403" invariant is
 * enforced by the `!== 'development'` guard in worker.ts (fail-closed, not opt-in-to-block).
 */
describe('PROJ-18: /bootstrap fail-closed', () => {
  const CORRECT_SECRET = 'test-bootstrap-secret-do-not-use-in-production'

  test('returns 403 when no setup secret is provided', async () => {
    const res = await fetchNativeApi('http://localhost/bootstrap')
    expect(res.status).toBe(403)
  })

  test('returns 403 when a wrong secret is provided via header', async () => {
    const res = await fetchNativeApi('http://localhost/bootstrap', {
      headers: { 'X-Bootstrap-Secret': 'not-the-right-secret' },
    })
    expect(res.status).toBe(403)
  })

  test('returns 403 when a wrong secret is provided via query param', async () => {
    const res = await fetchNativeApi('http://localhost/bootstrap?setup_secret=wrong')
    expect(res.status).toBe(403)
  })

  test('returns 200 and mints a token when correct secret is in X-Bootstrap-Secret header', async () => {
    const res = await fetchNativeApi('http://localhost/bootstrap', {
      headers: { 'X-Bootstrap-Secret': CORRECT_SECRET },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      token: string
      workspace: { slug: string }
      user: { email: string }
    }
    expect(body.token).toMatch(/^pk_/)
    expect(body.workspace.slug).toBe('projektor')
  })

  test('returns 200 when correct secret is provided via setup_secret query param', async () => {
    const res = await fetchNativeApi(`http://localhost/bootstrap?setup_secret=${CORRECT_SECRET}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string }
    expect(body.token).toMatch(/^pk_/)
  })
})
