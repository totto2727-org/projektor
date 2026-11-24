import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { authHeaders, seedProject, seedUser, seedWorkspaceRoles, toolError } from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

async function mcpCall<T>(
  workspaceId: string,
  name: string,
  args: unknown,
  headers: Record<string, string>,
): Promise<JsonRpcResult<T> | JsonRpcError> {
  const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  return res.json()
}

function isMcpError(r: JsonRpcResult | JsonRpcError): r is JsonRpcError {
  return 'error' in r
}

function mcpData<T>(r: JsonRpcResult<{ content: { text: string }[] }> | JsonRpcError): T {
  if (isMcpError(r)) {
    throw new Error(`MCP error: ${r.error.message}`)
  }
  const te = toolError(r)
  if (te) {
    throw new Error(`MCP tool error (${te.code}): ${te.message}`)
  }
  return JSON.parse(r.result.content[0].text) as T
}

describe('Groups REST', () => {
  let roles: Awaited<ReturnType<typeof seedWorkspaceRoles>>
  let slug: string
  let ownerHeaders: Record<string, string>
  let memberHeaders: Record<string, string>

  beforeEach(async () => {
    roles = await seedWorkspaceRoles()
    slug = roles.workspace.slug
    ownerHeaders = authHeaders(roles.owner.token, slug)
    memberHeaders = authHeaders(roles.member.token, slug)
  })

  async function createGroup(name: string, headers = ownerHeaders): Promise<string> {
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name }),
    })
    expect(res.status).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  test('owner can create and list a group', async () => {
    await createGroup('Engineering')
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, {
      headers: ownerHeaders,
    })
    expect(res.status).toBe(200)
    const groups = (await res.json()) as {
      name: string
      memberCount: number
      grantCount: number
    }[]
    const g = groups.find((x) => x.name === 'Engineering')
    expect(g).toBeTruthy()
    expect(g!.memberCount).toBe(0)
    expect(g!.grantCount).toBe(0)
  })

  test('member cannot create a group (403)', async () => {
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({ name: 'Sneaky' }),
    })
    expect(res.status).toBe(403)
  })

  test('duplicate group name is a 409', async () => {
    await createGroup('Dupe')
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'Dupe' }),
    })
    expect(res.status).toBe(409)
  })

  test('rename group and reject clashing rename', async () => {
    const a = await createGroup('Alpha')
    await createGroup('Beta')
    const ok = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${a}`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'Alpha2' }),
    })
    expect(ok.status).toBe(200)
    const clash = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${a}`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'Beta' }),
    })
    expect(clash.status).toBe(409)
  })

  test('add/remove members and reject non-workspace members', async () => {
    const gid = await createGroup('Team')
    // Add the workspace member
    const add = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/members`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ userId: roles.member.user.id }),
    })
    expect(add.status).toBe(201)

    // A user who is not a workspace member cannot be added
    const outsider = await seedUser(`outsider-${crypto.randomUUID().slice(0, 8)}@example.com`)
    const bad = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/members`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ userId: outsider.id }),
    })
    expect(bad.status).toBe(400)

    const detail = await (
      await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}`, {
        headers: ownerHeaders,
      })
    ).json()
    expect((detail as { members: unknown[] }).members).toHaveLength(1)

    const rm = await fetchNativeApi(
      `http://localhost/api/workspaces/${slug}/groups/${gid}/members/${roles.member.user.id}`,
      { method: 'DELETE', headers: ownerHeaders },
    )
    expect(rm.status).toBe(200)
  })

  test('set, upsert, and remove a project grant', async () => {
    const gid = await createGroup('Grantee')
    const project = await seedProject(roles.workspace.id, 'GRP')

    const set = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/grants`, {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({ projectId: project.id, role: 'viewer' }),
    })
    expect(set.status).toBe(200)

    // Upsert to a stronger role
    await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/grants`, {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({ projectId: project.id, role: 'admin' }),
    })
    const detail = (await (
      await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}`, {
        headers: ownerHeaders,
      })
    ).json()) as { grants: { projectId: string; role: string }[] }
    expect(detail.grants).toHaveLength(1)
    expect(detail.grants[0].role).toBe('admin')

    const rm = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/grants/${project.id}`, {
      method: 'DELETE',
      headers: ownerHeaders,
    })
    expect(rm.status).toBe(200)
  })

  test('grant on a project outside the workspace is a 404', async () => {
    const gid = await createGroup('BadGrant')
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/grants`, {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({ projectId: crypto.randomUUID(), role: 'member' }),
    })
    expect(res.status).toBe(404)
  })

  test('member sees only their own groups; owner sees all', async () => {
    const mine = await createGroup('Mine')
    await createGroup('Theirs')
    await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${mine}/members`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ userId: roles.member.user.id }),
    })

    const memberList = (await (
      await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, { headers: memberHeaders })
    ).json()) as { name: string }[]
    expect(memberList.map((g) => g.name)).toEqual(['Mine'])

    const ownerList = (await (
      await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups`, { headers: ownerHeaders })
    ).json()) as { name: string }[]
    expect(ownerList.map((g) => g.name).sort()).toEqual(['Mine', 'Theirs'])
  })

  test('member-groups lists every member with a pending (empty) entry', async () => {
    const gid = await createGroup('Assigned')
    await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/members`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ userId: roles.member.user.id }),
    })
    const res = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/member-groups`, {
      headers: ownerHeaders,
    })
    expect(res.status).toBe(200)
    const rows = (await res.json()) as { userId: string; groups: Array<{ name: string }> }[]
    const memberRow = rows.find((r) => r.userId === roles.member.user.id)
    const viewerRow = rows.find((r) => r.userId === roles.viewer.user.id)
    expect(memberRow?.groups.map((g) => g.name)).toEqual(['Assigned'])
    expect(viewerRow?.groups).toEqual([]) // pending / default-deny
  })

  test('delete group cascades members and grants', async () => {
    const gid = await createGroup('Doomed')
    const project = await seedProject(roles.workspace.id, 'DOOM')
    await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}/grants`, {
      method: 'PUT',
      headers: ownerHeaders,
      body: JSON.stringify({ projectId: project.id, role: 'member' }),
    })
    const del = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}`, {
      method: 'DELETE',
      headers: ownerHeaders,
    })
    expect(del.status).toBe(200)
    const gone = await fetchNativeApi(`http://localhost/api/workspaces/${slug}/groups/${gid}`, {
      headers: ownerHeaders,
    })
    expect(gone.status).toBe(404)
  })
})

describe('Groups MCP parity', () => {
  let roles: Awaited<ReturnType<typeof seedWorkspaceRoles>>
  let workspaceId: string
  let ownerHeaders: Record<string, string>
  let memberHeaders: Record<string, string>

  beforeEach(async () => {
    roles = await seedWorkspaceRoles()
    workspaceId = roles.workspace.id
    ownerHeaders = authHeaders(roles.owner.token, roles.workspace.slug)
    memberHeaders = authHeaders(roles.member.token, roles.workspace.slug)
  })

  test('create_group + list_groups via MCP', async () => {
    const created = await mcpCall(workspaceId, 'create_group', { name: 'MCPGroup' }, ownerHeaders)
    expect(isMcpError(created)).toBe(false)
    const list = (await mcpCall(workspaceId, 'list_groups', {}, ownerHeaders)) as JsonRpcResult<{
      content: { text: string }[]
    }>
    const groups = mcpData<{ name: string }[]>(list)
    expect(groups.map((g) => g.name)).toContain('MCPGroup')
  })

  test('create_group rejects member (forbidden)', async () => {
    const res = await mcpCall(workspaceId, 'create_group', { name: 'Nope' }, memberHeaders)
    expect(toolError(res)?.code).toBe('forbidden')
  })

  test('list_groups via MCP: member sees only their own groups; owner sees all (PROJ-319)', async () => {
    const g1 = mcpData<{ id: string }>(
      (await mcpCall(workspaceId, 'create_group', { name: 'G1' }, ownerHeaders)) as JsonRpcResult<{
        content: { text: string }[]
      }>,
    )
    await mcpCall(workspaceId, 'create_group', { name: 'G2' }, ownerHeaders)
    await mcpCall(workspaceId, 'add_group_member', { groupId: g1.id, userId: roles.member.user.id }, ownerHeaders)

    const memberList = (await mcpCall(workspaceId, 'list_groups', {}, memberHeaders)) as JsonRpcResult<{
      content: { text: string }[]
    }>
    const memberGroups = mcpData<{ name: string }[]>(memberList)
    expect(memberGroups.map((g) => g.name)).toEqual(['G1'])

    const ownerList = (await mcpCall(workspaceId, 'list_groups', {}, ownerHeaders)) as JsonRpcResult<{
      content: { text: string }[]
    }>
    const ownerGroups = mcpData<{ name: string }[]>(ownerList)
    expect(ownerGroups.map((g) => g.name).sort()).toEqual(['G1', 'G2'])
  })

  test('full admin loop over MCP: group -> grant -> member', async () => {
    const project = await seedProject(workspaceId, 'LOOP')
    const created = mcpData<{ id: string }>(
      (await mcpCall(workspaceId, 'create_group', { name: 'LoopGroup' }, ownerHeaders)) as JsonRpcResult<{
        content: { text: string }[]
      }>,
    )
    const grant = await mcpCall(
      workspaceId,
      'set_group_grant',
      { groupId: created.id, projectId: project.id, role: 'member' },
      ownerHeaders,
    )
    expect(isMcpError(grant)).toBe(false)
    const addMember = await mcpCall(
      workspaceId,
      'add_group_member',
      { groupId: created.id, userId: roles.member.user.id },
      ownerHeaders,
    )
    expect(isMcpError(addMember)).toBe(false)

    const detail = mcpData<{ members: unknown[]; grants: unknown[] }>(
      (await mcpCall(workspaceId, 'get_group', { id: created.id }, ownerHeaders)) as JsonRpcResult<{
        content: { text: string }[]
      }>,
    )
    expect(detail.members).toHaveLength(1)
    expect(detail.grants).toHaveLength(1)
  })
})
