import { beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  authHeaders,
  seedFixture,
  seedIssue,
  seedMember,
  seedProjectFixture,
  seedTaskStatus,
  seedToken,
  seedUser,
} from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

describe('task Statuses API', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let userId: string
  let projectId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture({ role: 'owner' }))
  })

  // ---- list ----

  test('handles GET /api/task-statuses returns empty list initially', async () => {
    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const list = (await res.json()) as unknown[]
    expect(Array.isArray(list)).toBe(true)
    expect(list).toHaveLength(0)
  })

  test('handles GET /api/task-statuses returns seeded statuses ordered by position', async () => {
    await seedTaskStatus(workspaceId, { category: 'done', key: 'done', name: 'Done', position: 2 })
    await seedTaskStatus(workspaceId, { category: 'todo', key: 'todo', name: 'Todo', position: 1 })

    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(token, slug),
    })
    const list = (await res.json()) as { key: string }[]
    expect(list).toHaveLength(2)
    expect(list[0].key).toBe('todo')
    expect(list[1].key).toBe('done')
  })

  // ---- create ----

  test('handles POST /api/task-statuses creates a new status (owner)', async () => {
    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        key: 'in_progress',
        name: 'In Progress',
        category: 'in_progress',
        position: 1,
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; key: string }
    expect(body.id).toBeTruthy()
    expect(body.key).toBe('in_progress')
  })

  test('handles POST /api/task-statuses rejects duplicate key', async () => {
    await seedTaskStatus(workspaceId, { category: 'done', key: 'done', name: 'Done' })
    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ key: 'done', name: 'Done 2', category: 'done' }),
    })
    expect(res.status).toBe(409)
  })

  test('handles POST /api/task-statuses rejects invalid key format', async () => {
    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ key: 'Bad Key!', name: 'Bad', category: 'todo' }),
    })
    expect(res.status).toBe(400)
  })

  test('handles POST /api/task-statuses clears other defaults when isDefault=true', async () => {
    await seedTaskStatus(workspaceId, {
      category: 'todo',
      isDefault: true,
      key: 'todo',
      name: 'Todo',
    })

    await fetchNativeApi('http://localhost/api/task-statuses', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ key: 'backlog', name: 'Backlog', category: 'todo', isDefault: true }),
    })

    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(token, slug),
    })
    const list = (await res.json()) as { key: string; is_default: number }[]
    const defaults = list.filter((s) => s.is_default === 1)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].key).toBe('backlog')
  })

  test('handles POST /api/task-statuses returns 403 for member role', async () => {
    const memberUser = await seedUser('member@example.com')
    await seedMember(workspaceId, memberUser.id, 'member')
    const memberToken = await seedToken(workspaceId, memberUser.id)

    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      method: 'POST',
      headers: authHeaders(memberToken, slug),
      body: JSON.stringify({ key: 'done', name: 'Done', category: 'done' }),
    })
    expect(res.status).toBe(403)
  })

  // ---- update ----

  test('handles PATCH /api/task-statuses/:id updates name', async () => {
    const { id } = await seedTaskStatus(workspaceId, {
      category: 'todo',
      key: 'todo',
      name: 'Todo',
    })

    const res = await fetchNativeApi(`http://localhost/api/task-statuses/${id}`, {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ name: 'To Do' }),
    })
    expect(res.status).toBe(200)

    const listRes = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(token, slug),
    })
    const list = (await listRes.json()) as { key: string; name: string }[]
    expect(list.find((s) => s.key === 'todo')?.name).toBe('To Do')
  })

  test('handles PATCH /api/task-statuses/:id returns 404 for unknown id', async () => {
    const res = await fetchNativeApi(`http://localhost/api/task-statuses/${crypto.randomUUID()}`, {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ name: 'Ghost' }),
    })
    expect(res.status).toBe(404)
  })

  test('handles PATCH /api/task-statuses/:id with isDefault=true clears others', async () => {
    const { id: todoId } = await seedTaskStatus(workspaceId, {
      category: 'todo',
      isDefault: true,
      key: 'todo',
      name: 'Todo',
    })
    const { id: doneId } = await seedTaskStatus(workspaceId, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })

    await fetchNativeApi(`http://localhost/api/task-statuses/${doneId}`, {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ isDefault: true }),
    })

    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(token, slug),
    })
    const list = (await res.json()) as { id: string; is_default: number }[]
    const todoRow = list.find((s) => s.id === todoId)
    const doneRow = list.find((s) => s.id === doneId)
    expect(todoRow?.is_default).toBe(0)
    expect(doneRow?.is_default).toBe(1)
  })

  // ---- delete ----

  test('handles DELETE /api/task-statuses/:id removes a status', async () => {
    const { id } = await seedTaskStatus(workspaceId, {
      category: 'cancelled',
      key: 'cancelled',
      name: 'Cancelled',
    })

    const res = await fetchNativeApi(`http://localhost/api/task-statuses/${id}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(200)

    const listRes = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(token, slug),
    })
    const list = (await listRes.json()) as unknown[]
    expect(list).toHaveLength(0)
  })

  test('handles DELETE /api/task-statuses/:id returns 404 for unknown id', async () => {
    const res = await fetchNativeApi(`http://localhost/api/task-statuses/${crypto.randomUUID()}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  test('handles DELETE /api/task-statuses/:id returns 409 when status is in use', async () => {
    const { id: statusId } = await seedTaskStatus(workspaceId, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })
    await seedIssue(workspaceId, projectId, userId, { statusId })

    const res = await fetchNativeApi(`http://localhost/api/task-statuses/${statusId}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(409)
  })

  test('handles DELETE /api/task-statuses/:id returns 409 when deleting the default', async () => {
    const { id } = await seedTaskStatus(workspaceId, {
      category: 'todo',
      isDefault: true,
      key: 'backlog',
      name: 'Backlog',
    })

    const res = await fetchNativeApi(`http://localhost/api/task-statuses/${id}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(409)
  })

  // ---- workspace scoping ----

  test('handles GET /api/task-statuses is workspace-scoped', async () => {
    await seedTaskStatus(workspaceId, { category: 'done', key: 'done', name: 'Done' })
    const other = await seedFixture({ role: 'owner' })

    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(other.token, other.workspace.slug),
    })
    const list = (await res.json()) as unknown[]
    expect(list).toHaveLength(0)
  })
})

describe('task Statuses — issue integration', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let userId: string
  let projectId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture({ role: 'owner' }))
  })

  test('handles POST /api/issues uses workspace default status when no statusId given', async () => {
    await seedTaskStatus(workspaceId, {
      category: 'todo',
      isDefault: true,
      key: 'backlog',
      name: 'Backlog',
    })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ projectId, title: 'No status given' }),
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = (await getRes.json()) as {
      status_key: string
      status_name: string
      status_category: string
    }
    expect(issue.status_key).toBe('backlog')
    expect(issue.status_name).toBe('Backlog')
    expect(issue.status_category).toBe('todo')
  })

  test('handles POST /api/issues with statusId sets the status_id', async () => {
    const { id: statusId } = await seedTaskStatus(workspaceId, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ projectId, statusId, title: 'Done issue' }),
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = (await getRes.json()) as { status_key: string; status_id: string }
    expect(issue.status_key).toBe('done')
    expect(issue.status_id).toBe(statusId)
  })

  test('handles POST /api/issues with legacy status string sets status_id via key lookup', async () => {
    await seedTaskStatus(workspaceId, {
      category: 'in_progress',
      key: 'in_progress',
      name: 'In Progress',
    })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ projectId, status: 'in_progress', title: 'Legacy status' }),
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = (await getRes.json()) as { status: string; status_key: string }
    expect(issue.status).toBe('in_progress')
    expect(issue.status_key).toBe('in_progress')
  })

  test('handles POST /api/issues rejects statusId from another workspace', async () => {
    const other = await seedFixture({ role: 'owner' })
    const { id: foreignStatusId } = await seedTaskStatus(other.workspace.id, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ projectId, statusId: foreignStatusId, title: 'Cross-ws status' }),
    })
    expect(res.status).toBe(400)
  })

  test('handles PATCH /api/issues/:id updates statusId', async () => {
    const { id: statusId } = await seedTaskStatus(workspaceId, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'No status' })

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        statusId,
        completionReport: { summary: 'Done', verification: 'pnpm test' },
      }),
    })
    expect(res.status).toBe(200)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const updated = (await getRes.json()) as { status_key: string }
    expect(updated.status_key).toBe('done')
  })

  test('handles GET /api/issues?statusId= filters by statusId', async () => {
    const { id: doneId } = await seedTaskStatus(workspaceId, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })
    const { id: todoId } = await seedTaskStatus(workspaceId, {
      category: 'todo',
      key: 'todo',
      name: 'Todo',
    })

    await seedIssue(workspaceId, projectId, userId, { statusId: doneId, title: 'Done 1' })
    await seedIssue(workspaceId, projectId, userId, { statusId: doneId, title: 'Done 2' })
    await seedIssue(workspaceId, projectId, userId, { statusId: todoId, title: 'Todo 1' })

    const res = await fetchNativeApi(`http://localhost/api/issues?statusId=${doneId}`, {
      headers: authHeaders(token, slug),
    })
    const page = (await res.json()) as { items: { title: string }[] }
    expect(page.items).toHaveLength(2)
    expect(page.items.every((item) => item.title.startsWith('Done'))).toBe(true)
  })

  test('handles GET /api/issues?category= filters by category', async () => {
    const { id: doneId } = await seedTaskStatus(workspaceId, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })
    const { id: todoId } = await seedTaskStatus(workspaceId, {
      category: 'todo',
      key: 'todo',
      name: 'Todo',
    })
    const { id: inProgressId } = await seedTaskStatus(workspaceId, {
      category: 'in_progress',
      key: 'in_progress',
      name: 'In Progress',
    })

    await seedIssue(workspaceId, projectId, userId, { statusId: doneId, title: 'Done issue' })
    await seedIssue(workspaceId, projectId, userId, { statusId: todoId, title: 'Todo issue' })
    await seedIssue(workspaceId, projectId, userId, {
      statusId: inProgressId,
      title: 'In Progress issue',
    })

    const res = await fetchNativeApi('http://localhost/api/issues?category=todo', {
      headers: authHeaders(token, slug),
    })
    const page = (await res.json()) as { items: { title: string }[] }
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('Todo issue')
  })

  test('handles GET /api/issues?status= (legacy) still works', async () => {
    await seedIssue(workspaceId, projectId, userId, { status: 'backlog', title: 'Backlog issue' })
    await seedIssue(workspaceId, projectId, userId, { status: 'done', title: 'Done issue' })

    const res = await fetchNativeApi('http://localhost/api/issues?status=backlog', {
      headers: authHeaders(token, slug),
    })
    const page = (await res.json()) as { items: { title: string }[] }
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('Backlog issue')
  })

  test('handles GET /api/issues returns status_key, status_name, status_category in list', async () => {
    const { id: statusId } = await seedTaskStatus(workspaceId, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })
    await seedIssue(workspaceId, projectId, userId, { statusId, title: 'Done issue' })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      headers: authHeaders(token, slug),
    })
    const page = (await res.json()) as {
      items: { status_key: string; status_name: string; status_category: string }[]
    }
    expect(page.items[0].status_key).toBe('done')
    expect(page.items[0].status_name).toBe('Done')
    expect(page.items[0].status_category).toBe('done')
  })

  test('handles GET /api/issues/:id returns status_key, status_name, status_category', async () => {
    const { id: statusId } = await seedTaskStatus(workspaceId, {
      category: 'in_progress',
      key: 'in_progress',
      name: 'In Progress',
    })
    const issue = await seedIssue(workspaceId, projectId, userId, { statusId })

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const body = (await res.json()) as {
      status_key: string
      status_name: string
      status_category: string
    }
    expect(body.status_key).toBe('in_progress')
    expect(body.status_name).toBe('In Progress')
    expect(body.status_category).toBe('in_progress')
  })

  test('handles GET /api/issues/:id has null status_key when no status_id set', async () => {
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'No status_id' })

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const body = (await res.json()) as { status_id: null; status_key: null }
    expect(body.status_id).toBeNull()
    expect(body.status_key).toBeNull()
  })
})

describe('task Statuses — MCP parity', () => {
  let token: string
  let slug: string
  let workspaceId: string

  beforeEach(async () => {
    const fixture = await seedFixture({ role: 'owner' })
    token = fixture.token
    slug = fixture.workspace.slug
    workspaceId = fixture.workspace.id
  })

  const mcpCall = async function mcpCall(
    method: string,
    params: unknown,
  ): Promise<{ result?: { content: { text: string }[] }; error?: { message: string } }> {
    const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      method: 'POST',
      headers: { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    return res.json() as Promise<{
      result?: { content: { text: string }[] }
      error?: { message: string }
    }>
  }

  test('list_task_statuses returns empty list', async () => {
    const resp = await mcpCall('tools/call', { name: 'list_task_statuses', arguments: {} })
    expect(resp.error).toBeUndefined()
    const data = JSON.parse(resp.result!.content[0].text) as unknown[]
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })

  test('create_task_status then list returns the status', async () => {
    await mcpCall('tools/call', {
      name: 'create_task_status',
      arguments: { key: 'done', name: 'Done', category: 'done', position: 1 },
    })
    const resp = await mcpCall('tools/call', { name: 'list_task_statuses', arguments: {} })
    const data = JSON.parse(resp.result!.content[0].text) as { key: string }[]
    expect(data).toHaveLength(1)
    expect(data[0].key).toBe('done')
  })

  test('delete_task_status via MCP returns ok', async () => {
    const createResp = await mcpCall('tools/call', {
      name: 'create_task_status',
      arguments: { key: 'tmp', name: 'Tmp', category: 'cancelled' },
    })
    const created = JSON.parse(createResp.result!.content[0].text) as { id: string }

    const deleteResp = await mcpCall('tools/call', {
      name: 'delete_task_status',
      arguments: { id: created.id },
    })
    const deleted = JSON.parse(deleteResp.result!.content[0].text) as { ok: boolean }
    expect(deleted.ok).toBe(true)
  })
})
