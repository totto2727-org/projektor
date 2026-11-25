import { Predicate, Schema } from 'effect'
import { assert, describe, expect, test } from 'vite-plus/test'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'

import { authHeaders, seedWorkspaceRoles, toolError } from './helpers.ts'
import { stringifyOrderedFields, fetchNativeApi, fetchNativeMcpTool, requestOptionsWithBody } from './native-fetch.ts'
import type { McpToolRequest } from './native-fetch.ts'
import { resetRateLimits } from './rate-limit-reset.ts'
import {
  KeyListResponse,
  parseNativeMcpText,
  IdResponse,
  JsonListResponse,
  McpRpcResponse,
  RpcTextResponse,
  readNativeJson,
} from './response-json.ts'

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

describe('projects REST', () => {
  type TestData = Readonly<{
    memberHeaders: Record<string, string>
    memberToken: string
    ownerHeaders: Record<string, string>
    ownerToken: string
    slug: string
    viewerHeaders: Record<string, string>
    viewerToken: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const roles = await seedWorkspaceRoles()
    const { slug } = roles.workspace
    const ownerToken = roles.owner.token
    const memberToken = roles.member.token
    const viewerToken = roles.viewer.token
    const ownerHeaders = authHeaders(ownerToken, slug)
    const memberHeaders = authHeaders(memberToken, slug)
    const viewerHeaders = authHeaders(viewerToken, slug)
    return { memberHeaders, memberToken, ownerHeaders, ownerToken, slug, viewerHeaders, viewerToken }
  }

  test('handles GET /api/projects returns empty list initially', async () => {
    const { ownerHeaders } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/projects', { headers: ownerHeaders })
    expect(res.status).toBe(200)
    const body = await readNativeJson(res, JsonListResponse)
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })

  test('handles POST /api/projects creates a project (owner)', async () => {
    const { ownerHeaders } = await seedTestData()
    const res = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'ALPHA', name: 'Alpha' })),
    )
    expect(res.status).toBe(201)
    const body = await readNativeJson(
      res,
      Schema.Struct({ id: Schema.String, key: Schema.String, name: Schema.String }),
    )
    expect(isNonEmptyText(body.id)).toBe(true)
    expect(body.name).toBe('Alpha')
    expect(body.key).toBe('ALPHA')
  })

  test('handles POST /api/projects accepts lowercase key and uppercases it', async () => {
    const { ownerHeaders } = await seedTestData()
    const res = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'beta', name: 'Beta' })),
    )
    expect(res.status).toBe(201)
    const body = await readNativeJson(res, Schema.Struct({ key: Schema.String }))
    expect(body.key).toBe('BETA')
  })

  test('handles POST /api/projects rejects member role (403)', async () => {
    const { memberHeaders } = await seedTestData()
    const res = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', memberHeaders, JSON.stringify({ key: 'GAMMA', name: 'Gamma' })),
    )
    expect(res.status).toBe(403)
  })

  test('handles POST /api/projects rejects viewer role (403)', async () => {
    const { viewerHeaders } = await seedTestData()
    const res = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', viewerHeaders, JSON.stringify({ key: 'DELTA', name: 'Delta' })),
    )
    expect(res.status).toBe(403)
  })

  test('handles POST /api/projects returns 409 for duplicate key', async () => {
    const { ownerHeaders } = await seedTestData()
    await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'DUPL', name: 'First' })),
    )
    const res = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'DUPL', name: 'Second' })),
    )
    expect(res.status).toBe(409)
  })

  test('handles POST /api/projects returns 400 for invalid key format', async () => {
    const { ownerHeaders } = await seedTestData()
    const res = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'BAD KEY!', name: 'Bad' })),
    )
    expect(res.status).toBe(400)
  })

  test('handles POST /api/projects returns 400 for a key starting with a digit (PROJ-440)', async () => {
    const { ownerHeaders } = await seedTestData()
    const res = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: '2FA', name: 'Leading digit' })),
    )
    expect(res.status).toBe(400)
  })

  test('handles POST /api/projects accepts a key containing digits after the first character (PROJ-440)', async () => {
    const { ownerHeaders } = await seedTestData()
    const res = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'WEB2', name: 'Digit key' })),
    )
    expect(res.status).toBe(201)
  })

  test('handles POST /api/projects returns 400 for name too long', async () => {
    const { ownerHeaders } = await seedTestData()
    const requestOptions = requestOptionsWithBody(
      'POST',
      ownerHeaders,
      stringifyOrderedFields([
        ['name', 'x'.repeat(101)],
        ['key', 'TOOLONG'],
      ]),
    )
    const res = await fetchNativeApi('http://localhost/api/projects', requestOptions)
    expect(res.status).toBe(400)
  })

  test('handles POST /api/projects stores NULL description by default', async () => {
    const { ownerHeaders } = await seedTestData()
    await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'NULLD', name: 'NullDesc' })),
    )
    const listRes = await fetchNativeApi('http://localhost/api/projects', { headers: ownerHeaders })
    const projectsShape = Schema.Array(
      Schema.Struct({ description: Schema.Union([Schema.String, Schema.Null]), key: Schema.String }),
    ).pipe(Schema.mutable)
    const projects = await readNativeJson(listRes, projectsShape)
    const proj = projects.find((project) => project.key === 'NULLD')
    assert.isDefined(proj)
    expect(proj.description).toBeNull()
  })

  test('handles GET /api/projects/:id returns the project', async () => {
    const { ownerHeaders } = await seedTestData()
    const createRes = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'GETME', name: 'GetMe' })),
    )
    const { id } = await readNativeJson(createRes, IdResponse)

    const res = await fetchNativeApi(`http://localhost/api/projects/${id}`, { headers: ownerHeaders })
    expect(res.status).toBe(200)
    const proj = await readNativeJson(res, Schema.Struct({ key: Schema.String, name: Schema.String }))
    expect(proj.name).toBe('GetMe')
    expect(proj.key).toBe('GETME')
  })

  test('handles GET /api/projects/:id returns 404 for missing project', async () => {
    const { ownerHeaders } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/projects/${crypto.randomUUID()}`, {
      headers: ownerHeaders,
    })
    expect(res.status).toBe(404)
  })

  test('handles PATCH /api/projects/:id updates name (owner)', async () => {
    const { ownerHeaders } = await seedTestData()
    const createRes = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'PATCH1', name: 'OldName' })),
    )
    const { id } = await readNativeJson(createRes, IdResponse)

    const patchRes = await fetchNativeApi(
      `http://localhost/api/projects/${id}`,
      requestOptionsWithBody('PATCH', ownerHeaders, JSON.stringify({ name: 'NewName' })),
    )
    expect(patchRes.status).toBe(200)
  })

  test('handles PATCH /api/projects/:id rejects member (403)', async () => {
    const { memberHeaders, ownerHeaders } = await seedTestData()
    const createRes = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'PTGT', name: 'PatchTarget' })),
    )
    const { id } = await readNativeJson(createRes, IdResponse)

    const patchRes = await fetchNativeApi(
      `http://localhost/api/projects/${id}`,
      requestOptionsWithBody('PATCH', memberHeaders, JSON.stringify({ name: 'Hacked' })),
    )
    expect(patchRes.status).toBe(403)
  })

  test('handles PATCH /api/projects/:id archives and unarchives a project', async () => {
    const { ownerHeaders } = await seedTestData()
    const createRes = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'ARCH1', name: 'Archivable' })),
    )
    const { id } = await readNativeJson(createRes, IdResponse)

    const archiveRes = await fetchNativeApi(
      `http://localhost/api/projects/${id}`,
      requestOptionsWithBody('PATCH', ownerHeaders, JSON.stringify({ archived: true })),
    )
    expect(archiveRes.status).toBe(200)

    const listRes = await fetchNativeApi('http://localhost/api/projects', { headers: ownerHeaders })
    const projects = await readNativeJson(listRes, KeyListResponse)
    const keys = projects.map((project) => project.key)
    expect(keys).not.toContain('ARCH1')

    const includeArchivedRes = await fetchNativeApi('http://localhost/api/projects?includeArchived=true', {
      headers: ownerHeaders,
    })
    const withArchivedShape = Schema.Array(
      Schema.Struct({ archived_at: Schema.Union([Schema.Number, Schema.Null]), key: Schema.String }),
    ).pipe(Schema.mutable)
    const withArchived = await readNativeJson(includeArchivedRes, withArchivedShape)
    const archived = withArchived.find((p) => p.key === 'ARCH1')
    assert.isDefined(archived)
    expect(archived.archived_at).not.toBeNull()

    await resetRateLimits()

    const unarchiveRes = await fetchNativeApi(
      `http://localhost/api/projects/${id}`,
      requestOptionsWithBody('PATCH', ownerHeaders, JSON.stringify({ archived: false })),
    )
    expect(unarchiveRes.status).toBe(200)

    const afterUnarchive = await fetchNativeApi('http://localhost/api/projects', {
      headers: ownerHeaders,
    })
    const visibleProjects = await readNativeJson(afterUnarchive, KeyListResponse)
    const afterKeys = visibleProjects.map((p) => p.key)
    expect(afterKeys).toContain('ARCH1')
  })

  test('handles DELETE /api/projects/:id works for owner', async () => {
    const { ownerHeaders } = await seedTestData()
    const createRes = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'DEL1', name: 'ToDelete' })),
    )
    const { id } = await readNativeJson(createRes, IdResponse)

    const delRes = await fetchNativeApi(`http://localhost/api/projects/${id}`, {
      headers: ownerHeaders,
      method: 'DELETE',
    })
    expect(delRes.status).toBe(200)
  })

  test('handles DELETE /api/projects/:id rejects member (403)', async () => {
    const { memberHeaders, ownerHeaders } = await seedTestData()
    const createRes = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'NODEL', name: 'NoDelete' })),
    )
    const { id } = await readNativeJson(createRes, IdResponse)

    const delRes = await fetchNativeApi(`http://localhost/api/projects/${id}`, {
      headers: memberHeaders,
      method: 'DELETE',
    })
    expect(delRes.status).toBe(403)
  })
})

describe('projects MCP', () => {
  type TestData = Readonly<{
    memberHeaders: Record<string, string>
    ownerHeaders: Record<string, string>
    ownerToken: string
    slug: string
    viewerHeaders: Record<string, string>
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const roles = await seedWorkspaceRoles()
    const { slug } = roles.workspace
    const workspaceId = roles.workspace.id
    const ownerToken = roles.owner.token
    const ownerHeaders = authHeaders(ownerToken, slug)
    const memberHeaders = authHeaders(roles.member.token, slug)
    const viewerHeaders = authHeaders(roles.viewer.token, slug)
    return { memberHeaders, ownerHeaders, ownerToken, slug, viewerHeaders, workspaceId }
  }

  test('list_projects returns empty list initially', async () => {
    const { ownerHeaders, workspaceId } = await seedTestData()
    const res = await callMcpTool(workspaceId, { arguments: {}, name: 'list_projects' }, ownerHeaders)
    expect('error' in res).toBe(false)
    expect(toolError(res)).toBeUndefined()
    const data = parseNativeMcpText(res.result.content[0].text, JsonListResponse)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })

  test('create_project succeeds for owner', async () => {
    const { ownerHeaders, workspaceId } = await seedTestData()
    const res = await callMcpTool(
      workspaceId,
      { arguments: { key: 'MCP', name: 'MCP Project' }, name: 'create_project' },
      ownerHeaders,
    )
    expect('error' in res).toBe(false)
    expect(toolError(res)).toBeUndefined()
    const data = parseNativeMcpText(
      res.result.content[0].text,
      Schema.Struct({ id: Schema.String, key: Schema.String }),
    )
    expect(isNonEmptyText(data.id)).toBe(true)
    expect(data.key).toBe('MCP')
  })

  test('create_project uppercases key', async () => {
    const { ownerHeaders, workspaceId } = await seedTestData()
    const res = await callMcpTool(
      workspaceId,
      { arguments: { key: 'lower', name: 'Lower' }, name: 'create_project' },
      ownerHeaders,
    )
    const data = parseNativeMcpText(res.result.content[0].text, Schema.Struct({ key: Schema.String }))
    expect(data.key).toBe('LOWER')
  })

  test('create_project rejects member role', async () => {
    const { memberHeaders, workspaceId } = await seedTestData()
    const res = await mcpCall(
      workspaceId,
      { arguments: { key: 'BLKD', name: 'Blocked' }, name: 'create_project' },
      memberHeaders,
    )
    expect(toolError(res)?.code).toBe('forbidden')
  })

  test('create_project rejects viewer role', async () => {
    const { viewerHeaders, workspaceId } = await seedTestData()
    const res = await mcpCall(
      workspaceId,
      { arguments: { key: 'BLKD', name: 'Blocked' }, name: 'create_project' },
      viewerHeaders,
    )
    expect(toolError(res)?.code).toBe('forbidden')
  })

  test('create_project rejects duplicate key', async () => {
    const { ownerHeaders, workspaceId } = await seedTestData()
    await mcpCall(workspaceId, { arguments: { key: 'DUPL', name: 'First' }, name: 'create_project' }, ownerHeaders)
    const res = await mcpCall(
      workspaceId,
      { arguments: { key: 'DUPL', name: 'Second' }, name: 'create_project' },
      ownerHeaders,
    )
    expect(toolError(res)?.code).toBe('conflict')
  })

  test('create_project rejects invalid key format', async () => {
    const { ownerHeaders, workspaceId } = await seedTestData()
    const res = await mcpCall(
      workspaceId,
      { arguments: { key: 'BAD KEY!', name: 'Bad' }, name: 'create_project' },
      ownerHeaders,
    )
    expect(toolError(res)?.code).toBe('validation')
  })

  test('create_project rejects name too long', async () => {
    const { ownerHeaders, workspaceId } = await seedTestData()
    const res = await mcpCall(
      workspaceId,
      { arguments: { name: 'x'.repeat(101), key: 'TOOLNG' }, name: 'create_project' },
      ownerHeaders,
    )
    expect(toolError(res)?.code).toBe('validation')
  })

  test('create_project stores NULL description by default', async () => {
    const { ownerHeaders, workspaceId } = await seedTestData()
    await mcpCall(workspaceId, { arguments: { key: 'MCPND', name: 'NullDesc' }, name: 'create_project' }, ownerHeaders)

    const listRes = await callMcpTool(workspaceId, { arguments: {}, name: 'list_projects' }, ownerHeaders)
    const projects = parseNativeMcpText(
      listRes.result.content[0].text,
      Schema.Array(Schema.Struct({ description: Schema.Union([Schema.String, Schema.Null]), key: Schema.String })).pipe(
        Schema.mutable,
      ),
    )
    const proj = projects.find((project) => project.key === 'MCPND')
    assert.isDefined(proj)
    expect(proj.description).toBeNull()
  })

  test('covers REST GET /api/projects returns workspace_slug and open_issue_count fields', async () => {
    const { ownerHeaders } = await seedTestData()
    await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'SHAPE', name: 'Shape Check' })),
    )

    const res = await fetchNativeApi('http://localhost/api/projects', { headers: ownerHeaders })
    const projects = await readNativeJson(
      res,
      Schema.Array(
        Schema.Struct({
          key: Schema.String,
          open_issue_count: Schema.Number,
          workspace_id: Schema.String,
          workspace_name: Schema.String,
          workspace_slug: Schema.String,
        }),
      ).pipe(Schema.mutable),
    )
    const proj = projects.find((project) => project.key === 'SHAPE')
    assert.isDefined(proj)
    expect(isNonEmptyText(proj.workspace_id)).toBe(true)
    expect(proj.workspace_slug).toSatisfy(Predicate.isString)
    expect(proj.workspace_name).toSatisfy(Predicate.isString)
    expect(proj.open_issue_count).toSatisfy(Predicate.isNumber)
    expect(proj.open_issue_count).toBe(0)
  })

  test('covers REST and MCP list_projects return the same keys', async () => {
    const { ownerHeaders, workspaceId } = await seedTestData()
    // Create via REST
    await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', ownerHeaders, JSON.stringify({ key: 'PARITY', name: 'Parity Test' })),
    )

    const restRes = await fetchNativeApi('http://localhost/api/projects', { headers: ownerHeaders })
    const restProjects = await readNativeJson(
      restRes,
      Schema.Array(Schema.Struct({ key: Schema.String })).pipe(Schema.mutable),
    )

    const mcpRes = await callMcpTool(workspaceId, { arguments: {}, name: 'list_projects' }, ownerHeaders)
    const mcpProjects = parseNativeMcpText(mcpRes.result.content[0].text, KeyListResponse)

    expect(restProjects.map((p) => p.key)).toStrictEqual(mcpProjects.map((p) => p.key))
  })

  test('update_project archives a project and list_projects excludes it by default', async () => {
    const { ownerHeaders, workspaceId } = await seedTestData()
    const createRes = await callMcpTool(
      workspaceId,
      { arguments: { key: 'MARCH', name: 'MCP Archivable' }, name: 'create_project' },
      ownerHeaders,
    )
    const { id } = parseNativeMcpText(createRes.result.content[0].text, IdResponse)

    const updateRes = await mcpCall(
      workspaceId,
      { arguments: { id, archived: true }, name: 'update_project' },
      ownerHeaders,
    )
    expect('error' in updateRes).toBe(false)
    expect(toolError(updateRes)).toBeUndefined()

    const listRes = await callMcpTool(workspaceId, { arguments: {}, name: 'list_projects' }, ownerHeaders)
    const keys = parseNativeMcpText(listRes.result.content[0].text, KeyListResponse).map((p) => p.key)
    expect(keys).not.toContain('MARCH')

    const includeArchivedRes = await callMcpTool(
      workspaceId,
      { arguments: { includeArchived: true }, name: 'list_projects' },
      ownerHeaders,
    )
    const includeArchivedKeys = parseNativeMcpText(includeArchivedRes.result.content[0].text, KeyListResponse).map(
      (p) => p.key,
    )
    expect(includeArchivedKeys).toContain('MARCH')
  })

  test('covers REST create_project and MCP create_project enforce the same role guard', async () => {
    const { memberHeaders, workspaceId } = await seedTestData()
    const restRes = await fetchNativeApi(
      'http://localhost/api/projects',
      requestOptionsWithBody('POST', memberHeaders, JSON.stringify({ key: 'MEMBR', name: 'ByMember' })),
    )
    const mcpRes = await mcpCall(
      workspaceId,
      { arguments: { key: 'MEMBR', name: 'ByMember' }, name: 'create_project' },
      memberHeaders,
    )

    // Both must reject member
    expect(restRes.status).toBe(403)
    expect(toolError(mcpRes)?.code).toBe('forbidden')
  })
})

describe('handles GET /api/projects cross-workspace', () => {
  test('returns projects from all workspaces the user belongs to', async () => {
    const { seedFixture, seedProject, seedWorkspace, seedMember, seedGroupGrant, seedUserToken } =
      await import('./helpers.ts')

    const ws1 = await seedFixture({ role: 'owner' })
    const ws2 = await seedWorkspace()
    await seedProject(ws1.workspace.id, 'WS1P')
    const ws2p = await seedProject(ws2.id, 'WS2P')
    await seedMember(ws2.id, ws1.user.id, 'member')
    // PROJ-311: a member sees a project only via a grant (owner-of-ws1 bypasses in ws1).
    await seedGroupGrant(ws2.id, ws1.user.id, ws2p.id)

    const userToken = await seedUserToken(ws1.user.id)
    const res = await fetchNativeApi('http://localhost/api/projects', {
      headers: { Authorization: `Bearer ${userToken}` },
    })
    expect(res.status).toBe(200)
    const projects = await readNativeJson(res, KeyListResponse)
    const keys = projects.map((project) => project.key)
    expect(keys).toContain('WS1P')
    expect(keys).toContain('WS2P')
  })

  test('does not return projects from workspaces the user is not a member of', async () => {
    const { seedFixture, seedProject, seedWorkspace } = await import('./helpers.ts')

    const user = await seedFixture({ role: 'owner' })
    const other = await seedWorkspace()
    await seedProject(user.workspace.id, 'MINE')
    await seedProject(other.id, 'NOTMINE')

    const res = await fetchNativeApi('http://localhost/api/projects', {
      headers: { Authorization: `Bearer ${user.token}` },
    })
    expect(res.status).toBe(200)
    const projects = await readNativeJson(res, KeyListResponse)
    const keys = projects.map((project) => project.key)
    expect(keys).toContain('MINE')
    expect(keys).not.toContain('NOTMINE')
  })

  test('returns 401 with no auth', async () => {
    const res = await fetchNativeApi('http://localhost/api/projects')
    expect(res.status).toBe(401)
  })

  test('open_issue_count reflects non-done issues only', async () => {
    const { seedFixture, seedProject, seedIssue } = await import('./helpers.ts')

    const fixture = await seedFixture({ role: 'owner' })
    const project = await seedProject(fixture.workspace.id, 'ICNT')

    await seedIssue(fixture.workspace.id, project.id, fixture.user.id, { status: 'backlog' })
    await seedIssue(fixture.workspace.id, project.id, fixture.user.id, { status: 'todo' })
    await seedIssue(fixture.workspace.id, project.id, fixture.user.id, { status: 'done' })

    const res = await fetchNativeApi('http://localhost/api/projects', {
      headers: { Authorization: `Bearer ${fixture.token}` },
    })
    const projects = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ key: Schema.String, open_issue_count: Schema.Number })).pipe(Schema.mutable),
    )
    const proj = projects.find((selectedProject) => selectedProject.key === 'ICNT')
    assert.isDefined(proj)
    expect(proj.open_issue_count).toBe(2)
  })
})
