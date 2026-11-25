import { describe, expect, test } from 'vite-plus/test'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture } from './helpers.ts'
import { stringifyOrderedFields, fetchNativeApi } from './native-fetch.ts'
import { resetRateLimits } from './rate-limit-reset.ts'

const PUBLISHED_PAGE_BODY = stringifyOrderedFields([
  ['title', 'Lifecycle'],
  ['slug', 'lifecycle'],
  ['content', 'Published'],
])

describe('native Wiki draft lifecycle preconditions', () => {
  test('rejects delayed writes after a newer snapshot and after a discard through API/Core/D1', async () => {
    const fixture = await seedFixture({ role: 'admin' })
    const headers = authHeaders(fixture.token, fixture.workspace.slug)
    const request = async function request(path: string, init?: RequestInit): Promise<Response> {
      await resetRateLimits()
      return fetchNativeApi(`http://localhost/api/wiki${path}`, { ...init, headers })
    }
    const created = await request('', {
      method: 'POST',
      body: PUBLISHED_PAGE_BODY,
    })
    expect(created.status).toBe(201)
    const save = async function save(content: string, expectedDraftRevision: string | null): Promise<Response> {
      return request('/lifecycle/draft', {
        method: 'PUT',
        body: stringifyOrderedFields([
          ['title', 'Draft'],
          ['content', content],
          ['expectedDraftRevision', expectedDraftRevision],
        ]),
      })
    }
    const revision = async function revision(): Promise<string> {
      const row = await env.DB.prepare('SELECT revision FROM wiki_draft_heads WHERE workspace_id = ? AND user_id = ?')
        .bind(fixture.workspace.id, fixture.user.id)
        .first<{ revision: string }>()
      if (!row) {
        throw new Error('Missing persisted draft head')
      }
      return row.revision
    }
    const result = await save('A', null)
    expect(result.status).toBe(200)
    const a = await revision()
    const resolvedValue = await save('B', a)
    expect(resolvedValue.status).toBe(200)
    const b = await revision()
    expect(b).not.toBe(a)
    const response = await save('Delayed A', a)
    expect(response.status).toBe(409)
    const apiResponse = await request('/lifecycle/draft')
    await expect(apiResponse.json()).resolves.toMatchObject({ content: 'B' })
    await expect(request('/lifecycle/draft', { method: 'DELETE' })).resolves.toHaveProperty('status', 200)
    await expect(save('Delayed B', b)).resolves.toHaveProperty('status', 409)
    await expect(save('Delayed initial A', null)).resolves.toHaveProperty('status', 409)
    await expect((await request('/lifecycle/draft')).json()).resolves.toBeNull()
  })
})
