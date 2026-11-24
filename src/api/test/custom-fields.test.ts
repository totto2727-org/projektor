import { Schema, Iterable } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { batchLoadCustomFields } from '#commands/custom-fields.ts'
import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  seedCustomFieldDef,
  seedCustomFieldValue,
  seedFixture,
  seedGroupGrant,
  seedIssue,
  seedMember,
  seedProject,
  seedProjectFixture,
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

// ─── Definition CRUD ──────────────────────────────────────────────────────────

describe('custom Field Definitions API', () => {
  type TestData = Readonly<{
    slug: string
    token: string
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedFixture({ role: 'owner' })
    const token = fixture.token
    const slug = fixture.workspace.slug
    const workspaceId = fixture.workspace.id
    return { slug, token, workspaceId }
  }

  test('handles GET /api/custom-fields returns empty list initially', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/custom-fields', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const list = await readNativeJson(res, JsonListResponse)
    expect(Array.isArray(list)).toBe(true)
    expect(list).toHaveLength(0)
  })

  test('handles POST /api/custom-fields creates a text field (owner)', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/custom-fields', {
      body: JSON.stringify({ key: 'sprint', label: 'Sprint', type: 'text' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const body = await readNativeJson(res, Schema.Struct({ id: Schema.String, key: Schema.String }))
    expect(body.id).toBeTruthy()
    expect(body.key).toBe('sprint')
  })

  test('handles POST /api/custom-fields creates a number field', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/custom-fields', {
      body: JSON.stringify({ key: 'story_points', label: 'Story Points', type: 'number' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
  })

  test('handles POST /api/custom-fields creates a select field with options', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/custom-fields', {
      body: JSON.stringify({
        key: 'size',
        label: 'Size',
        type: 'select',
        options: ['S', 'M', 'L'],
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
  })

  test('handles POST /api/custom-fields rejects duplicate key', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    await seedCustomFieldDef(workspaceId, { key: 'sprint', type: 'text' })
    const res = await fetchNativeApi('http://localhost/api/custom-fields', {
      body: JSON.stringify({ key: 'sprint', label: 'Sprint 2', type: 'text' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(409)
  })

  test('handles POST /api/custom-fields rejects invalid key format', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/custom-fields', {
      body: JSON.stringify({ key: 'Bad Key!', label: 'Bad', type: 'text' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('handles POST /api/custom-fields returns 403 for member role', async () => {
    const { slug, workspaceId } = await seedTestData()
    const memberUser = await seedUser('member@example.com')
    await seedMember(workspaceId, memberUser.id, 'member')
    const memberToken = await seedToken(workspaceId, memberUser.id)

    const res = await fetchNativeApi('http://localhost/api/custom-fields', {
      body: JSON.stringify({ key: 'sprint', label: 'Sprint', type: 'text' }),
      headers: authHeaders(memberToken, slug),
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })

  test('handles PATCH /api/custom-fields/:id updates label', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const { id } = await seedCustomFieldDef(workspaceId, {
      key: 'sp',
      label: 'Story Points',
      type: 'number',
    })

    const res = await fetchNativeApi(`http://localhost/api/custom-fields/${id}`, {
      body: JSON.stringify({ label: 'Points' }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(200)

    const listRes = await fetchNativeApi('http://localhost/api/custom-fields', {
      headers: authHeaders(token, slug),
    })
    const list = await readNativeJson(
      listRes,
      Schema.Array(Schema.Struct({ key: Schema.String, label: Schema.String })).pipe(Schema.mutable),
    )
    expect(list.find((f) => f.key === 'sp')?.label).toBe('Points')
  })

  test('handles PATCH /api/custom-fields/:id updates options for select field', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const { id } = await seedCustomFieldDef(workspaceId, {
      key: 'size',
      options: ['S', 'M'],
      type: 'select',
    })

    const res = await fetchNativeApi(`http://localhost/api/custom-fields/${id}`, {
      body: JSON.stringify({ options: ['S', 'M', 'L', 'XL'] }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(200)
  })

  test('handles PATCH /api/custom-fields/:id returns 404 for unknown id', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/custom-fields/${crypto.randomUUID()}`, {
      body: JSON.stringify({ label: 'Ghost' }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(404)
  })

  test('handles DELETE /api/custom-fields/:id removes a field', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const { id } = await seedCustomFieldDef(workspaceId, { key: 'sprint', type: 'text' })

    const res = await fetchNativeApi(`http://localhost/api/custom-fields/${id}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(200)

    const listRes = await fetchNativeApi('http://localhost/api/custom-fields', {
      headers: authHeaders(token, slug),
    })
    const list = await readNativeJson(listRes, JsonListResponse)
    expect(list).toHaveLength(0)
  })

  test('handles DELETE /api/custom-fields/:id returns 409 when in use', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const { id: fieldId } = await seedCustomFieldDef(workspaceId, { key: 'sprint', type: 'text' })
    const project = await seedProject(workspaceId)
    const user = await seedUser('u2@example.com')
    await seedMember(workspaceId, user.id, 'member')
    const issue = await seedIssue(workspaceId, project.id, user.id)
    await seedCustomFieldValue(issue.id, fieldId, 'sprint-1')

    const res = await fetchNativeApi(`http://localhost/api/custom-fields/${fieldId}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(409)
  })

  test('custom fields are workspace-scoped', async () => {
    const { workspaceId } = await seedTestData()
    await seedCustomFieldDef(workspaceId, { key: 'sp', type: 'number' })
    const other = await seedFixture({ role: 'owner' })

    const res = await fetchNativeApi('http://localhost/api/custom-fields', {
      headers: authHeaders(other.token, other.workspace.slug),
    })
    const list = await readNativeJson(res, JsonListResponse)
    expect(list).toHaveLength(0)
  })
})

// ─── Value validation ─────────────────────────────────────────────────────────

describe('custom Field Values — validation', () => {
  test('rejects unknown custom field key on create', async () => {
    const { projectId, slug, token } = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ customFields: { unknown_field: 'value' }, projectId, title: 'Test' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('rejects unknown custom field key on update', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const issue = await seedIssue(workspaceId, projectId, userId)
    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      body: JSON.stringify({ customFields: { ghost_field: '5' } }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })
    expect(res.status).toBe(400)
  })

  test('rejects non-numeric value for number field', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedCustomFieldDef(workspaceId, { key: 'sp', label: 'SP', type: 'number' })
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ customFields: { sp: 'not-a-number' }, projectId, title: 'Test' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('rejects invalid option for select field', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedCustomFieldDef(workspaceId, {
      key: 'size',
      label: 'Size',
      options: ['S', 'M', 'L'],
      type: 'select',
    })
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ customFields: { size: 'XL' }, projectId, title: 'Test' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('accepts valid option for select field', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedCustomFieldDef(workspaceId, {
      key: 'size',
      label: 'Size',
      options: ['S', 'M', 'L'],
      type: 'select',
    })
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ customFields: { size: 'M' }, projectId, title: 'Test' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
  })

  test('accepts valid number for number field', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedCustomFieldDef(workspaceId, { key: 'sp', label: 'SP', type: 'number' })
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ customFields: { sp: '5' }, projectId, title: 'Test' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
  })

  test('rejects invalid date for date field', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedCustomFieldDef(workspaceId, { key: 'due', label: 'Due', type: 'date' })
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ customFields: { due: 'not-a-date' }, projectId, title: 'Test' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })
})

// ─── Resolved-on-read & batch-load ───────────────────────────────────────────

describe('custom Fields — resolved on read', () => {
  test('handles GET /api/issues/:id returns customFields array', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedCustomFieldDef(workspaceId, {
      key: 'sp',
      label: 'Story Points',
      type: 'number',
    })
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ customFields: { sp: '8' }, projectId, title: 'With SP' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: issueId } = await readNativeJson(res, IdResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}`, {
      headers: authHeaders(token, slug),
    })
    const issueShape = Schema.Struct({
      customFields: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String })).pipe(Schema.mutable),
    })
    const issue = await readNativeJson(getRes, issueShape)
    expect(Array.isArray(issue.customFields)).toBe(true)
    const sp = issue.customFields.find((field) => field.key === 'sp')
    expect(sp?.value).toBe('8')
  })

  test('handles GET /api/issues list returns customFields per issue (batch-loaded, no N+1)', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: fieldId } = await seedCustomFieldDef(workspaceId, {
      key: 'sp',
      label: 'SP',
      type: 'number',
    })

    for (let index = 1; index <= 3; index += 1) {
      const issue = await seedIssue(workspaceId, projectId, userId, { title: `Issue ${index}` })
      await seedCustomFieldValue(issue.id, fieldId, String(index * 3))
    }

    const res = await fetchNativeApi('http://localhost/api/issues', {
      headers: authHeaders(token, slug),
    })
    const pageShape = Schema.Struct({
      items: Schema.Array(
        Schema.Struct({
          customFields: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String })).pipe(Schema.mutable),
        }),
      ).pipe(Schema.mutable),
    })
    const page = await readNativeJson(res, pageShape)
    expect(page.items).toHaveLength(3)
    Iterable.forEach(page.items, (item) => {
      expect(Array.isArray(item.customFields)).toBe(true)
      const sp = item.customFields.find((field) => field.key === 'sp')
      expect(sp).toBeTruthy()
    })
  })

  test('handles PATCH /api/issues/:id updates a custom field value', async () => {
    const { projectId, slug, token, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedCustomFieldDef(workspaceId, { key: 'sp', label: 'SP', type: 'number' })
    const createRes = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ customFields: { sp: '3' }, projectId, title: 'SP issue' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { id: issueId } = await readNativeJson(createRes, IdResponse)

    await fetchNativeApi(`http://localhost/api/issues/${issueId}`, {
      body: JSON.stringify({ customFields: { sp: '13' } }),
      headers: authHeaders(token, slug),
      method: 'PATCH',
    })

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}`, {
      headers: authHeaders(token, slug),
    })
    const issueShape = Schema.Struct({
      customFields: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String })).pipe(Schema.mutable),
    })
    const issue = await readNativeJson(getRes, issueShape)
    expect(issue.customFields.find((field) => field.key === 'sp')?.value).toBe('13')
  })

  test('issue with no custom field values returns empty customFields array', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    await seedCustomFieldDef(workspaceId, { key: 'sp', label: 'SP', type: 'number' })
    const issue = await seedIssue(workspaceId, projectId, userId)

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      headers: authHeaders(token, slug),
    })
    const body = await readNativeJson(
      res,
      Schema.Struct({ customFields: Schema.Array(Schema.Unknown).pipe(Schema.mutable) }),
    )
    expect(Array.isArray(body.customFields)).toBe(true)
    expect(body.customFields).toHaveLength(0)
  })
})

// ─── Filter by custom field ───────────────────────────────────────────────────

describe('custom Fields — list_issues filter', () => {
  test('handles GET /api/issues?cfKey=sp&cfOp=eq&cfValue=5 returns matching issues', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: fieldId } = await seedCustomFieldDef(workspaceId, {
      key: 'sp',
      label: 'SP',
      type: 'number',
    })

    const i1 = await seedIssue(workspaceId, projectId, userId, { title: 'SP5' })
    const i2 = await seedIssue(workspaceId, projectId, userId, { title: 'SP8' })
    await seedCustomFieldValue(i1.id, fieldId, '5')
    await seedCustomFieldValue(i2.id, fieldId, '8')

    const res = await fetchNativeApi('http://localhost/api/issues?cfKey=sp&cfOp=eq&cfValue=5', {
      headers: authHeaders(token, slug),
    })
    const pageShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ title: Schema.String })).pipe(Schema.mutable),
    })
    const page = await readNativeJson(res, pageShape)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('SP5')
  })

  test('handles GET /api/issues?cfKey=sp&cfOp=gt&cfValue=5 returns numeric comparison', async () => {
    const { projectId, slug, token, userId, workspaceId } = await seedProjectFixture({ role: 'owner' })
    const { id: fieldId } = await seedCustomFieldDef(workspaceId, {
      key: 'sp',
      label: 'SP',
      type: 'number',
    })

    const i1 = await seedIssue(workspaceId, projectId, userId, { title: 'SP3' })
    const i2 = await seedIssue(workspaceId, projectId, userId, { title: 'SP8' })
    const i3 = await seedIssue(workspaceId, projectId, userId, { title: 'SP13' })
    await seedCustomFieldValue(i1.id, fieldId, '3')
    await seedCustomFieldValue(i2.id, fieldId, '8')
    await seedCustomFieldValue(i3.id, fieldId, '13')

    const res = await fetchNativeApi('http://localhost/api/issues?cfKey=sp&cfOp=gt&cfValue=5', {
      headers: authHeaders(token, slug),
    })
    const pageShape = Schema.Struct({
      items: Schema.Array(Schema.Struct({ title: Schema.String })).pipe(Schema.mutable),
    })
    const page = await readNativeJson(res, pageShape)
    expect(page.items).toHaveLength(2)
    const titles = page.items.map((item) => item.title).sort()
    expect(titles).toStrictEqual(['SP13', 'SP8'])
  })

  test('handles GET /api/issues with unknown cfKey returns 400', async () => {
    const { slug, token } = await seedProjectFixture({ role: 'owner' })
    const res = await fetchNativeApi('http://localhost/api/issues?cfKey=nonexistent&cfOp=eq&cfValue=x', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(400)
  })
})

// ─── Story points seed ────────────────────────────────────────────────────────

describe('custom Fields — story_points seed', () => {
  test('seedDefaultCustomFields creates story_points for new workspace', async () => {
    const { seedDefaultCustomFields } = await import('#commands/custom-fields.ts')
    const ws = crypto.randomUUID()
    const now = currentEpochSeconds()
    await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
      .bind(ws, 'Test WS', `seed-test-${ws.slice(0, 8)}`, now)
      .run()

    await seedDefaultCustomFields(env.DB, ws)

    const row = await env.DB.prepare(
      `SELECT key, label, type FROM custom_field_definitions WHERE workspace_id = ? AND key = 'story_points'`,
    )
      .bind(ws)
      .first<{ key: string; label: string; type: string }>()
    expect(row).toBeTruthy()
    expect(row!.key).toBe('story_points')
    expect(row!.label).toBe('Story Points')
    expect(row!.type).toBe('number')
  })

  test('seedDefaultCustomFields is idempotent', async () => {
    const { seedDefaultCustomFields } = await import('#commands/custom-fields.ts')
    const ws = crypto.randomUUID()
    const now = currentEpochSeconds()
    await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
      .bind(ws, 'Test WS 2', `seed-idempotent-${ws.slice(0, 8)}`, now)
      .run()

    await seedDefaultCustomFields(env.DB, ws)
    await seedDefaultCustomFields(env.DB, ws)

    const { results } = await env.DB.prepare(
      `SELECT id FROM custom_field_definitions WHERE workspace_id = ? AND key = 'story_points'`,
    )
      .bind(ws)
      .all()
    expect(results).toHaveLength(1)
  })
})

// ─── MCP parity ──────────────────────────────────────────────────────────────

describe('custom Fields — MCP parity', () => {
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
    const res = await fetchNativeApi(
      `http://localhost/mcp/${workspaceId}`,
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

  test('list_custom_field_defs returns empty list', async () => {
    const resp = await mcpCall('tools/call', { name: 'list_custom_field_defs', arguments: {} })
    expect(resp.error).toBeUndefined()
    const data = parseNativeMcpText(resp.result!.content[0].text, JsonListResponse)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })

  test('create_custom_field_def then list returns it', async () => {
    await mcpCall('tools/call', {
      name: 'create_custom_field_def',
      arguments: { key: 'effort', label: 'Effort', type: 'number' },
    })
    const resp = await mcpCall('tools/call', { name: 'list_custom_field_defs', arguments: {} })
    const data = parseNativeMcpText(resp.result!.content[0].text, KeyListResponse)
    expect(data).toHaveLength(1)
    expect(data[0].key).toBe('effort')
  })

  test('delete_custom_field_def via MCP returns ok', async () => {
    const createResp = await mcpCall('tools/call', {
      name: 'create_custom_field_def',
      arguments: { key: 'tmp', label: 'Tmp', type: 'text' },
    })
    const created = parseNativeMcpText(createResp.result!.content[0].text, IdResponse)

    const deleteResp = await mcpCall('tools/call', {
      name: 'delete_custom_field_def',
      arguments: { id: created.id },
    })
    const deleted = parseNativeMcpText(deleteResp.result!.content[0].text, OkResponse)
    expect(deleted.ok).toBe(true)
  })

  test('list_custom_field_defs appears in tools/list', async () => {
    const resp = await mcpCall('tools/list', {})
    const tools = (resp.result as unknown as { tools: { name: string }[] }).tools
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('list_custom_field_defs')
    expect(names).toContain('create_custom_field_def')
    expect(names).toContain('update_custom_field_def')
    expect(names).toContain('delete_custom_field_def')
  })
})

// ─── PROJ-197: batchLoadCustomFields workspace scoping ─────────────────────────

describe('covers PROJ-197: batchLoadCustomFields is workspace-scoped', () => {
  test('never returns custom field values from another workspace, even for foreign issue IDs', async () => {
    const wsA = await seedFixture({ role: 'owner' })
    const wsB = await seedFixture({ role: 'owner' })
    const projA = await seedProject(wsA.workspace.id, 'AAA')
    const projB = await seedProject(wsB.workspace.id, 'BBB')

    const issueA = await seedIssue(wsA.workspace.id, projA.id, wsA.user.id)
    const issueB = await seedIssue(wsB.workspace.id, projB.id, wsB.user.id)

    const defA = await seedCustomFieldDef(wsA.workspace.id, { key: 'sev', label: 'Severity' })
    const defB = await seedCustomFieldDef(wsB.workspace.id, { key: 'sev', label: 'Severity' })
    await seedCustomFieldValue(issueA.id, defA.id, 'high-A')
    await seedCustomFieldValue(issueB.id, defB.id, 'high-B')

    // Pass BOTH issue IDs but scope to workspace A — only A's value may come back.
    const loaded = await batchLoadCustomFields(env.DB, wsA.workspace.id, [issueA.id, issueB.id])

    expect(loaded[issueA.id]).toHaveLength(1)
    expect(loaded[issueA.id][0].value).toBe('high-A')
    // The foreign workspace's issue must be absent entirely — no cross-tenant leak.
    expect(loaded[issueB.id]).toBeUndefined()
  })

  /*
   * Regression: a full 100-issue page bound 100 ids + 1 workspaceId = 101 params,
   * exceeding D1's 100-bound-parameter cap → the query threw and listIssues 500'd
   * (invisible in CI because SQLite allows 32766 params). batchLoadCustomFields now
   * chunks the ids; this proves results still merge correctly across chunk boundaries.
   */
  test('loads values for more issues than the chunk size (spans multiple D1 queries)', async () => {
    const ws = await seedFixture({ role: 'owner' })
    const proj = await seedProject(ws.workspace.id, 'CHK')
    const def = await seedCustomFieldDef(ws.workspace.id, { key: 'sp', label: 'Story Points' })

    const COUNT = 95 // > CHUNK_SIZE (90), so ids span two queries
    const issueIds: string[] = []
    for (let index = 0; index < COUNT; index += 1) {
      const issue = await seedIssue(ws.workspace.id, proj.id, ws.user.id)
      await seedCustomFieldValue(issue.id, def.id, String(index))
      issueIds.push(issue.id)
    }

    const loaded = await batchLoadCustomFields(env.DB, ws.workspace.id, issueIds)

    expect(Object.keys(loaded)).toHaveLength(COUNT)
    for (let index = 0; index < COUNT; index += 1) {
      expect(loaded[issueIds[index]]).toHaveLength(1)
      expect(loaded[issueIds[index]][0].value).toBe(String(index))
    }
  }, 15_000) // Seeds 95 issues sequentially; coverage instrumentation pushes this past the 5s default
})

describe('covers PROJ-837: custom field definitions respect project access', () => {
  test('a member only sees definitions for projects they are granted (plus workspace-level ones)', async () => {
    const { workspace, user, token } = await seedFixture({ role: 'member' })
    const granted = await seedProject(workspace.id, 'OPEN')
    const restricted = await seedProject(workspace.id, 'SECRET')
    await seedGroupGrant(workspace.id, user.id, granted.id, 'member')
    await seedCustomFieldDef(workspace.id, { key: 'ws_field' })
    await seedCustomFieldDef(workspace.id, { key: 'open_field', projectId: granted.id })
    await seedCustomFieldDef(workspace.id, { key: 'secret_field', projectId: restricted.id })

    const all = await fetchNativeApi('http://localhost/api/custom-fields', {
      headers: authHeaders(token, workspace.slug),
    })
    expect(all.status).toBe(200)
    const keys = ((await all.json()) as { key: string }[]).map((d) => d.key).sort()
    expect(keys).toStrictEqual(['open_field', 'ws_field'])

    const scoped = await fetchNativeApi(`http://localhost/api/custom-fields?projectId=${restricted.id}`, {
      headers: authHeaders(token, workspace.slug),
    })
    const scopedKeys = ((await scoped.json()) as { key: string }[]).map((d) => d.key)
    expect(scopedKeys).toStrictEqual(['ws_field'])
  })
})
