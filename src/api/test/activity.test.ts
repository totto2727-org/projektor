import { describe, expect, test } from 'vite-plus/test'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { IdResponse, readNativeJson } from './response-json.ts'

describe('activity audit log', () => {
  const activityForEntity = async function activityForEntity(entityId: string) {
    const { results } = await env.DB.prepare('SELECT * FROM activity WHERE entity_id = ? ORDER BY created_at ASC')
      .bind(entityId)
      .all<{
        entity_type: string
        action: string
        actor_id: string | null
        diff: string | null
        workspace_id: string
      }>()
    return results
  }

  test('records a created row when an issue is created', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture()
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ priority: 'high', projectId, title: 'Activity test issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)

    const rows = await activityForEntity(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].entity_type).toBe('issue')
    expect(rows[0].action).toBe('created')
    expect(rows[0].workspace_id).toBe(workspaceId)
    expect(isNonEmptyText(rows[0].actor_id)).toBe(true)
  })

  test('records an updated row with diff when an issue is updated', async () => {
    const { projectId, slug, token } = await seedProjectFixture()
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Before update' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id } = await readNativeJson(createRes, IdResponse)

    const patchRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      body: JSON.stringify({ priority: 'high', status: 'in_progress' }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(patchRes.status).toBe(200)

    const rows = await activityForEntity(id)
    expect(rows).toHaveLength(2)
    const updateRow = rows[1]
    expect(updateRow.action).toBe('updated')
    const diff = JSON.parse(updateRow.diff!)
    expect(diff.status).toBe('in_progress')
    expect(diff.priority).toBe('high')
  })

  test('records a created row when a wiki page is created', async () => {
    const { slug, token } = await seedProjectFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'hello', title: 'Activity Wiki Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)

    const rows = await activityForEntity(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].entity_type).toBe('wiki_page')
    expect(rows[0].action).toBe('created')
  })

  test('records a created row when a project is created', async () => {
    await seedProjectFixture()
    // createProject requires owner or admin role
    const ownerFixture = await seedFixture({ role: 'owner' })
    const res = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody(
        'POST',
        authHeaders(ownerFixture.token, ownerFixture.workspace.slug),
        JSON.stringify({ key: 'ACTV', name: 'Activity Project' }),
      ),
    )
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)

    const rows = await activityForEntity(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].entity_type).toBe('project')
    expect(rows[0].action).toBe('created')
  })
})
