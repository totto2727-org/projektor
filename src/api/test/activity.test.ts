import { assert, describe, expect, test } from 'vite-plus/test'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { IdResponse, readNativeJson } from './response-json.ts'

interface ActivityRow {
  entity_type: string
  action: string
  actor_id: string | null
  diff: string | null
  workspace_id: string
}

describe('activity audit log', () => {
  const activityForEntity = async function activityForEntity(entityId: string): Promise<ActivityRow[]> {
    const { results } = await env.DB.prepare('SELECT * FROM activity WHERE entity_id = ? ORDER BY created_at ASC')
      .bind(entityId)
      .all<ActivityRow>()
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
    expect(rows[0]).toMatchObject({ action: 'created', entity_type: 'issue', workspace_id: workspaceId })
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
    const { diff } = updateRow
    assert.isNotNull(diff)
    expect(JSON.parse(diff)).toMatchObject({ priority: 'high', status: 'in_progress' })
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
    expect(rows[0]).toMatchObject({ action: 'created', entity_type: 'wiki_page' })
  })

  test('records a created row when a project is created', async () => {
    await seedProjectFixture()
    // The createProject operation requires owner or admin role
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
    expect(rows[0]).toMatchObject({ action: 'created', entity_type: 'project' })
  })
})
