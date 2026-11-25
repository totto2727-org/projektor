import { describe, expect, test } from 'vite-plus/test'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture, seedGroupGrant, seedMember, seedProject, seedToken, seedUser } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { resetRateLimits } from './rate-limit-reset.ts'
import { IdResponse, readNativeJson } from './response-json.ts'

type WatcherFixture = Readonly<{
  createPage: (body: Record<string, unknown>) => Promise<string>
  edit: (pageId: string, content: string) => Promise<void>
  notificationCount: () => Promise<number>
  slug: string
  watch: (pageId: string) => Promise<void>
  watcherId: string
  watcherToken: string
  workspaceId: string
}>

const seedWatcherFixture = async function seedWatcherFixture(): Promise<WatcherFixture> {
  const fixture = await seedFixture({ role: 'admin' })
  const adminToken = fixture.token
  const slug = fixture.workspace.slug
  const workspaceId = fixture.workspace.id
  const watcher = await seedUser(`w-${crypto.randomUUID().slice(0, 8)}@example.com`)
  const watcherId = watcher.id
  await seedMember(workspaceId, watcherId, 'member')
  const watcherToken = await seedToken(workspaceId, watcherId)

  const createPage = async function createPage(body: Record<string, unknown>): Promise<string> {
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify(body),
      headers: authHeaders(adminToken, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const page = await readNativeJson(res, IdResponse)
    return page.id
  }

  const watch = async function watch(pageId: string): Promise<void> {
    const res = await fetchNativeApi(`http://localhost/api/wiki/${pageId}/watch`, {
      body: JSON.stringify({}),
      headers: authHeaders(watcherToken, slug),
      method: 'POST',
    })
    expect(res.status).toBeLessThan(300)
  }

  const edit = async function edit(pageId: string, content: string): Promise<void> {
    await resetRateLimits()
    const res = await fetchNativeApi(`http://localhost/api/wiki/${pageId}`, {
      body: JSON.stringify({ content }),
      headers: authHeaders(adminToken, slug),
      method: 'PUT',
    })
    expect(res.status).toBe(200)
  }

  const notificationCount = async function notificationCount(): Promise<number> {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM wiki_notifications WHERE user_id = ? AND workspace_id = ?',
    )
      .bind(watcherId, workspaceId)
      .first<{ n: number }>()
    return row?.n ?? 0
  }
  return { createPage, edit, notificationCount, slug, watch, watcherId, watcherToken, workspaceId }
}

/*
 * PROJ-821: a watcher who loses access to a page (grant revoked, or removed from the
 * workspace) must stop receiving its notifications, which carry the page title.
 */
describe('wiki watch notifications respect current access (PROJ-821)', () => {
  test("stops notifying a watcher once their group's project grant is revoked", async () => {
    const { createPage, edit, notificationCount, watch, watcherId, workspaceId } = await seedWatcherFixture()
    const project = await seedProject(workspaceId)
    const { groupId } = await seedGroupGrant(workspaceId, watcherId, project.id, 'viewer')
    const pageId = await createPage({ title: 'Secret Plan', content: 'v1', projectId: project.id })
    await watch(pageId)

    await edit(pageId, 'v2')
    await expect(notificationCount()).resolves.toBe(1)

    await env.DB.prepare('DELETE FROM group_project_grants WHERE group_id = ? AND project_id = ?')
      .bind(groupId, project.id)
      .run()

    await edit(pageId, 'v3')
    await expect(notificationCount()).resolves.toBe(1)
  })

  test('stops notifying a watcher removed from the workspace, even for workspace-level pages', async () => {
    const { createPage, edit, notificationCount, watch, watcherId, workspaceId } = await seedWatcherFixture()
    const pageId = await createPage({ title: 'Handbook', content: 'v1' })
    await watch(pageId)

    await edit(pageId, 'v2')
    await expect(notificationCount()).resolves.toBe(1)

    await env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, watcherId)
      .run()

    await edit(pageId, 'v3')
    await expect(notificationCount()).resolves.toBe(1)
  })

  test('still notifies a subtree watcher who keeps access', async () => {
    const { createPage, notificationCount, slug, watcherId, watcherToken, workspaceId } = await seedWatcherFixture()
    const project = await seedProject(workspaceId)
    await seedGroupGrant(workspaceId, watcherId, project.id, 'viewer')
    const parentId = await createPage({ title: 'Parent', content: 'p', projectId: project.id })
    const res = await fetchNativeApi(`http://localhost/api/wiki/${parentId}/watch`, {
      body: JSON.stringify({ subtree: true }),
      headers: authHeaders(watcherToken, slug),
      method: 'POST',
    })
    expect(res.status).toBeLessThan(300)

    await resetRateLimits()
    await createPage({ title: 'Child', content: 'c', parentId, projectId: project.id })
    await expect(notificationCount()).resolves.toBe(1)
  })
})
