import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vite-plus/test'

import { env } from './fixture-api'
import { authHeaders, seedFixture } from './helpers'
import { resetRateLimits } from './rate-limit-reset'

describe('native Wiki draft lifecycle preconditions', () => {
  it('rejects delayed writes after a newer snapshot and after a discard through API/Core/D1', async () => {
    const fixture = await seedFixture({ role: 'admin' })
    const headers = authHeaders(fixture.token, fixture.workspace.slug)
    async function request(path: string, init?: RequestInit) {
      await resetRateLimits()
      return SELF.fetch(`http://localhost/api/wiki${path}`, { ...init, headers })
    }
    const created = await request('', {
      method: 'POST',
      body: JSON.stringify({ title: 'Lifecycle', slug: 'lifecycle', content: 'Published' }),
    })
    expect(created.status).toBe(201)
    async function save(content: string, expectedDraftRevision: string | null) {
      return request('/lifecycle/draft', {
        method: 'PUT',
        body: JSON.stringify({ title: 'Draft', content, expectedDraftRevision }),
      })
    }
    async function revision() {
      const row = await env.DB.prepare('SELECT revision FROM wiki_draft_heads WHERE workspace_id = ? AND user_id = ?')
        .bind(fixture.workspace.id, fixture.user.id)
        .first<{ revision: string }>()
      if (!row) throw new Error('Missing persisted draft head')
      return row.revision
    }
    expect((await save('A', null)).status).toBe(200)
    const a = await revision()
    expect((await save('B', a)).status).toBe(200)
    const b = await revision()
    expect(b).not.toBe(a)
    expect((await save('Delayed A', a)).status).toBe(409)
    expect(await (await request('/lifecycle/draft')).json()).toMatchObject({ content: 'B' })
    expect((await request('/lifecycle/draft', { method: 'DELETE' })).status).toBe(200)
    expect((await save('Delayed B', b)).status).toBe(409)
    expect((await save('Delayed initial A', null)).status).toBe(409)
    expect(await (await request('/lifecycle/draft')).json()).toBeNull()
  })
})
