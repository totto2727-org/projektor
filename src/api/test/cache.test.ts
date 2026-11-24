import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import * as cache from '#commands/cache.ts'

import { configureCore, env, getCoreObservations, resetCoreObservations } from './fixture-api.ts'
import { authHeaders, seedIssue, seedProjectFixture, seedTaskStatus, seedTaskType } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

describe('covers KV caching', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let projectId: string
  let userId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture({ role: 'owner' }))
  })

  describe('single-issue cache (TTL 300s, write-through invalidation)', () => {
    /*
     * PROJ-863: the cache holds only issue-owned extras (rollup, custom fields); the
     * row itself is always read, so a deleted issue is a 404 even with a warm cache.
     */
    test('a warm cache never resurrects a deleted issue (row is always read)', async () => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Cached Issue' })
      const url = `http://localhost/api/issues/${issue.id}`
      const hdrs = authHeaders(token, slug)

      // First GET — populates cache
      const first = await fetchNativeApi(url, { headers: hdrs })
      expect(first.status).toBe(200)
      const firstBody = (await first.json()) as { id: string; title: string }
      expect(firstBody.title).toBe('Cached Issue')

      // Delete D1 row — simulates D1 being unavailable or stale
      await env.DB.prepare('DELETE FROM issues WHERE id = ?').bind(issue.id).run()

      const second = await fetchNativeApi(url, { headers: hdrs })
      expect(second.status).toBe(404)
    })

    test('updateIssue invalidates the cache — subsequent GET reflects updated data', async () => {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Before' })
      const url = `http://localhost/api/issues/${issue.id}`
      const hdrs = authHeaders(token, slug)

      // GET to populate cache
      await fetchNativeApi(url, { headers: hdrs })

      // PATCH to update — should invalidate the cache entry
      const patch = await fetchNativeApi(url, {
        method: 'PATCH',
        headers: hdrs,
        body: JSON.stringify({ title: 'After' }),
      })
      expect(patch.status).toBe(200)

      // GET — cache was invalidated so this reads from D1 and returns the new title
      const res = await fetchNativeApi(url, { headers: hdrs })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { title: string }
      expect(body.title).toBe('After')
    })

    test('deleteIssue invalidates the cache — subsequent GET returns 404, not stale cache', async () => {
      const issue = await seedIssue(workspaceId, projectId, userId)
      const url = `http://localhost/api/issues/${issue.id}`
      const hdrs = authHeaders(token, slug)

      // GET to populate cache
      await fetchNativeApi(url, { headers: hdrs })

      // DELETE — should invalidate the cache entry
      const del = await fetchNativeApi(url, { headers: hdrs, method: 'DELETE' })
      expect(del.status).toBe(200)

      // GET after delete must return 404, not the stale cached value
      const res = await fetchNativeApi(url, { headers: hdrs })
      expect(res.status).toBe(404)
    })
  })

  describe('workspace metadata cache (TTL 60s, write-through invalidation)', () => {
    test('task statuses list is cached — second GET returns data even after D1 is cleared', async () => {
      await seedTaskStatus(workspaceId, { category: 'todo', key: 'todo', name: 'Todo' })
      const url = 'http://localhost/api/task-statuses'
      const hdrs = authHeaders(token, slug)

      // First GET — populates cache
      const first = await fetchNativeApi(url, { headers: hdrs })
      expect(first.status).toBe(200)
      const firstBody = (await first.json()) as unknown[]
      expect(firstBody.length).toBeGreaterThan(0)

      // Delete all task statuses from D1
      await env.DB.prepare('DELETE FROM task_statuses WHERE workspace_id = ?').bind(workspaceId).run()

      // Second GET — served from KV cache
      const second = await fetchNativeApi(url, { headers: hdrs })
      expect(second.status).toBe(200)
      const secondBody = (await second.json()) as unknown[]
      expect(secondBody.length).toBeGreaterThan(0)
    })

    test('task types list is cached — second GET returns data even after D1 is cleared', async () => {
      await seedTaskType(workspaceId, { key: 'bug', name: 'Bug' })
      const url = 'http://localhost/api/task-types'
      const hdrs = authHeaders(token, slug)

      const first = await fetchNativeApi(url, { headers: hdrs })
      expect(first.status).toBe(200)
      const firstBody = (await first.json()) as unknown[]
      expect(firstBody.length).toBeGreaterThan(0)

      await env.DB.prepare('DELETE FROM task_types WHERE workspace_id = ?').bind(workspaceId).run()

      const second = await fetchNativeApi(url, { headers: hdrs })
      expect(second.status).toBe(200)
      const secondBody = (await second.json()) as unknown[]
      expect(secondBody.length).toBeGreaterThan(0)
    })

    test('projects list is cached — MCP list_projects returns data even after D1 is cleared', async () => {
      // projectId was already seeded in beforeEach via seedProject
      const hdrs = authHeaders(token, slug)
      const mcpUrl = `http://localhost/mcp/${workspaceId}`

      const mcpListProjects = async function mcpListProjects(): Promise<unknown[]> {
        const res = await fetchNativeApi(mcpUrl, {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'list_projects', arguments: {} },
          }),
        })
        const rpc = (await res.json()) as { result: { content: { text: string }[] } }
        return JSON.parse(rpc.result.content[0].text) as unknown[]
      }

      // First call — populates cache
      const first = await mcpListProjects()
      expect(first.length).toBeGreaterThan(0)

      // Delete from D1 — cache should serve the next request
      await env.DB.prepare('DELETE FROM projects WHERE workspace_id = ?').bind(workspaceId).run()

      // Second call — served from KV cache
      const second = await mcpListProjects()
      expect(second.length).toBeGreaterThan(0)
    })

    test('creating a project invalidates the cache — subsequent list_projects reflects it immediately', async () => {
      const hdrs = authHeaders(token, slug)
      const mcpUrl = `http://localhost/mcp/${workspaceId}`

      const mcpListProjects = async function mcpListProjects(): Promise<{ key: string }[]> {
        const res = await fetchNativeApi(mcpUrl, {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'list_projects', arguments: {} },
          }),
        })
        const rpc = (await res.json()) as { result: { content: { text: string }[] } }
        return JSON.parse(rpc.result.content[0].text) as { key: string }[]
      }

      const before = await mcpListProjects()

      const created = await fetchNativeApi('http://localhost/api/projects', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ key: 'NEWP', name: 'New Project' }),
      })
      expect(created.status).toBe(201)

      const after = await mcpListProjects()
      expect(after).toHaveLength(before.length + 1)
      expect(after.some((p) => p.key === 'NEWP')).toBe(true)
    })

    test('creating a task status invalidates the cache — subsequent list reflects it immediately', async () => {
      const url = 'http://localhost/api/task-statuses'
      const hdrs = authHeaders(token, slug)

      // GET to populate cache with the current (empty-ish) list
      const before = await fetchNativeApi(url, { headers: hdrs })
      const beforeBody = (await before.json()) as unknown[]

      const created = await fetchNativeApi(url, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ key: 'blocked', name: 'Blocked', category: 'in_progress' }),
      })
      expect(created.status).toBe(201)

      // GET immediately after — must not be served from the pre-create cache entry
      const after = await fetchNativeApi(url, { headers: hdrs })
      const afterBody = (await after.json()) as { key: string }[]
      expect(afterBody).toHaveLength(beforeBody.length + 1)
      expect(afterBody.some((s) => s.key === 'blocked')).toBe(true)
    })

    test('deleting a task type invalidates the cache — subsequent list reflects it immediately', async () => {
      const taskType = await seedTaskType(workspaceId, { key: 'chore', name: 'Chore' })
      const url = 'http://localhost/api/task-types'
      const hdrs = authHeaders(token, slug)

      // GET to populate cache including the seeded type
      const before = await fetchNativeApi(url, { headers: hdrs })
      const beforeBody = (await before.json()) as { key: string }[]
      expect(beforeBody.some((t) => t.key === 'chore')).toBe(true)

      const del = await fetchNativeApi(`${url}/${taskType.id}`, { headers: hdrs, method: 'DELETE' })
      expect(del.status).toBe(200)

      // GET immediately after — must not be served from the pre-delete cache entry
      const after = await fetchNativeApi(url, { headers: hdrs })
      const afterBody = (await after.json()) as { key: string }[]
      expect(afterBody.some((t) => t.key === 'chore')).toBe(false)
    })
  })

  describe('covers KV operation failures (PROJ-730)', () => {
    const throwingKv = function throwingKv(err: unknown): KVNamespace {
      return {
        get: () => Promise.reject(err),
        put: () => Promise.reject(err),
        delete: () => Promise.reject(err),
      } as unknown as KVNamespace
    }

    test('get() degrades to a cache miss instead of throwing', async () => {
      const kv = throwingKv(new Error('10048: your account has reached the free usage limit'))
      await expect(cache.get(kv, 'any-key')).resolves.toBeNull()
    })

    test('set() resolves instead of throwing', async () => {
      const kv = throwingKv(new Error('10048: your account has reached the free usage limit'))
      await expect(cache.set(kv, 'any-key', { a: 1 }, 60)).resolves.toBeUndefined()
    })

    test('invalidate() resolves instead of throwing', async () => {
      const kv = throwingKv(new Error('10048: your account has reached the free usage limit'))
      await expect(cache.invalidate(kv, 'any-key')).resolves.toBeUndefined()
    })
  })

  describe('createLocalCache (PROJ-746)', () => {
    test('returns undefined before a set and the stored value after', () => {
      const local = cache.createLocalCache<number>(1000)
      expect(local.get('k')).toBeUndefined()
      local.set('k', 42)
      expect(local.get('k')).toBe(42)
    })

    test('expires an entry once its TTL elapses', () => {
      vi.useFakeTimers()
      try {
        const local = cache.createLocalCache<number>(1000)
        local.set('k', 42)
        vi.advanceTimersByTime(1001)
        expect(local.get('k')).toBeUndefined()
      } finally {
        vi.useRealTimers()
      }
    })

    test('invalidate() removes an entry before its TTL elapses', () => {
      const local = cache.createLocalCache<number>(1000)
      local.set('k', 42)
      local.invalidate('k')
      expect(local.get('k')).toBeUndefined()
    })

    test("update_issue's D1 write still lands and is reported as success when the cache invalidate fails", async () => {
      const { token, slug, workspaceId, projectId, userId } = await seedProjectFixture({
        role: 'owner',
      })
      const issue = await seedIssue(workspaceId, projectId, userId, { title: 'Before' })

      await configureCore({ FIXTURE_CACHE_DELETE_MODE: 'reject' })
      await resetCoreObservations()

      const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
        method: 'POST',
        headers: authHeaders(token, slug),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'update_issue', arguments: { id: issue.id, title: 'After' } },
        }),
      })
      const result = await getCoreObservations()
      expect(result.cacheDeletes).toContain(`issue:${workspaceId}:${issue.id}`)
      expect(res.status).toBe(200)
      const rpc = (await res.json()) as { result?: { isError?: boolean }; error?: unknown }
      expect(rpc.error).toBeUndefined()
      expect(rpc.result).toBeDefined()
      expect(rpc.result?.isError).not.toBe(true)

      const row = await env.DB.prepare('SELECT title FROM issues WHERE id = ?')
        .bind(issue.id)
        .first<{ title: string }>()
      expect(row?.title).toBe('After')
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })
  })
})
