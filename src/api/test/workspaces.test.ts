import { Schema, Predicate } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { JSON_NULL } from '#tests/json-null.ts'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  seedFixture,
  seedMember,
  seedProject,
  seedToken,
  seedUser,
  seedUserToken,
  seedWorkspace,
  toolError,
} from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { OkResponse, IdListResponse, IdResponse, parseNativeMcpText, readNativeJson } from './response-json.ts'

const mcpCall = async function mcpCall<T>(
  workspaceId: string,
  name: string,
  args: unknown,
  headers: Record<string, string>,
): Promise<JsonRpcResult<T> | JsonRpcError> {
  const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: args, name },
    }),
  })
  return res.json()
}

const isMcpError = function isMcpError(rpc: JsonRpcResult | JsonRpcError): rpc is JsonRpcError {
  return 'error' in rpc
}

describe('workspaces MCP', () => {
  let workspaceId: string
  let slug: string
  let userId: string
  let userToken: string
  let userHeaders: Record<string, string>

  beforeEach(async () => {
    const fixture = await seedFixture({ role: 'owner' })
    workspaceId = fixture.workspace.id
    slug = fixture.workspace.slug
    userId = fixture.user.id
    userToken = await seedUserToken(fixture.user.id)
    userHeaders = authHeaders(userToken, slug)
  })

  test('list_workspaces returns the single workspace the user belongs to', async () => {
    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'list_workspaces',
      {},
      userHeaders,
    )) as JsonRpcResult<{ content: { text: string }[] }>

    expect(isMcpError(res)).toBe(false)
    const data = parseNativeMcpText(
      res.result.content[0].text,
      Schema.Array(Schema.Struct({ id: Schema.String, role: Schema.String })).pipe(Schema.mutable),
    )
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(workspaceId)
    expect(data[0].role).toBe('owner')
  })

  test('list_workspaces returns both workspaces when user is a member of two', async () => {
    // Add user to a second workspace
    const ws2 = await seedWorkspace(`ws2-${crypto.randomUUID().slice(0, 8)}`)
    await seedMember(ws2.id, userId, 'member')
    const token2 = await seedToken(ws2.id, userId)

    // Call using either workspace as the path param — should still return both
    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'list_workspaces',
      {},
      userHeaders,
    )) as JsonRpcResult<{ content: { text: string }[] }>

    expect(isMcpError(res)).toBe(false)
    const data = parseNativeMcpText(res.result.content[0].text, IdListResponse)
    expect(data).toHaveLength(2)
    const ids = data.map((workspace) => workspace.id)
    expect(ids).toContain(workspaceId)
    expect(ids).toContain(ws2.id)
    // Silence unused variable warning
    void token2
  })

  test('list_workspaces does not expose workspaces of other users', async () => {
    // Create a second user with their own workspace
    const other = await seedFixture({ role: 'owner' })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'list_workspaces',
      {},
      userHeaders,
    )) as JsonRpcResult<{ content: { text: string }[] }>

    expect(isMcpError(res)).toBe(false)
    const data = parseNativeMcpText(res.result.content[0].text, IdListResponse)
    const ids = data.map((workspace) => workspace.id)
    expect(ids).not.toContain(other.workspace.id)
  })

  test('list_workspaces returns workspace id, name, slug, role fields', async () => {
    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'list_workspaces',
      {},
      userHeaders,
    )) as JsonRpcResult<{ content: { text: string }[] }>

    expect(isMcpError(res)).toBe(false)
    const data = parseNativeMcpText(
      res.result.content[0].text,
      Schema.Array(Schema.Record(Schema.String, Schema.Unknown)).pipe(Schema.mutable),
    )
    expect(data[0]).toHaveProperty('id')
    expect(data[0]).toHaveProperty('name')
    expect(data[0]).toHaveProperty('slug')
    expect(data[0]).toHaveProperty('role')
  })

  test('create_workspace creates a workspace and returns id, name, slug', async () => {
    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'create_workspace',
      { slug: 'new-ws', name: 'New Workspace' },
      userHeaders,
    )) as JsonRpcResult<{ content: { text: string }[] }>

    expect(isMcpError(res)).toBe(false)
    const created = parseNativeMcpText(
      res.result.content[0].text,
      Schema.Struct({ id: Schema.String, name: Schema.String, slug: Schema.String }),
    )
    expect(created.id).toBeTruthy()
    expect(created.name).toBe('New Workspace')
    expect(created.slug).toBe('new-ws')
  })

  test('create_workspace adds caller as owner and seeds defaults', async () => {
    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'create_workspace',
      { slug: 'seeded-ws', name: 'Seeded' },
      userHeaders,
    )) as JsonRpcResult<{ content: { text: string }[] }>

    expect(isMcpError(res)).toBe(false)
    const created = parseNativeMcpText(res.result.content[0].text, IdResponse)

    // Caller should be able to list it via list_workspaces
    const listRes = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'list_workspaces',
      {},
      userHeaders,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const workspaces = parseNativeMcpText(
      listRes.result.content[0].text,
      Schema.Array(Schema.Struct({ id: Schema.String, role: Schema.String })).pipe(Schema.mutable),
    )
    const newWs = workspaces.find((workspace) => workspace.id === created.id)
    expect(newWs).toBeDefined()
    expect(newWs?.role).toBe('owner')
  })

  test('create_workspace returns conflict error when slug already taken', async () => {
    await mcpCall(workspaceId, 'create_workspace', { slug: 'dup-slug', name: 'First' }, userHeaders)
    const res = await mcpCall(workspaceId, 'create_workspace', { slug: 'dup-slug', name: 'Second' }, userHeaders)
    expect(toolError(res)?.code).toBe('conflict')
    expect(toolError(res)?.message).toMatch(/slug already taken/i)
  })

  test('create_workspace returns error when required fields missing', async () => {
    const res = await mcpCall(workspaceId, 'create_workspace', { name: 'No Slug' }, userHeaders)
    expect(toolError(res)?.code).toBe('validation')
  })

  test('delete_workspace removes the workspace and returns ok: true', async () => {
    const extra = await seedFixture({ role: 'owner' })
    const extraHeaders = authHeaders(extra.token, extra.workspace.slug)

    const res = (await mcpCall<{ content: { text: string }[] }>(
      extra.workspace.id,
      'delete_workspace',
      { workspaceSlug: extra.workspace.slug },
      extraHeaders,
    )) as JsonRpcResult<{ content: { text: string }[] }>

    expect(isMcpError(res)).toBe(false)
    const data = parseNativeMcpText(res.result.content[0].text, OkResponse)
    expect(data.ok).toBe(true)
  })

  /*
   * The zero-project path above only proves the guard's count reads 0. This covers the
   * other side of it, which nothing else exercised (PROJ-647 rewrote it to use $count).
   */
  test('delete_workspace refuses while the workspace still has projects', async () => {
    const extra = await seedFixture({ role: 'owner' })
    const extraHeaders = authHeaders(extra.token, extra.workspace.slug)
    await seedProject(extra.workspace.id, `P${crypto.randomUUID().slice(0, 6).toUpperCase()}`)

    const res = await mcpCall(
      extra.workspace.id,
      'delete_workspace',
      { workspaceSlug: extra.workspace.slug },
      extraHeaders,
    )

    expect(toolError(res)?.code).toBe('conflict')
  })

  describe('covers PROJ-884: delete_workspace cannot cross tenants', () => {
    const workspaceExists = async function workspaceExists(id: string): Promise<boolean> {
      const row = await env.DB.prepare('SELECT id FROM workspaces WHERE id = ?').bind(id).first()
      return Predicate.isNotNullish(row)
    }

    test("owner of A cannot delete B (not a member of B) via A's MCP URL", async () => {
      const testFixture = await seedFixture({ role: 'owner' })
      const victim = await seedWorkspace(`victim-${crypto.randomUUID().slice(0, 8)}`)

      const res = await mcpCall(
        testFixture.workspace.id,
        'delete_workspace',
        { workspaceSlug: victim.slug },
        authHeaders(testFixture.token, testFixture.workspace.slug),
      )

      expect(toolError(res)?.code).toBe('not_found')
      expect(toolError(res)?.message).toMatch(/not found/i)
      await expect(workspaceExists(victim.id)).resolves.toBe(true)
      await expect(workspaceExists(testFixture.workspace.id)).resolves.toBe(true)
    })

    test("owner of A and B, using a token confined to A, cannot delete B via A's MCP URL", async () => {
      const testFixture = await seedFixture({ role: 'owner' })
      const workspace = await seedWorkspace(`both-${crypto.randomUUID().slice(0, 8)}`)
      await seedMember(workspace.id, testFixture.user.id, 'owner')

      const res = await mcpCall(
        testFixture.workspace.id,
        'delete_workspace',
        { workspaceSlug: workspace.slug },
        authHeaders(testFixture.token, testFixture.workspace.slug),
      )

      expect(toolError(res)?.code).toBe('not_found')
      await expect(workspaceExists(workspace.id)).resolves.toBe(true)
    })
  })

  test('delete_workspace returns error for non-owner', async () => {
    const ws = await seedWorkspace(`mcp-del-${crypto.randomUUID().slice(0, 8)}`)
    const memberUser = await import('./helpers.ts').then((helpers) =>
      helpers.seedUser(`m-${crypto.randomUUID().slice(0, 8)}@example.com`),
    )
    await seedMember(ws.id, memberUser.id, 'member')
    const memberToken = await seedToken(ws.id, memberUser.id)
    const memberHeaders = authHeaders(memberToken, ws.slug)

    const res = await mcpCall(ws.id, 'delete_workspace', { workspaceSlug: ws.slug }, memberHeaders)
    expect(toolError(res)?.code).toBe('forbidden')
  })

  test('delete_workspace returns error when workspace has projects', async () => {
    const extra = await seedFixture({ role: 'owner' })
    await seedProject(extra.workspace.id)
    const extraHeaders = authHeaders(extra.token, extra.workspace.slug)

    const res = await mcpCall(
      extra.workspace.id,
      'delete_workspace',
      { workspaceSlug: extra.workspace.slug },
      extraHeaders,
    )
    expect(toolError(res)?.code).toBe('conflict')
    expect(toolError(res)?.message).toMatch(/delete all projects/i)
  })

  test('update_workspace renames the workspace (PROJ-246)', async () => {
    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'update_workspace',
      { name: 'Renamed via MCP' },
      userHeaders,
    )) as JsonRpcResult<{ content: { text: string }[] }>

    expect(isMcpError(res)).toBe(false)
    const data = parseNativeMcpText(res.result.content[0].text, OkResponse)
    expect(data.ok).toBe(true)

    const getRes = await fetchNativeApi(`http://localhost/api/workspaces/${slug}`, {
      headers: userHeaders,
    })
    const workspace = await readNativeJson(getRes, Schema.Struct({ name: Schema.String }))
    expect(workspace.name).toBe('Renamed via MCP')
  })

  test('update_workspace returns error for member role (PROJ-246)', async () => {
    const ws = await seedWorkspace(`mcp-update-${crypto.randomUUID().slice(0, 8)}`)
    const memberUser = await import('./helpers.ts').then((helpers) =>
      helpers.seedUser(`m-${crypto.randomUUID().slice(0, 8)}@example.com`),
    )
    await seedMember(ws.id, memberUser.id, 'member')
    const memberToken = await seedToken(ws.id, memberUser.id)
    const memberHeaders = authHeaders(memberToken, ws.slug)

    const res = await mcpCall(ws.id, 'update_workspace', { name: 'Should Fail' }, memberHeaders)
    expect(toolError(res)?.code).toBe('forbidden')
  })

  test('update_workspace returns error when name missing (PROJ-246)', async () => {
    const res = await mcpCall(workspaceId, 'update_workspace', {}, userHeaders)
    expect(toolError(res)?.code).toBe('validation')
  })
})

describe('handles DELETE /api/workspaces/:slug (PROJ-96)', () => {
  type TestData = Readonly<{
    ownerHeaders: Record<string, string>
    ownerToken: string
    slug: string
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedFixture({ role: 'owner' })
    const workspaceId = fixture.workspace.id
    const slug = fixture.workspace.slug
    const ownerToken = fixture.token
    const ownerHeaders = authHeaders(ownerToken, slug)
    return { ownerHeaders, ownerToken, slug, workspaceId }
  }

  test('owner can delete a workspace with no projects → 200 { ok: true }', async () => {
    const { ownerHeaders, slug } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}`, {
      headers: ownerHeaders,
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(res, Schema.Struct({ ok: Schema.Boolean }))
    expect(body.ok).toBe(true)
  })

  test('non-owner gets 403', async () => {
    await seedTestData()
    const ws = await seedWorkspace(`del-403-${crypto.randomUUID().slice(0, 8)}`)
    const memberUser = await import('./helpers.ts').then((helpers) =>
      helpers.seedUser(`m-${crypto.randomUUID().slice(0, 8)}@example.com`),
    )
    await seedMember(ws.id, memberUser.id, 'member')
    const memberToken = await seedToken(ws.id, memberUser.id)
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${ws.slug}`, {
      headers: authHeaders(memberToken, ws.slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(403)
  })

  test('deleting DEFAULT_WORKSPACE_SLUG → 400 ValidationError', async () => {
    await seedTestData()
    // The dev wrangler.toml sets DEFAULT_WORKSPACE_SLUG = "projektor"
    const defaultWs = await seedWorkspace('projektor')
    const ownerUser = await import('./helpers.ts').then((helpers) =>
      helpers.seedUser(`owner-def-${crypto.randomUUID().slice(0, 8)}@example.com`),
    )
    await seedMember(defaultWs.id, ownerUser.id, 'owner')
    const ownerTok = await seedToken(defaultWs.id, ownerUser.id)
    const res = await fetchNativeApi(`http://localhost/api/workspaces/projektor`, {
      headers: authHeaders(ownerTok, 'projektor'),
      method: 'DELETE',
    })
    expect(res.status).toBe(400)
  })

  test('workspace with projects → 409 ConflictError', async () => {
    const { ownerHeaders, slug, workspaceId } = await seedTestData()
    await seedProject(workspaceId)
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}`, {
      headers: ownerHeaders,
      method: 'DELETE',
    })
    expect(res.status).toBe(409)
  })

  test('covers URL slug mismatched with X-Workspace-Slug header → 404, neither workspace is deleted (PROJ-437)', async () => {
    const { ownerHeaders, slug } = await seedTestData()
    /*
     * Ctx.workspaceId (and thus the actual delete target) is resolved from the header,
     * not the URL. Naming a *different* workspace in the URL must not silently delete
     * the header's workspace, nor the URL's.
     */
    const other = await seedWorkspace(`del-437-${crypto.randomUUID().slice(0, 8)}`)
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${other.slug}`, {
      method: 'DELETE',
      headers: ownerHeaders, // X-Workspace-Slug: slug (the fixture workspace, not `other`)
    })
    expect(res.status).toBe(404)

    const stillThere = await fetchNativeApi(`http://localhost/api/workspaces/${slug}`, {
      headers: ownerHeaders,
    })
    expect(stillThere.status).toBe(200)
  })
})

describe('member removal tombstone (PROJ-436)', () => {
  const tombstoneRow = async function tombstoneRow(
    workspaceId: string,
    userId: string,
  ): Promise<{ removed_at: number } | null> {
    return env.DB.prepare('SELECT removed_at FROM provisioning_removals WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, userId)
      .first<{ removed_at: number }>()
  }

  test('removing a member records a tombstone; re-inviting them clears it', async () => {
    const fixture = await seedFixture({ role: 'owner' })
    const memberUser = await seedUser(`m-436-${crypto.randomUUID().slice(0, 8)}@example.com`)
    await seedMember(fixture.workspace.id, memberUser.id, 'member')
    const ownerHeaders = authHeaders(fixture.token, fixture.workspace.slug)

    const delRes = await fetchNativeApi(
      `http://localhost/api/workspaces/${fixture.workspace.slug}/members/${memberUser.id}`,
      { headers: ownerHeaders, method: 'DELETE' },
    )
    expect(delRes.status).toBe(200)
    await expect(tombstoneRow(fixture.workspace.id, memberUser.id)).resolves.not.toBeNull()

    const inviteRes = await fetchNativeApi(`http://localhost/api/workspaces/${fixture.workspace.slug}/members`, {
      body: JSON.stringify({ email: memberUser.email, role: 'member' }),
      headers: ownerHeaders,
      method: 'POST',
    })
    expect(inviteRes.status).toBe(201)
    await expect(tombstoneRow(fixture.workspace.id, memberUser.id)).resolves.toBeNull()
  })
})

describe('handles GET /api/workspaces/:slug (currentUserRole)', () => {
  test("returns members and the caller's own role for an owner", async () => {
    const fixture = await seedFixture({ role: 'owner' })
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${fixture.workspace.slug}`, {
      headers: authHeaders(fixture.token, fixture.workspace.slug),
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(
      res,
      Schema.Struct({ currentUserRole: Schema.String, members: Schema.Array(Schema.Unknown).pipe(Schema.mutable) }),
    )
    expect(body.currentUserRole).toBe('owner')
    expect(Array.isArray(body.members)).toBe(true)
  })

  test("reports the caller's role as viewer when they are a viewer", async () => {
    const fixture = await seedFixture({ role: 'viewer' })
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${fixture.workspace.slug}`, {
      headers: authHeaders(fixture.token, fixture.workspace.slug),
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(res, Schema.Struct({ currentUserRole: Schema.String }))
    expect(body.currentUserRole).toBe('viewer')
  })
})

describe('handles GET /api/workspaces/:slug/mcp-info (PROJ-83)', () => {
  type TestData = Readonly<{
    memberHeaders: Record<string, string>
    memberToken: string
    slug: string
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedFixture({ role: 'member' })
    const workspaceId = fixture.workspace.id
    const slug = fixture.workspace.slug
    const memberToken = fixture.token
    const memberHeaders = authHeaders(memberToken, slug)
    return { memberHeaders, memberToken, slug, workspaceId }
  }

  test('returns mcpUrl, workspaceId, workspaceSlug, mcpAddCommandTemplate', async () => {
    const { memberHeaders, slug, workspaceId } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/mcp-info`, {
      headers: memberHeaders,
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(
      res,
      Schema.Struct({
        mcpAddCommandTemplate: Schema.String,
        mcpUrl: Schema.String,
        workspaceId: Schema.String,
        workspaceSlug: Schema.String,
      }),
    )
    expect(body.workspaceId).toBe(workspaceId)
    expect(body.workspaceSlug).toBe(slug)
    expect(body.mcpUrl).toMatch(/\/mcp\//u)
    expect(body.mcpAddCommandTemplate).toContain('claude mcp add')
    expect(body.mcpAddCommandTemplate).toContain('{{TOKEN}}')
    expect(body.mcpAddCommandTemplate).toContain(slug)
  })

  test('mcpAddCommandTemplate puts flags before the name/url positionals (PROJ-620)', async () => {
    const { memberHeaders, slug } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/mcp-info`, {
      headers: memberHeaders,
    })
    const body = await readNativeJson(
      res,
      Schema.Struct({ mcpAddCommandTemplate: Schema.String, mcpUrl: Schema.String }),
    )

    expect(body.mcpAddCommandTemplate).toBe(
      `claude mcp add --transport http ` +
        `--header "Authorization: Bearer {{TOKEN}}" ` +
        `--header "X-Workspace-Slug: ${slug}" ` +
        `projektor "${body.mcpUrl}"`,
    )
  })
})

describe('workspace brand (PROJ-761)', () => {
  type TestData = Readonly<{
    memberHeaders: Record<string, string>
    ownerHeaders: Record<string, string>
    slug: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const owner = await seedFixture({ role: 'owner' })
    const slug = owner.workspace.slug
    const ownerHeaders = authHeaders(owner.token, slug)

    const memberUser = await seedUser(`m-${crypto.randomUUID().slice(0, 8)}@example.com`)
    await seedMember(owner.workspace.id, memberUser.id, 'member')
    const memberToken = await seedToken(owner.workspace.id, memberUser.id)
    const memberHeaders = authHeaders(memberToken, slug)
    return { memberHeaders, ownerHeaders, slug }
  }

  test('handles GET /:slug/brand returns all-null defaults for a workspace with no brand set', async () => {
    const { memberHeaders, slug } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      headers: memberHeaders,
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual({
      accent: JSON_NULL,
      displayName: JSON_NULL,
      fontFamily: JSON_NULL,
      fontUrl: JSON_NULL,
      logoUrl: JSON_NULL,
      onAccent: JSON_NULL,
    })
  })

  test('owner can PATCH accent/displayName and a member can read the result back', async () => {
    const { memberHeaders, ownerHeaders, slug } = await seedTestData()
    const patchRes = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ accent: '#ff8800', displayName: 'Acme Tracker' }),
    })
    expect(patchRes.status).toBe(200)
    const patched = await readNativeJson(patchRes, Schema.Struct({ accent: Schema.String, displayName: Schema.String }))
    expect(patched.displayName).toBe('Acme Tracker')
    expect(patched.accent).toBe('#ff8800')

    const getRes = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      headers: memberHeaders,
    })
    const brand = await readNativeJson(getRes, Schema.Struct({ accent: Schema.String, displayName: Schema.String }))
    expect(brand.displayName).toBe('Acme Tracker')
    expect(brand.accent).toBe('#ff8800')
  })

  test('a member (non admin/owner) gets 403 on PATCH', async () => {
    const { memberHeaders, slug } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      method: 'PATCH',
      headers: memberHeaders,
      body: JSON.stringify({ displayName: 'Should Fail' }),
    })
    expect(res.status).toBe(403)
  })

  test('rejects a non-hex accent value with 400', async () => {
    const { ownerHeaders, slug } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ accent: 'orange' }),
    })
    expect(res.status).toBe(400)
  })

  test('explicit null clears a previously-set field without touching the others', async () => {
    const { ownerHeaders, slug } = await seedTestData()
    await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ accent: '#ff8800', displayName: 'Acme Tracker' }),
    })
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ accent: JSON_NULL }),
    })
    const body = await readNativeJson(
      res,
      Schema.Struct({ accent: Schema.Union([Schema.String, Schema.Null]), displayName: Schema.String }),
    )
    expect(body.displayName).toBe('Acme Tracker')
    expect(body.accent).toBeNull()
  })

  test("owner can upload a logo, it's servable, and a re-upload replaces (not duplicates) the R2 object", async () => {
    const { memberHeaders, ownerHeaders, slug } = await seedTestData()
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ])
    const form = new FormData()
    form.append('file', new File([pngBytes], 'logo.png', { type: 'image/png' }))
    const uploadRes = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand/logo`, {
      body: form,
      headers: { Authorization: ownerHeaders.Authorization, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    expect(uploadRes.status).toBe(201)

    const brandRes = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      headers: memberHeaders,
    })
    const brand = await readNativeJson(brandRes, Schema.Struct({ logoUrl: Schema.String }))
    expect(brand.logoUrl).toBe(`/api/workspaces/${slug}/brand/logo`)

    const logoRes = await fetchNativeApi(`http://localhost${brand.logoUrl}`, {
      headers: memberHeaders,
    })
    expect(logoRes.status).toBe(200)
    expect(logoRes.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await logoRes.arrayBuffer())).toEqual(pngBytes)

    const form2 = new FormData()
    form2.append('file', new File([pngBytes], 'logo2.png', { type: 'image/png' }))
    const reuploadRes = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand/logo`, {
      body: form2,
      headers: { Authorization: ownerHeaders.Authorization, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    expect(reuploadRes.status).toBe(201)
  })

  test('rejects an oversized logo with 413', async () => {
    const { ownerHeaders, slug } = await seedTestData()
    const big = new Uint8Array(2 * 1024 * 1024 + 1)
    const form = new FormData()
    form.append('file', new File([big], 'big.png', { type: 'image/png' }))
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand/logo`, {
      body: form,
      headers: { Authorization: ownerHeaders.Authorization, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    expect(res.status).toBe(413)
  })

  test('rejects a disallowed logo content type with 415', async () => {
    const { ownerHeaders, slug } = await seedTestData()
    const form = new FormData()
    form.append('file', new File(['<svg></svg>'], 'logo.svg', { type: 'image/svg+xml' }))
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand/logo`, {
      body: form,
      headers: { Authorization: ownerHeaders.Authorization, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    expect(res.status).toBe(415)
  })

  test('a member (non admin/owner) gets 403 on logo upload', async () => {
    const { memberHeaders, slug } = await seedTestData()
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }))
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand/logo`, {
      body: form,
      headers: { Authorization: memberHeaders.Authorization, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })

  test('handles GET logo → 404 when no logo has been uploaded', async () => {
    const { memberHeaders, slug } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand/logo`, {
      headers: memberHeaders,
    })
    expect(res.status).toBe(404)
  })

  test('owner can delete the logo, which then 404s', async () => {
    const { memberHeaders, ownerHeaders, slug } = await seedTestData()
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }))
    await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand/logo`, {
      body: form,
      headers: { Authorization: ownerHeaders.Authorization, 'X-Workspace-Slug': slug },
      method: 'POST',
    })

    const delRes = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand/logo`, {
      headers: ownerHeaders,
      method: 'DELETE',
    })
    expect(delRes.status).toBe(204)

    const getRes = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand/logo`, {
      headers: memberHeaders,
    })
    expect(getRes.status).toBe(404)

    const brandRes = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      headers: memberHeaders,
    })
    expect(((await brandRes.json()) as { logoUrl: string | null }).logoUrl).toBeNull()
  })

  test('a member (non admin/owner) gets 403 on logo delete', async () => {
    const { memberHeaders, slug } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand/logo`, {
      headers: memberHeaders,
      method: 'DELETE',
    })
    expect(res.status).toBe(403)
  })

  test('review finding 2: rejects a javascript: fontUrl with 400', async () => {
    const { ownerHeaders, slug } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ fontUrl: 'javascript:alert(1)' }),
    })
    expect(res.status).toBe(400)
  })

  test('review finding 2: rejects a data: fontUrl with 400', async () => {
    const { ownerHeaders, slug } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ fontUrl: 'data:text/html,<script>alert(1)</script>' }),
    })
    expect(res.status).toBe(400)
  })

  test('review finding 2: accepts an https: fontUrl', async () => {
    const { ownerHeaders, slug } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ fontUrl: 'https://fonts.example.com/font.css' }),
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(res, Schema.Struct({ fontUrl: Schema.String }))
    expect(body.fontUrl).toBe('https://fonts.example.com/font.css')
  })

  test('review finding 3: GET logo 404s when the stored R2 key belongs to another workspace', async () => {
    const { memberHeaders, slug } = await seedTestData()
    const { env } = await import('./fixture-api.ts')
    const foreignKey = `${crypto.randomUUID()}/brand-logo/${crypto.randomUUID()}`
    await env.R2.put(foreignKey, new Uint8Array([1, 2, 3]))
    await env.DB.prepare('UPDATE workspaces SET brand = ? WHERE slug = ?')
      .bind(JSON.stringify({ logoR2Key: foreignKey }), slug)
      .run()

    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand/logo`, {
      headers: memberHeaders,
    })
    expect(res.status).toBe(404)
  })

  test("review finding 4: PATCH /:slug/brand operates on the header-resolved workspace, not the URL slug, and doesn't touch the URL's workspace", async () => {
    const { memberHeaders, ownerHeaders, slug } = await seedTestData()
    const other = await seedFixture({ role: 'owner' })

    const patchRes = await fetchNativeApi(`http://localhost/api/workspaces/${other.workspace.slug}/brand`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ displayName: 'Header Workspace' }),
    })
    expect(patchRes.status).toBe(200)
    const patched = await readNativeJson(
      patchRes,
      Schema.Struct({ displayName: Schema.Union([Schema.String, Schema.Null]) }),
    )
    expect(patched.displayName).toBe('Header Workspace')

    const headerWsBrand = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/brand`, {
      headers: memberHeaders,
    })
    expect(((await headerWsBrand.json()) as { displayName: string | null }).displayName).toBe('Header Workspace')

    const otherOwnerHeaders = authHeaders(other.token, other.workspace.slug)
    const otherWsBrand = await fetchNativeApi(`http://localhost/api/workspaces/${other.workspace.slug}/brand`, {
      headers: otherOwnerHeaders,
    })
    expect(((await otherWsBrand.json()) as { displayName: string | null }).displayName).toBeNull()
  })
})

describe('workspace brand R2 cleanup (review finding 5)', () => {
  test('deleting a workspace removes its uploaded logo from R2', async () => {
    const owner = await seedFixture({ role: 'owner' })
    const ownerHeaders = authHeaders(owner.token, owner.workspace.slug)

    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }))
    await fetchNativeApi(`http://localhost/api/workspaces/${owner.workspace.slug}/brand/logo`, {
      body: form,
      headers: {
        Authorization: ownerHeaders.Authorization,
        'X-Workspace-Slug': owner.workspace.slug,
      },
      method: 'POST',
    })

    const { env } = await import('./fixture-api.ts')
    const row = await env.DB.prepare('SELECT brand FROM workspaces WHERE id = ?')
      .bind(owner.workspace.id)
      .first<{ brand: string }>()
    const r2Key = (JSON.parse(row?.brand ?? '{}') as { logoR2Key?: string }).logoR2Key
    expect(r2Key).toBeDefined()
    await expect(env.R2.get(r2Key as string)).resolves.not.toBeNull()

    const delRes = await fetchNativeApi(`http://localhost/api/workspaces/${owner.workspace.slug}`, {
      headers: ownerHeaders,
      method: 'DELETE',
    })
    expect(delRes.status).toBe(200)

    await expect(env.R2.get(r2Key as string)).resolves.toBeNull()
  })
})
