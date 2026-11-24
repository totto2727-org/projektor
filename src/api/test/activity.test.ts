import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

describe('Activity audit log', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let projectId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, projectId } = await seedProjectFixture())
  })

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
    const res = await fetchNativeApi('http://localhost/api/issues', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ projectId, title: 'Activity test issue', priority: 'high' }),
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    const rows = await activityForEntity(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].entity_type).toBe('issue')
    expect(rows[0].action).toBe('created')
    expect(rows[0].workspace_id).toBe(workspaceId)
    expect(rows[0].actor_id).toBeTruthy()
  })

  test('records an updated row with diff when an issue is updated', async () => {
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ projectId, title: 'Before update' }),
    })
    const { id } = (await createRes.json()) as { id: string }

    const patchRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ status: 'in_progress', priority: 'high' }),
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
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Activity Wiki Page', content: 'hello' }),
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    const rows = await activityForEntity(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].entity_type).toBe('wiki_page')
    expect(rows[0].action).toBe('created')
  })

  test('records a created row when a project is created', async () => {
    // createProject requires owner or admin role
    const ownerFixture = await seedFixture({ role: 'owner' })
    const res = await fetchNativeApi('http://localhost/api/projects', {
      method: 'POST',
      headers: authHeaders(ownerFixture.token, ownerFixture.workspace.slug),
      body: JSON.stringify({ name: 'Activity Project', key: 'ACTV' }),
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    const rows = await activityForEntity(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].entity_type).toBe('project')
    expect(rows[0].action).toBe('created')
  })
})
