import { Iterable, Effect, Result, Schema, pipe } from 'effect'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { resetProvisioningCacheForTests } from '#commands/provisioning.ts'
import { apiOrigin } from '#deployment'
import { resetAuthCachesForTests } from '#services/authentication.ts'
import { runTestEffect } from '#tests/run-effect.ts'
import { makeRequestServices, RequestServices } from '@/request.ts'
import type { RequestScope } from '@/server/request-context.ts'
import { inMemoryKV, testEnvironment } from '@/server/test/resources.ts'
import { createTestDatabase } from '@/test/database.ts'

import type * as Actions from './actions.ts'
import { ConnectorSchema, GroupDetailSchema, McpInfoSchema, TokenSchema } from './schemas.ts'
import { renderConnectAgent, renderConnectors, renderGroups, renderTokens } from './server.tsx'

const decodeToken = Schema.decodeUnknownResult(TokenSchema)
const decodeConnector = Schema.decodeUnknownResult(ConnectorSchema)
const decodeGroupDetail = Schema.decodeUnknownResult(GroupDetailSchema)
const decodeMcpInfo = Schema.decodeUnknownResult(McpInfoSchema)

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }))
vi.mock('./actions', () => ({
  createGroup: vi.fn<typeof Actions.createGroup>(),
  renameGroup: vi.fn<typeof Actions.renameGroup>(),
  describeGroup: vi.fn<typeof Actions.describeGroup>(),
  deleteGroup: vi.fn<typeof Actions.deleteGroup>(),
  addGroupMember: vi.fn<typeof Actions.addGroupMember>(),
  removeGroupMember: vi.fn<typeof Actions.removeGroupMember>(),
  createGroupGrant: vi.fn<typeof Actions.createGroupGrant>(),
  setGroupGrant: vi.fn<typeof Actions.setGroupGrant>(),
  removeGroupGrant: vi.fn<typeof Actions.removeGroupGrant>(),
  createToken: vi.fn<typeof Actions.createToken>(),
  revokeToken: vi.fn<typeof Actions.revokeToken>(),
  disconnectConnector: vi.fn<typeof Actions.disconnectConnector>(),
}))
const workspace = { id: 'w1', name: 'Alpha', slug: 'alpha', role: 'owner' as const }
const project = {
  id: 'p1',
  name: 'Project',
  key: 'PROJ',
  slug: 'project',
  description: null,
  workspace_id: 'w1',
  workspace_name: 'Alpha',
  workspace_slug: 'alpha',
  open_issue_count: 0,
  backlog_issue_count: 0,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
}
const scope: RequestScope = {
  user: { id: 'u1', name: 'Owner', email: 'owner@example.test' },
  workspaces: [workspace],
  projects: [project],
  selection: { kind: 'workspace', workspace },
}
const token = {
  id: 't1',
  name: 'Agent token',
  scopes: '["read"]',
  lastUsedAt: null,
  expiresAt: null,
  createdAt: 1,
}
const connector = {
  id: 'c1',
  client: 'client-one',
  clientId: 'client-one',
  scopes: ['read', 'write'],
  grantedAt: 1,
  expiresAt: 2_000_000_000,
}
const url = new URL('https://front.example/settings?workspace=alpha')
const databases: ReturnType<typeof createTestDatabase>[] = []
const fixture = async function fixture(currentScope = scope) {
  resetAuthCachesForTests()
  resetProvisioningCacheForTests()
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
		INSERT INTO users (id,email,name,created_at) VALUES ('u1','owner@example.test','Owner',1);
		INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w1','Alpha','alpha',1),('w2','Beta','beta',1);
		INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',1);
		INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES ('p1','w1','Project','PROJ',1,1),('p2','w2','Private','PRIV',1,1);
		INSERT INTO user_groups (id,workspace_id,name,description,created_at) VALUES ('g1','w1','Team','Description',1),('g2','w1','Other group',NULL,1),('foreign','w2','Private group',NULL,1);
		INSERT INTO user_group_members (group_id,user_id,added_at,added_by) VALUES ('g1','u1',1,'u1');
		INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','member');
		INSERT INTO api_tokens (id,user_id,workspace_id,name,token_hash,scopes,created_at) VALUES ('t1','u1','w1','Agent token','secret-token-hash','["read"]',1),('foreign-token','u1','w2','Private token','private-hash','["read"]',1);
	`)
  const selectedWorkspace =
    currentScope.selection.kind === 'workspace' || currentScope.selection.kind === 'project'
      ? currentScope.selection.workspace
      : null
  if (selectedWorkspace) {
    database.sqlite
      .prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?')
      .run(selectedWorkspace.role, selectedWorkspace.id, 'u1')
  }
  const calls = vi.spyOn(globalThis, 'fetch')
  const oauthKV = inMemoryKV()
  await oauthKV.put(
    'grant:u1:c1',
    JSON.stringify({
      id: connector.id,
      userId: 'u1',
      clientId: connector.clientId,
      scope: connector.scopes,
      metadata: { workspaceId: workspace.id },
      createdAt: connector.grantedAt,
      expiresAt: connector.expiresAt,
    }),
  )
  await oauthKV.put(
    'grant:u1:foreign',
    JSON.stringify({
      id: 'foreign',
      userId: 'u1',
      clientId: 'private-client',
      scope: ['read'],
      metadata: { workspaceId: 'w2' },
      createdAt: 1,
      expiresAt: connector.expiresAt,
    }),
  )
  const request = new Request(url)
  const services = await runTestEffect(
    makeRequestServices(request, testEnvironment(database.db, 'owner@example.test', { OAUTH_KV: oauthKV })),
  )
  const authenticated = await runTestEffect(services.scope())
  const requestScope: RequestScope = { ...currentScope, user: authenticated.user, auth: authenticated.auth }
  function run<T, E>(effect: Effect.Effect<T, E, RequestServices>): Promise<T> {
    return runTestEffect(effect.pipe(Effect.provideService(RequestServices, services)))
  }
  return { ...database, scope: requestScope, calls, run }
}

describe('settings authorized direct D1 SSR', () => {
  afterEach(() => {
    Iterable.forEach(databases.splice(0), (database) => {
      database.close()
    })
  })

  test.each(['groups', 'members'] as const)('keeps canonical native URL %s view and original DTOs', async (view) => {
    const testFixture = await fixture()
    const node = await testFixture.run(
      renderGroups(testFixture.scope, new URL(`https://front.example/settings/groups?workspace=alpha&view=${view}`)),
    )
    expect(node.props.view).toBe(view)
    expect(node.props.initialData.groups.map((group: { id: string }) => group.id)).toStrictEqual(['g2', 'g1'])
    expect(node.props.initialData.details.find((group: { id: string }) => group.id === 'g1')).toMatchObject({
      grantCount: 1,
      grants: [{ projectId: 'p1', projectKey: 'PROJ', projectName: 'Project', role: 'member' }],
      id: 'g1',
      memberCount: 1,
      members: [{ email: 'owner@example.test', name: 'owner', userId: 'u1' }],
    })
    expect(node.props.initialData.projects.map((listedProject: { id: string }) => listedProject.id)).toStrictEqual([
      'p1',
    ])
    expect(node.props.initialData.memberGroups).toStrictEqual([{ groups: [{ id: 'g1', name: 'Team' }], userId: 'u1' }])
    expect(testFixture.calls).not.toHaveBeenCalled()
    expect(renderToStaticMarkup(node)).toContain(`id="group-tabpanel-${view}"`)
  })

  test('rejects malformed view before database queries', async () => {
    const testFixture = await fixture()
    const prepare = vi.spyOn(testFixture.db, 'prepare')
    await expect(
      testFixture.run(renderGroups(testFixture.scope, new URL('https://front.example/settings/groups?view=unknown'))),
    ).rejects.toMatchObject({ _tag: 'ScopeError', status: 400 })
    expect(prepare).not.toHaveBeenCalled()
  })

  test('filters member groups and avoids every management detail/member-group query for nonadmins', async () => {
    const member = { ...workspace, role: 'member' as const }
    const memberScope: RequestScope = {
      ...scope,
      workspaces: [member],
      selection: { kind: 'workspace', workspace: member },
    }
    const testFixture = await fixture(memberScope)
    const prepare = vi.spyOn(testFixture.db, 'prepare')
    const node = await testFixture.run(
      renderGroups(testFixture.scope, new URL('https://front.example/settings/groups?view=members')),
    )
    expect(node.props.view).toBe('groups')
    expect(node.props.initialData.groups.map((group: { id: string }) => group.id)).toStrictEqual(['g1'])
    expect(node.props.initialData.details).toStrictEqual([])
    expect(node.props.initialData.memberGroups).toStrictEqual([])
    expect(prepare.mock.calls.some(([query]) => /left join "user_group_members"/i.test(query))).toBe(false)
    expect(prepare.mock.calls.some(([query]) => /"added_by".*inner join "users"/su.test(query))).toBe(false)
    expect(renderToStaticMarkup(node)).toContain('Only owners and admins manage groups.')
  })

  test('loads token metadata only from selected workspace and never serializes credential hashes', async () => {
    const testFixture = await fixture()
    const node = await testFixture.run(renderTokens(testFixture.scope, url))
    expect(node.props.initialTokens).toStrictEqual([token])
    expect(node.props.initialGrants).toStrictEqual([connector])
    expect(node.props.mcpCommandTemplate).toContain('--header "Authorization: Bearer {{TOKEN}}"')
    expect(node.props.mcpCommandTemplate).toContain('--header "X-Workspace-Slug: alpha"')
    expect(JSON.stringify(node.props)).not.toContain('secret-token-hash')
    expect(testFixture.calls).not.toHaveBeenCalled()
    expect(renderToStaticMarkup(node)).toContain('Agent token')
  })

  test('denies member token reads before credential DB access while preserving personal connector and guide controls', async () => {
    const member = { ...workspace, role: 'member' as const }
    const memberScope: RequestScope = {
      ...scope,
      workspaces: [member],
      selection: { kind: 'workspace', workspace: member },
    }
    const testFixture = await fixture(memberScope)
    const prepare = vi.spyOn(testFixture.db, 'prepare')
    const node = await testFixture.run(renderTokens(testFixture.scope, url))
    // Core rechecks live membership, but must not load token metadata for a member.
    expect(prepare.mock.calls.some(([query]) => /\bapi_tokens\b/u.test(query))).toBe(false)
    expect(node.props.initialTokens).toStrictEqual([])
    expect(node.props.tokensDenied).toBe(true)
    expect(node.props.initialGrants).toStrictEqual([connector])
    const html = renderToStaticMarkup(node)
    expect(html).toContain('Connect Claude Code')
    expect(html).toContain('Disconnect')
    expect(html).toContain('Access denied.')
  })

  test('uses verified native auth for connector credentials and deployment MCP configuration without HTTP', async () => {
    const testFixture = await fixture()
    const connectors = await testFixture.run(renderConnectors(testFixture.scope, url))
    expect(connectors.props.initialGrants).toStrictEqual([connector])
    const guide = await testFixture.run(renderConnectAgent(testFixture.scope, url))
    expect(guide.props.mcpUrl).toBe(`${apiOrigin}/mcp/w1`)
    expect(testFixture.calls).not.toHaveBeenCalled()
  })

  test('rejects forged selected workspace membership before DB', async () => {
    const deniedScope: RequestScope = { ...scope, workspaces: [] }
    const testFixture = await fixture(deniedScope)
    const prepare = vi.spyOn(testFixture.db, 'prepare')
    expect(renderToStaticMarkup(await testFixture.run(renderGroups(testFixture.scope, url)))).toContain(
      'Only workspace owners and admins',
    )
    expect(prepare).not.toHaveBeenCalled()
  })

  test('preserves forbidden connector guidance and optional unavailable MCP metadata', async () => {
    const testFixture = await fixture()
    const unverified: RequestScope = { ...testFixture.scope, auth: undefined }
    const node = await testFixture.run(renderTokens(unverified, url))
    expect(node.props.initialTokens).toBeUndefined()
    expect(renderToStaticMarkup(node)).toContain('Access denied.')
    expect(renderToStaticMarkup(await testFixture.run(renderConnectors(unverified, url)))).toContain(
      'Signed-in members only.',
    )
  })

  test('propagates core DB failures with redacted diagnostics', async () => {
    const testFixture = await fixture()
    testFixture.sqlite.exec('DROP TABLE user_groups')
    const error = await testFixture.run(
      renderGroups(testFixture.scope, url).pipe(Effect.catch((caughtError) => Effect.succeed(caughtError))),
    )
    expect(error).toMatchObject({
      _tag: 'ApiError',
      message: 'An unexpected error occurred.',
      status: 500,
    })
    expect(JSON.stringify(error)).not.toContain('user_groups')
  })

  test('keeps concrete DTO validation for metadata, group roles and MCP config', () => {
    const invalidTokenScopes = pipe(decodeToken({ ...token, scopes: ['read'] }), Result.flip, Result.getOrUndefined)
    expect(invalidTokenScopes?.message).toContain('["scopes"]')
    const invalidConnectorExpiry = pipe(
      decodeConnector({ ...connector, expiresAt: 'tomorrow' }),
      Result.flip,
      Result.getOrUndefined,
    )
    expect(invalidConnectorExpiry?.message).toContain('["expiresAt"]')
    const invalidGroupRole = pipe(
      decodeGroupDetail({
        id: 'g1',
        name: 'Team',
        description: null,
        members: [],
        grants: [{ projectId: 'p1', projectName: 'Project', projectKey: 'PROJ', role: 'owner' }],
      }),
      Result.flip,
      Result.getOrUndefined,
    )
    expect(invalidGroupRole?.message).toContain('["grants"][0]["role"]')
    const invalidMcpUrl = pipe(decodeMcpInfo({ mcpUrl: 42 }), Result.flip, Result.getOrUndefined)
    expect(invalidMcpUrl?.message).toContain('["mcpUrl"]')
  })
})
