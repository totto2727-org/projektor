import { Schema } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'

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
import { stringifyOrderedFields, fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import {
  KeyListResponse,
  OkResponse,
  parseNativeMcpText,
  IdResponse,
  JsonListResponse,
  readNativeJson,
  readNativeMcpResultText,
} from './response-json.ts'

describe('task Statuses API', () => {
  // ---- list ----

  test('handles GET /api/task-statuses returns empty list initially', async () => {
    const { slug, token } = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const list = await readNativeJson(res, JsonListResponse)
    expect(Array.isArray(list)).toBe(true)
    expect(list).toHaveLength(0)
  })

  test('handles GET /api/task-statuses returns seeded statuses ordered by position', async () => {
    const { slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedTaskStatus(workspaceId, { category: 'done', key: 'done', name: 'Done', position: 2 })
    await seedTaskStatus(workspaceId, { category: 'todo', key: 'todo', name: 'Todo', position: 1 })

    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(token, slug),
    })
    const list = await readNativeJson(res, Schema.Array(Schema.Struct({ key: Schema.String })).pipe(Schema.mutable))
    expect(list).toHaveLength(2)
    expect(list[0].key).toBe('todo')
    expect(list[1].key).toBe('done')
  })

  // ---- create ----

  test('handles POST /api/task-statuses creates a new status (owner)', async () => {
    const { slug, token } = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      body: stringifyOrderedFields([
        ['key', 'in_progress'],
        ['name', 'In Progress'],
        ['category', 'in_progress'],
        ['position', 1],
      ]),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const body = await readNativeJson(res, Schema.Struct({ id: Schema.String, key: Schema.String }))
    expect(isNonEmptyText(body.id)).toBe(true)
    expect(body.key).toBe('in_progress')
  })

  test('handles POST /api/task-statuses rejects duplicate key', async () => {
    const { slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedTaskStatus(workspaceId, { category: 'done', key: 'done', name: 'Done' })
    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      body: stringifyOrderedFields([
        ['key', 'done'],
        ['name', 'Done 2'],
        ['category', 'done'],
      ]),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(409)
  })

  test('handles POST /api/task-statuses rejects invalid key format', async () => {
    const { slug, token } = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      body: stringifyOrderedFields([
        ['key', 'Bad Key!'],
        ['name', 'Bad'],
        ['category', 'todo'],
      ]),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('handles POST /api/task-statuses clears other defaults when isDefault=true', async () => {
    const { slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedTaskStatus(workspaceId, {
      category: 'todo',
      isDefault: true,
      key: 'todo',
      name: 'Todo',
    })

    await fetchNativeApi('http://localhost/api/task-statuses', {
      body: stringifyOrderedFields([
        ['key', 'backlog'],
        ['name', 'Backlog'],
        ['category', 'todo'],
        ['isDefault', true],
      ]),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(token, slug),
    })
    const list = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ is_default: Schema.Number, key: Schema.String })).pipe(Schema.mutable),
    )
    const defaults = list.filter((selectedStatus) => selectedStatus.is_default === 1)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].key).toBe('backlog')
  })

  test('handles POST /api/task-statuses returns 403 for member role', async () => {
    const { slug, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const memberUser = await seedUser('member@example.com')
    await seedMember(workspaceId, memberUser.id, 'member')
    const memberToken = await seedToken(workspaceId, memberUser.id)

    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      body: stringifyOrderedFields([
        ['key', 'done'],
        ['name', 'Done'],
        ['category', 'done'],
      ]),
      headers: authHeaders(memberToken, slug),
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })

  // ---- update ----

  test('handles PATCH /api/task-statuses/:id updates name', async () => {
    const { slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id } = await seedTaskStatus(workspaceId, {
      category: 'todo',
      key: 'todo',
      name: 'Todo',
    })

    const res = await fetchNativeApi(`http://localhost/api/task-statuses/${id}`, {
      body: JSON.stringify({ name: 'To Do' }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(200)

    const listRes = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(token, slug),
    })
    const list = await readNativeJson(
      listRes,
      Schema.Array(Schema.Struct({ key: Schema.String, name: Schema.String })).pipe(Schema.mutable),
    )
    expect(list.find((selectedStatus) => selectedStatus.key === 'todo')?.name).toBe('To Do')
  })

  test('handles PATCH /api/task-statuses/:id returns 404 for unknown id', async () => {
    const { slug, token } = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi(`http://localhost/api/task-statuses/${crypto.randomUUID()}`, {
      body: JSON.stringify({ name: 'Ghost' }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(404)
  })

  test('handles PATCH /api/task-statuses/:id with isDefault=true clears others', async () => {
    const { slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
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
      body: JSON.stringify({ isDefault: true }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })

    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(token, slug),
    })
    const list = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ id: Schema.String, is_default: Schema.Number })).pipe(Schema.mutable),
    )
    const todoRow = list.find((selectedStatus) => selectedStatus.id === todoId)
    const doneRow = list.find((selectedStatus) => selectedStatus.id === doneId)
    expect(todoRow?.is_default).toBe(0)
    expect(doneRow?.is_default).toBe(1)
  })

  // ---- delete ----

  test('handles DELETE /api/task-statuses/:id removes a status', async () => {
    const { slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
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
    const list = await readNativeJson(listRes, JsonListResponse)
    expect(list).toHaveLength(0)
  })

  test('handles DELETE /api/task-statuses/:id returns 404 for unknown id', async () => {
    const { slug, token } = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi(`http://localhost/api/task-statuses/${crypto.randomUUID()}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  test('handles DELETE /api/task-statuses/:id returns 409 when status is in use', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
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
    const { slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
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
    const { workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedTaskStatus(workspaceId, { category: 'done', key: 'done', name: 'Done' })
    const other = await seedFixture({ role: 'owner' })

    const res = await fetchNativeApi('http://localhost/api/task-statuses', {
      headers: authHeaders(other.token, other.workspace.slug),
    })
    const list = await readNativeJson(res, JsonListResponse)
    expect(list).toHaveLength(0)
  })
})

describe('task Statuses — issue integration', () => {
  test('handles POST /api/issues uses workspace default status when no statusId given', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedTaskStatus(workspaceId, {
      category: 'todo',
      isDefault: true,
      key: 'backlog',
      name: 'Backlog',
    })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'No status given' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(
      getRes,
      Schema.Struct({ status_category: Schema.String, status_key: Schema.String, status_name: Schema.String }),
    )
    expect(issue.status_key).toBe('backlog')
    expect(issue.status_name).toBe('Backlog')
    expect(issue.status_category).toBe('todo')
  })

  test('handles POST /api/issues with statusId sets the status_id', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: statusId } = await seedTaskStatus(workspaceId, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, statusId, title: 'Done issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ status_id: Schema.String, status_key: Schema.String }))
    expect(issue.status_key).toBe('done')
    expect(issue.status_id).toBe(statusId)
  })

  test('handles POST /api/issues with legacy status string sets status_id via key lookup', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedTaskStatus(workspaceId, {
      category: 'in_progress',
      key: 'in_progress',
      name: 'In Progress',
    })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, status: 'in_progress', title: 'Legacy status' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ status: Schema.String, status_key: Schema.String }))
    expect(issue.status).toBe('in_progress')
    expect(issue.status_key).toBe('in_progress')
  })

  test('handles POST /api/issues rejects statusId from another workspace', async () => {
    const { projectId, slug, token } = await seedProjectFixture({ role: 'owner' })
    const other = await seedFixture({ role: 'owner' })
    const { id: foreignStatusId } = await seedTaskStatus(other.workspace.id, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, statusId: foreignStatusId, title: 'Cross-ws status' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('handles PATCH /api/issues/:id updates statusId', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: statusId } = await seedTaskStatus(workspaceId, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'No status' })

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      body: JSON.stringify({
        completionReport: { summary: 'Done', verification: 'pnpm test' },
        statusId,
      }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(200)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const updated = await readNativeJson(getRes, Schema.Struct({ status_key: Schema.String }))
    expect(updated.status_key).toBe('done')
  })

  test('handles GET /api/issues?statusId= filters by statusId', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
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
    const pageShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ title: Schema.String })).pipe(Schema.mutable),
    })
    const page = await readNativeJson(res, pageShape)
    expect(page.items).toHaveLength(2)
    expect(page.items.every((item) => item.title.startsWith('Done'))).toBe(true)
  })

  test('handles GET /api/issues?category= filters by category', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
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
    const pageShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ title: Schema.String })).pipe(Schema.mutable),
    })
    const page = await readNativeJson(res, pageShape)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('Todo issue')
  })

  test('handles GET /api/issues?status= (legacy) still works', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedIssue(workspaceId, projectId, userId, { status: 'backlog', title: 'Backlog issue' })
    await seedIssue(workspaceId, projectId, userId, { status: 'done', title: 'Done issue' })

    const res = await fetchNativeApi('http://localhost/api/issues?status=backlog', {
      headers: authHeaders(token, slug),
    })
    const pageShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ title: Schema.String })).pipe(Schema.mutable),
    })
    const page = await readNativeJson(res, pageShape)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('Backlog issue')
  })

  test('handles GET /api/issues returns status_key, status_name, status_category in list', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: statusId } = await seedTaskStatus(workspaceId, {
      category: 'done',
      key: 'done',
      name: 'Done',
    })
    await seedIssue(workspaceId, projectId, userId, { statusId, title: 'Done issue' })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      headers: authHeaders(token, slug),
    })
    const pageShape = Schema.Struct({
      items: Schema.Array(
        Schema.Struct({ status_category: Schema.String, status_key: Schema.String, status_name: Schema.String }),
      ).pipe(Schema.mutable),
    })
    const page = await readNativeJson(res, pageShape)
    expect(page.items[0].status_key).toBe('done')
    expect(page.items[0].status_name).toBe('Done')
    expect(page.items[0].status_category).toBe('done')
  })

  test('handles GET /api/issues/:id returns status_key, status_name, status_category', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: statusId } = await seedTaskStatus(workspaceId, {
      category: 'in_progress',
      key: 'in_progress',
      name: 'In Progress',
    })
    const issue = await seedIssue(workspaceId, projectId, userId, { statusId })

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const body = await readNativeJson(
      res,
      Schema.Struct({ status_category: Schema.String, status_key: Schema.String, status_name: Schema.String }),
    )
    expect(body.status_key).toBe('in_progress')
    expect(body.status_name).toBe('In Progress')
    expect(body.status_category).toBe('in_progress')
  })

  test('handles GET /api/issues/:id has null status_key when no status_id set', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'No status_id' })

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const body = await readNativeJson(res, Schema.Struct({ status_id: Schema.Null, status_key: Schema.Null }))
    expect(body.status_id).toBeNull()
    expect(body.status_key).toBeNull()
  })
})

interface McpParityCredentials {
  slug: string
  token: string
  workspaceId: string
}

interface McpParityTestContext {
  requestAuth: McpParityCredentials
}

const mcpCall = async function mcpCall(
  { slug, token, workspaceId }: McpParityCredentials,
  method: string,
  params: unknown,
): Promise<{ result?: { content: { text: string }[] }; error?: { message: string } }> {
  const res = await fetchNativeApi(
    `http://localhost/mcp/${workspaceId}`,
    requestOptionsWithBody(
      'POST',
      { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
      stringifyOrderedFields([
        ['jsonrpc', '2.0'],
        ['id', 1],
        ['method', method],
        ['params', params],
      ]),
    ),
  )
  return res.json() as Promise<{
    result?: { content: { text: string }[] }
    error?: { message: string }
  }>
}

describe('task Statuses — MCP parity', () => {
  beforeEach<McpParityTestContext>(async (context) => {
    const { token, workspace } = await seedFixture({ role: 'owner' })
    context.requestAuth = { slug: workspace.slug, token, workspaceId: workspace.id }
  })

  test<McpParityTestContext>('list_task_statuses returns empty list', async ({ requestAuth }) => {
    const resp = await mcpCall(requestAuth, 'tools/call', { arguments: {}, name: 'list_task_statuses' })
    expect(resp.error).toBeUndefined()
    const data = parseNativeMcpText(readNativeMcpResultText(resp.result), JsonListResponse)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })

  test<McpParityTestContext>('create_task_status then list returns the status', async ({ requestAuth }) => {
    await mcpCall(requestAuth, 'tools/call', {
      arguments: { key: 'done', name: 'Done', category: 'done', position: 1 },
      name: 'create_task_status',
    })
    const resp = await mcpCall(requestAuth, 'tools/call', { arguments: {}, name: 'list_task_statuses' })
    const data = parseNativeMcpText(readNativeMcpResultText(resp.result), KeyListResponse)
    expect(data).toHaveLength(1)
    expect(data[0].key).toBe('done')
  })

  test<McpParityTestContext>('delete_task_status via MCP returns ok', async ({ requestAuth }) => {
    const createResp = await mcpCall(requestAuth, 'tools/call', {
      arguments: { key: 'tmp', name: 'Tmp', category: 'cancelled' },
      name: 'create_task_status',
    })
    const created = parseNativeMcpText(readNativeMcpResultText(createResp.result), IdResponse)

    const deleteResp = await mcpCall(requestAuth, 'tools/call', {
      name: 'delete_task_status',
      arguments: { id: created.id },
    })
    const deleted = parseNativeMcpText(readNativeMcpResultText(deleteResp.result), OkResponse)
    expect(deleted.ok).toBe(true)
  })
})
