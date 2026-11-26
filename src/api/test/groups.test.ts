import { Predicate, Schema } from 'effect'
import { assert, describe, expect, test } from 'vite-plus/test'

import { ApiResults } from '#contracts/api-results.ts'

import { authHeaders, seedProject, seedUser, seedWorkspaceRoles, toolError } from './helpers.ts'
import { fetchNativeApi, fetchNativeMcpTool } from './native-fetch.ts'
import type { McpToolRequest } from './native-fetch.ts'
import { IdResponse, parseNativeMcpText, McpRpcResponse, RpcTextResponse, readNativeJson } from './response-json.ts'

const callMcpTool = async function callMcpTool(
  workspaceId: string,
  params: McpToolRequest,
  headers: Record<string, string>,
): Promise<typeof RpcTextResponse.Type> {
  const response = await fetchNativeMcpTool(workspaceId, params, headers)
  return readNativeJson(response, RpcTextResponse)
}

const mcpCall = async function mcpCall(
  workspaceId: string,
  params: McpToolRequest,
  headers: Record<string, string>,
): Promise<typeof McpRpcResponse.Type> {
  const response = await fetchNativeMcpTool(workspaceId, params, headers)
  return readNativeJson(response, McpRpcResponse)
}

const mcpData = function mcpData<S extends Schema.Constraint>(rpc: typeof McpRpcResponse.Type, shape: S): S['Type'] {
  if (rpc.error) {
    assert.fail(`MCP error: ${rpc.error.message}`)
  }
  const innerError = toolError(rpc)
  if (innerError) {
    assert.fail(`MCP tool error (${innerError.code}): ${innerError.message}`)
  }
  const text = rpc.result?.content?.[0]?.text
  assert(Predicate.isString(text))
  return parseNativeMcpText(text, shape)
}

type GroupFixture = Readonly<{
  createGroup: (name: string) => Promise<string>
  memberHeaders: ReturnType<typeof authHeaders>
  ownerHeaders: ReturnType<typeof authHeaders>
  roles: Awaited<ReturnType<typeof seedWorkspaceRoles>>
  slug: string
  workspaceId: string
}>

const seedGroupFixture = async function seedGroupFixture(): Promise<GroupFixture> {
  const roles = await seedWorkspaceRoles()
  const { id: workspaceId, slug } = roles.workspace
  const ownerHeaders = authHeaders(roles.owner.token, slug)
  const memberHeaders = authHeaders(roles.member.token, slug)
  const createGroup = async function createGroup(name: string): Promise<string> {
    const response = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, {
      body: JSON.stringify({ name }),
      headers: ownerHeaders,
      method: 'POST',
    })
    expect(response.status).toBe(201)
    const group = await readNativeJson(response, IdResponse)
    return group.id
  }
  return { createGroup, memberHeaders, ownerHeaders, roles, slug, workspaceId }
}

describe('groups REST', () => {
  test('owner can create and list a group', async () => {
    const { createGroup, ownerHeaders, slug } = await seedGroupFixture()
    await createGroup('Engineering')
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, {
      headers: ownerHeaders,
    })
    expect(res.status).toBe(200)
    const groups = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ grantCount: Schema.Number, memberCount: Schema.Number, name: Schema.String })).pipe(
        Schema.mutable,
      ),
    )
    const engineeringGroup = groups.find((group) => group.name === 'Engineering')
    assert.isDefined(engineeringGroup)
    expect(engineeringGroup.memberCount).toBe(0)
    expect(engineeringGroup.grantCount).toBe(0)
  })

  test('member cannot create a group (403)', async () => {
    const { memberHeaders, slug } = await seedGroupFixture()
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, {
      body: JSON.stringify({ name: 'Sneaky' }),
      headers: memberHeaders,
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })

  test('duplicate group name is a 409', async () => {
    const { createGroup, ownerHeaders, slug } = await seedGroupFixture()
    await createGroup('Dupe')
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, {
      body: JSON.stringify({ name: 'Dupe' }),
      headers: ownerHeaders,
      method: 'POST',
    })
    expect(res.status).toBe(409)
  })

  test('rename group and reject clashing rename', async () => {
    const { createGroup, ownerHeaders, slug } = await seedGroupFixture()
    const alphaGroup = await createGroup('Alpha')
    await createGroup('Beta')
    const ok = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${alphaGroup}`, {
      body: JSON.stringify({ name: 'Alpha2' }),
      headers: ownerHeaders,
      method: 'PATCH',
    })
    expect(ok.status).toBe(200)
    const clash = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${alphaGroup}`, {
      body: JSON.stringify({ name: 'Beta' }),
      headers: ownerHeaders,
      method: 'PATCH',
    })
    expect(clash.status).toBe(409)
  })

  test('add/remove members and reject non-workspace members', async () => {
    const { createGroup, ownerHeaders, roles, slug } = await seedGroupFixture()
    const gid = await createGroup('Team')
    // Add the workspace member
    const add = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/members`, {
      body: JSON.stringify({ userId: roles.member.user.id }),
      headers: ownerHeaders,
      method: 'POST',
    })
    expect(add.status).toBe(201)

    // A user who is not a workspace member cannot be added
    const outsider = await seedUser(`outsider-${crypto.randomUUID().slice(0, 8)}@example.com`)
    const bad = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/members`, {
      body: JSON.stringify({ userId: outsider.id }),
      headers: ownerHeaders,
      method: 'POST',
    })
    expect(bad.status).toBe(400)

    const detailResponse = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}`, {
      headers: ownerHeaders,
    })
    const detail = await detailResponse.json()
    expect((detail as { members: unknown[] }).members).toHaveLength(1)

    const rm = await fetchNativeApi(
      `http://localhost/api/workspaces/${slug}/groups/${gid}/members/${roles.member.user.id}`,
      { headers: ownerHeaders, method: 'DELETE' },
    )
    expect(rm.status).toBe(200)
  })

  test('set, upsert, and remove a project grant', async () => {
    const { createGroup, ownerHeaders, roles, slug } = await seedGroupFixture()
    const gid = await createGroup('Grantee')
    const project = await seedProject(roles.workspace.id, 'GRP')

    const set = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/grants`, {
      body: JSON.stringify({ projectId: project.id, role: 'viewer' }),
      headers: ownerHeaders,
      method: 'PUT',
    })
    expect(set.status).toBe(200)

    // Upsert to a stronger role
    await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/grants`, {
      body: JSON.stringify({ projectId: project.id, role: 'admin' }),
      headers: ownerHeaders,
      method: 'PUT',
    })
    const detailResponse = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}`, {
      headers: ownerHeaders,
    })
    const detail = await readNativeJson(detailResponse, ApiResults.apiGetGroup)
    expect(detail.grants).toHaveLength(1)
    expect(detail.grants[0].role).toBe('admin')

    const rm = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/grants/${project.id}`, {
      headers: ownerHeaders,
      method: 'DELETE',
    })
    expect(rm.status).toBe(200)
  })

  test('grant on a project outside the workspace is a 404', async () => {
    const { createGroup, ownerHeaders, slug } = await seedGroupFixture()
    const gid = await createGroup('BadGrant')
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/grants`, {
      body: JSON.stringify({ projectId: crypto.randomUUID(), role: 'member' }),
      headers: ownerHeaders,
      method: 'PUT',
    })
    expect(res.status).toBe(404)
  })

  test('member sees only their own groups; owner sees all', async () => {
    const { createGroup, memberHeaders, ownerHeaders, roles, slug } = await seedGroupFixture()
    const mine = await createGroup('Mine')
    await createGroup('Theirs')
    await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${mine}/members`, {
      body: JSON.stringify({ userId: roles.member.user.id }),
      headers: ownerHeaders,
      method: 'POST',
    })

    const memberListResponse = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, {
      headers: memberHeaders,
    })
    const memberList = await readNativeJson(memberListResponse, ApiResults.apiListGroups)
    expect(memberList.map((group) => group.name)).toStrictEqual(['Mine'])

    const ownerListResponse = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, {
      headers: ownerHeaders,
    })
    const ownerList = await readNativeJson(ownerListResponse, ApiResults.apiListGroups)
    expect(ownerList.map((group) => group.name).toSorted()).toStrictEqual(['Mine', 'Theirs'])
  })

  test('member-groups lists every member with a pending (empty) entry', async () => {
    const { createGroup, ownerHeaders, roles, slug } = await seedGroupFixture()
    const gid = await createGroup('Assigned')
    await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/members`, {
      body: JSON.stringify({ userId: roles.member.user.id }),
      headers: ownerHeaders,
      method: 'POST',
    })
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/member-groups`, {
      headers: ownerHeaders,
    })
    expect(res.status).toBe(200)
    const rowsShape = Schema.Array(
      Schema.Struct({
        groups: Schema.Array(Schema.Struct({ name: Schema.String })).pipe(Schema.mutable),
        userId: Schema.String,
      }),
    ).pipe(Schema.mutable)
    const rows = await readNativeJson(res, rowsShape)
    const memberRow = rows.find((row) => row.userId === roles.member.user.id)
    const viewerRow = rows.find((row) => row.userId === roles.viewer.user.id)
    expect(memberRow?.groups.map((group) => group.name)).toStrictEqual(['Assigned'])
    // Pending / default-deny
    expect(viewerRow?.groups).toStrictEqual([])
  })

  test('delete group cascades members and grants', async () => {
    const { createGroup, ownerHeaders, roles, slug } = await seedGroupFixture()
    const gid = await createGroup('Doomed')
    const project = await seedProject(roles.workspace.id, 'DOOM')
    await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/grants`, {
      body: JSON.stringify({ projectId: project.id, role: 'member' }),
      headers: ownerHeaders,
      method: 'PUT',
    })
    const del = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}`, {
      headers: ownerHeaders,
      method: 'DELETE',
    })
    expect(del.status).toBe(200)
    const gone = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}`, {
      headers: ownerHeaders,
    })
    expect(gone.status).toBe(404)
  })
})

describe('groups MCP parity', () => {
  test('create_group + list_groups via MCP', async () => {
    const { ownerHeaders, workspaceId } = await seedGroupFixture()
    const created = await mcpCall(workspaceId, { arguments: { name: 'MCPGroup' }, name: 'create_group' }, ownerHeaders)
    expect('error' in created).toBe(false)
    const list = await callMcpTool(workspaceId, { arguments: {}, name: 'list_groups' }, ownerHeaders)
    const groups = mcpData(list, Schema.Array(Schema.Struct({ name: Schema.String })).pipe(Schema.mutable))
    expect(groups.map((group) => group.name)).toContain('MCPGroup')
  })

  test('create_group rejects member (forbidden)', async () => {
    const { memberHeaders, workspaceId } = await seedGroupFixture()
    const res = await mcpCall(workspaceId, { arguments: { name: 'Nope' }, name: 'create_group' }, memberHeaders)
    expect(toolError(res)?.code).toBe('forbidden')
  })

  test('list_groups via MCP: member sees only their own groups; owner sees all (PROJ-319)', async () => {
    const { memberHeaders, ownerHeaders, roles, workspaceId } = await seedGroupFixture()
    const g1 = mcpData(
      await callMcpTool(workspaceId, { arguments: { name: 'G1' }, name: 'create_group' }, ownerHeaders),
      IdResponse,
    )
    await mcpCall(workspaceId, { arguments: { name: 'G2' }, name: 'create_group' }, ownerHeaders)
    await mcpCall(
      workspaceId,
      { arguments: { groupId: g1.id, userId: roles.member.user.id }, name: 'add_group_member' },
      ownerHeaders,
    )

    const memberList = await callMcpTool(workspaceId, { arguments: {}, name: 'list_groups' }, memberHeaders)
    const memberGroups = mcpData(memberList, Schema.Array(Schema.Struct({ name: Schema.String })).pipe(Schema.mutable))
    expect(memberGroups.map((group) => group.name)).toStrictEqual(['G1'])

    const ownerList = await callMcpTool(workspaceId, { arguments: {}, name: 'list_groups' }, ownerHeaders)
    const ownerGroups = mcpData(ownerList, Schema.Array(Schema.Struct({ name: Schema.String })).pipe(Schema.mutable))
    expect(ownerGroups.map((group) => group.name).toSorted()).toStrictEqual(['G1', 'G2'])
  })

  test('full admin loop over MCP: group -> grant -> member', async () => {
    const { ownerHeaders, roles, workspaceId } = await seedGroupFixture()
    const project = await seedProject(workspaceId, 'LOOP')
    const created = mcpData(
      await callMcpTool(workspaceId, { arguments: { name: 'LoopGroup' }, name: 'create_group' }, ownerHeaders),
      IdResponse,
    )
    const grant = await mcpCall(
      workspaceId,
      { arguments: { groupId: created.id, projectId: project.id, role: 'member' }, name: 'set_group_grant' },
      ownerHeaders,
    )
    expect('error' in grant).toBe(false)
    const addMember = await mcpCall(
      workspaceId,
      { arguments: { groupId: created.id, userId: roles.member.user.id }, name: 'add_group_member' },
      ownerHeaders,
    )
    expect('error' in addMember).toBe(false)

    const detail = mcpData(
      await callMcpTool(workspaceId, { arguments: { id: created.id }, name: 'get_group' }, ownerHeaders),
      Schema.Struct({
        grants: Schema.Array(Schema.Unknown).pipe(Schema.mutable),
        members: Schema.Array(Schema.Unknown).pipe(Schema.mutable),
      }),
    )
    expect(detail.members).toHaveLength(1)
    expect(detail.grants).toHaveLength(1)
  })
})
