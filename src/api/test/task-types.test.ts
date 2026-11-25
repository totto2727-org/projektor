import { Schema } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { JSON_NULL } from '#tests/json-null.ts'

import {
  authHeaders,
  seedFixture,
  seedIssue,
  seedMember,
  seedProjectFixture,
  seedTaskType,
  seedToken,
  seedUser,
} from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import {
  KeyListResponse,
  OkResponse,
  parseNativeMcpText,
  IdResponse,
  JsonListResponse,
  readNativeJson,
} from './response-json.ts'

describe('task Types API', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let userId: string
  let projectId: string

  beforeEach(async () => {
    // The seedFixture helper uses seedWorkspace (raw insert, no seeding of task types)
    ;({ token, slug, workspaceId, userId, projectId } = await seedProjectFixture({ role: 'owner' }))
  })

  // ---- list ----

  test('handles GET /api/task-types returns empty list initially', async () => {
    const res = await fetchNativeApi('http://localhost/api/task-types', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const list = await readNativeJson(res, JsonListResponse)
    expect(Array.isArray(list)).toBe(true)
    expect(list).toHaveLength(0)
  })

  test('handles GET /api/task-types returns seeded types ordered by position', async () => {
    await seedTaskType(workspaceId, { key: 'bug', name: 'Bug', position: 2 })
    await seedTaskType(workspaceId, { isDefault: true, key: 'task', name: 'Task', position: 1 })

    const res = await fetchNativeApi('http://localhost/api/task-types', {
      headers: authHeaders(token, slug),
    })
    const list = await readNativeJson(res, Schema.Array(Schema.Struct({ key: Schema.String })).pipe(Schema.mutable))
    expect(list).toHaveLength(2)
    expect(list[0].key).toBe('task')
    expect(list[1].key).toBe('bug')
  })

  // ---- create ----

  test('handles POST /api/task-types creates a new type (owner)', async () => {
    const res = await fetchNativeApi('http://localhost/api/task-types', {
      body: JSON.stringify({ key: 'epic', name: 'Epic', position: 1 }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const body = await readNativeJson(res, Schema.Struct({ id: Schema.String, key: Schema.String }))
    expect(isNonEmptyText(body.id)).toBe(true)
    expect(body.key).toBe('epic')
  })

  test('handles POST /api/task-types rejects duplicate key', async () => {
    await seedTaskType(workspaceId, { key: 'epic', name: 'Epic' })
    const res = await fetchNativeApi('http://localhost/api/task-types', {
      body: JSON.stringify({ key: 'epic', name: 'Epic 2' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(409)
  })

  test('handles POST /api/task-types rejects invalid key format', async () => {
    const res = await fetchNativeApi('http://localhost/api/task-types', {
      body: JSON.stringify({ key: 'Bad Key!', name: 'Bad' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('handles POST /api/task-types clears other defaults when isDefault=true', async () => {
    await seedTaskType(workspaceId, { isDefault: true, key: 'task', name: 'Task' })

    await fetchNativeApi('http://localhost/api/task-types', {
      body: JSON.stringify({ key: 'story', name: 'Story', isDefault: true }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/task-types', {
      headers: authHeaders(token, slug),
    })
    const list = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ is_default: Schema.Number, key: Schema.String })).pipe(Schema.mutable),
    )
    const defaults = list.filter((taskType) => taskType.is_default === 1)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].key).toBe('story')
  })

  test('handles POST /api/task-types returns 403 for member role', async () => {
    const memberUser = await seedUser('member@example.com')
    await seedMember(workspaceId, memberUser.id, 'member')
    const memberToken = await seedToken(workspaceId, memberUser.id)

    const res = await fetchNativeApi('http://localhost/api/task-types', {
      body: JSON.stringify({ key: 'epic', name: 'Epic' }),
      headers: authHeaders(memberToken, slug),
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })

  // ---- update ----

  test('handles PATCH /api/task-types/:id updates name', async () => {
    const { id } = await seedTaskType(workspaceId, { key: 'bug', name: 'Bug' })

    const res = await fetchNativeApi(`http://localhost/api/task-types/${id}`, {
      body: JSON.stringify({ name: 'Defect' }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(200)

    const listRes = await fetchNativeApi('http://localhost/api/task-types', {
      headers: authHeaders(token, slug),
    })
    const list = await readNativeJson(
      listRes,
      Schema.Array(Schema.Struct({ key: Schema.String, name: Schema.String })).pipe(Schema.mutable),
    )
    expect(list.find((taskType) => taskType.key === 'bug')?.name).toBe('Defect')
  })

  test('handles PATCH /api/task-types/:id returns 404 for unknown id', async () => {
    const res = await fetchNativeApi(`http://localhost/api/task-types/${crypto.randomUUID()}`, {
      body: JSON.stringify({ name: 'Ghost' }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(404)
  })

  test('handles PATCH /api/task-types/:id with isDefault=true clears others', async () => {
    const { id: taskId } = await seedTaskType(workspaceId, {
      isDefault: true,
      key: 'task',
      name: 'Task',
    })
    const { id: bugId } = await seedTaskType(workspaceId, { key: 'bug', name: 'Bug' })

    await fetchNativeApi(`http://localhost/api/task-types/${bugId}`, {
      body: JSON.stringify({ isDefault: true }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })

    const res = await fetchNativeApi('http://localhost/api/task-types', {
      headers: authHeaders(token, slug),
    })
    const list = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ id: Schema.String, is_default: Schema.Number })).pipe(Schema.mutable),
    )
    const taskRow = list.find((taskType) => taskType.id === taskId)
    const bugRow = list.find((taskType) => taskType.id === bugId)
    expect(taskRow?.is_default).toBe(0)
    expect(bugRow?.is_default).toBe(1)
  })

  // ---- delete ----

  test('handles DELETE /api/task-types/:id removes a type', async () => {
    const { id } = await seedTaskType(workspaceId, { key: 'epic', name: 'Epic' })

    const res = await fetchNativeApi(`http://localhost/api/task-types/${id}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(200)

    const listRes = await fetchNativeApi('http://localhost/api/task-types', {
      headers: authHeaders(token, slug),
    })
    const list = await readNativeJson(listRes, JsonListResponse)
    expect(list).toHaveLength(0)
  })

  test('handles DELETE /api/task-types/:id returns 404 for unknown id', async () => {
    const res = await fetchNativeApi(`http://localhost/api/task-types/${crypto.randomUUID()}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  test('handles DELETE /api/task-types/:id returns 409 when type is in use', async () => {
    const { id: typeId } = await seedTaskType(workspaceId, { key: 'epic', name: 'Epic' })
    await seedIssue(workspaceId, projectId, userId, { typeId })

    const res = await fetchNativeApi(`http://localhost/api/task-types/${typeId}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(409)
  })

  // ---- workspace scoping ----

  test('handles GET /api/task-types is workspace-scoped', async () => {
    await seedTaskType(workspaceId, { key: 'epic', name: 'Epic' })
    const other = await seedFixture({ role: 'owner' })

    const res = await fetchNativeApi('http://localhost/api/task-types', {
      headers: authHeaders(other.token, other.workspace.slug),
    })
    const list = await readNativeJson(res, JsonListResponse)
    expect(list).toHaveLength(0)
  })
})

describe('task Types — issue integration', () => {
  test('handles POST /api/issues uses workspace default type when no typeId given', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedTaskType(workspaceId, { isDefault: true, key: 'task', name: 'Task' })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'No type given' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ type_key: Schema.String, type_name: Schema.String }))
    expect(issue.type_key).toBe('task')
    expect(issue.type_name).toBe('Task')
  })

  test('handles POST /api/issues with typeId sets the type', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: typeId } = await seedTaskType(workspaceId, { key: 'bug', name: 'Bug' })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Bug issue', typeId }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ type_key: Schema.String }))
    expect(issue.type_key).toBe('bug')
  })

  test('handles POST /api/issues rejects typeId from another workspace', async () => {
    const { projectId, slug, token } = await seedProjectFixture({ role: 'owner' })
    const other = await seedFixture({ role: 'owner' })
    const { id: foreignTypeId } = await seedTaskType(other.workspace.id, {
      key: 'epic',
      name: 'Epic',
    })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Cross-ws type', typeId: foreignTypeId }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('handles PATCH /api/issues/:id updates typeId', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: typeId } = await seedTaskType(workspaceId, { key: 'story', name: 'Story' })
    const issue = await seedIssue(workspaceId, projectId, userId, { title: 'No type' })

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      body: JSON.stringify({ typeId }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(200)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const updated = await readNativeJson(getRes, Schema.Struct({ type_key: Schema.String }))
    expect(updated.type_key).toBe('story')
  })

  test('handles PATCH /api/issues/:id clears typeId with null', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: typeId } = await seedTaskType(workspaceId, { key: 'bug', name: 'Bug' })
    const issue = await seedIssue(workspaceId, projectId, userId, { typeId })

    await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      body: JSON.stringify({ typeId: JSON_NULL }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const updated = await readNativeJson(
      getRes,
      Schema.Struct({
        type_id: Schema.Union([Schema.String, Schema.Null]),
        type_key: Schema.Union([Schema.String, Schema.Null]),
      }),
    )
    expect(updated.type_id).toBeNull()
    expect(updated.type_key).toBeNull()
  })

  test('handles GET /api/issues?typeId= filters by type', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: bugTypeId } = await seedTaskType(workspaceId, { key: 'bug', name: 'Bug' })
    const { id: storyTypeId } = await seedTaskType(workspaceId, { key: 'story', name: 'Story' })

    await seedIssue(workspaceId, projectId, userId, { title: 'Bug 1', typeId: bugTypeId })
    await seedIssue(workspaceId, projectId, userId, { title: 'Bug 2', typeId: bugTypeId })
    await seedIssue(workspaceId, projectId, userId, { title: 'Story 1', typeId: storyTypeId })

    const res = await fetchNativeApi(`http://localhost/api/issues?typeId=${bugTypeId}`, {
      headers: authHeaders(token, slug),
    })
    const pageShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ title: Schema.String })).pipe(Schema.mutable),
    })
    const page = await readNativeJson(res, pageShape)
    expect(page.items).toHaveLength(2)
    expect(page.items.every((item) => item.title.startsWith('Bug'))).toBe(true)
  })

  test('handles GET /api/issues returns type_key and type_name in list', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: typeId } = await seedTaskType(workspaceId, { key: 'epic', name: 'Epic' })
    await seedIssue(workspaceId, projectId, userId, { title: 'Typed issue', typeId })

    const res = await fetchNativeApi('http://localhost/api/issues', {
      headers: authHeaders(token, slug),
    })
    const pageShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ type_key: Schema.String, type_name: Schema.String })).pipe(Schema.mutable),
    })
    const page = await readNativeJson(res, pageShape)
    expect(page.items[0].type_key).toBe('epic')
    expect(page.items[0].type_name).toBe('Epic')
  })

  test('handles GET /api/issues/:id returns type_key and type_name', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: typeId } = await seedTaskType(workspaceId, { key: 'bug', name: 'Bug' })
    const issue = await seedIssue(workspaceId, projectId, userId, { typeId })

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const body = await readNativeJson(res, Schema.Struct({ type_key: Schema.String, type_name: Schema.String }))
    expect(body.type_key).toBe('bug')
    expect(body.type_name).toBe('Bug')
  })

  test('handles POST /api/issues has null type_key when no types exist', async () => {
    const { projectId, slug, token } = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'Typeless issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const { id } = await readNativeJson(res, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, {
      headers: authHeaders(token, slug),
    })
    const issue = await readNativeJson(getRes, Schema.Struct({ type_id: Schema.Null, type_key: Schema.Null }))
    expect(issue.type_id).toBeNull()
    expect(issue.type_key).toBeNull()
  })
})

describe('task Types — MCP parity', () => {
  let token: string
  let slug: string
  let workspaceNumericId: string

  beforeEach(async () => {
    const fixture = await seedFixture({ role: 'owner' })
    token = fixture.token
    slug = fixture.workspace.slug
    workspaceNumericId = fixture.workspace.id
  })

  const mcpCall = async function mcpCall(
    method: string,
    params: unknown,
  ): Promise<{ result?: { content: { text: string }[] }; error?: { message: string } }> {
    const res = await fetchNativeApi(
      `http://localhost/mcp/${workspaceNumericId}`,
      requestOptionsWithBody(
        'POST',
        { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
        JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      ),
    )
    return res.json() as Promise<{
      result?: { content: { text: string }[] }
      error?: { message: string }
    }>
  }

  test('list_task_types returns empty list', async () => {
    const resp = await mcpCall('tools/call', { name: 'list_task_types', arguments: {} })
    expect(resp.error).toBeUndefined()
    const data = parseNativeMcpText(resp.result!.content[0].text, JsonListResponse)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })

  test('create_task_type then list_task_types returns the type', async () => {
    await mcpCall('tools/call', {
      name: 'create_task_type',
      arguments: { key: 'epic', name: 'Epic', position: 1 },
    })
    const resp = await mcpCall('tools/call', { name: 'list_task_types', arguments: {} })
    const data = parseNativeMcpText(resp.result!.content[0].text, KeyListResponse)
    expect(data).toHaveLength(1)
    expect(data[0].key).toBe('epic')
  })

  test('delete_task_type via MCP returns ok', async () => {
    const createResp = await mcpCall('tools/call', {
      name: 'create_task_type',
      arguments: { key: 'tmp', name: 'Tmp' },
    })
    const created = parseNativeMcpText(createResp.result!.content[0].text, IdResponse)

    const deleteResp = await mcpCall('tools/call', {
      name: 'delete_task_type',
      arguments: { id: created.id },
    })
    const deleted = parseNativeMcpText(deleteResp.result!.content[0].text, OkResponse)
    expect(deleted.ok).toBe(true)
  })
})
