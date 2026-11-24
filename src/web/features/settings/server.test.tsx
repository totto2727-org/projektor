import { Iterable, Effect, Schema } from 'effect'
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

import { ConnectorSchema, GroupDetailSchema, McpInfoSchema, TokenSchema } from './schemas.ts'
import { renderConnectAgent, renderConnectors, renderGroups, renderTokens } from './server.tsx'

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }))
vi.mock('./actions', () => ({
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  describeGroup: vi.fn(),
  deleteGroup: vi.fn(),
  addGroupMember: vi.fn(),
  removeGroupMember: vi.fn(),
  createGroupGrant: vi.fn(),
  setGroupGrant: vi.fn(),
  removeGroupGrant: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  disconnectConnector: vi.fn(),
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
afterEach(() => {
  Iterable.forEach(databases.splice(0), (database) => {
    database.close()
  })
})
async function fixture(currentScope = scope) {
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
  function run<T, E>(effect: Effect.Effect<T, E, RequestServices>) {
    return runTestEffect(effect.pipe(Effect.provideService(RequestServices, services)))
  }
  return { ...database, scope: requestScope, calls, run }
}

describe('settings authorized direct D1 SSR', () => {
  test.each(['groups', 'members'] as const)('keeps canonical native URL %s view and original DTOs', async (view) => {
    const f = await fixture()
    const node = await f.run(
      renderGroups(f.scope, new URL(`https://front.example/settings/groups?workspace=alpha&view=${view}`)),
    )
    expect(node.props.view).toBe(view)
    expect(node.props.initialData.groups.map((group: { id: string }) => group.id)).toEqual(['g2', 'g1'])
    expect(node.props.initialData.details.find((group: { id: string }) => group.id === 'g1')).toMatchObject({
      grantCount: 1,
      grants: [{ projectId: 'p1', projectKey: 'PROJ', projectName: 'Project', role: 'member' }],
      id: 'g1',
      memberCount: 1,
      members: [{ email: 'owner@example.test', name: 'owner', userId: 'u1' }],
    })
    expect(node.props.initialData.projects.map((project: { id: string }) => project.id)).toEqual(['p1'])
    expect(node.props.initialData.memberGroups).toEqual([{ groups: [{ id: 'g1', name: 'Team' }], userId: 'u1' }])
    expect(f.calls).not.toHaveBeenCalled()
    expect(renderToStaticMarkup(node)).toContain(`id="group-tabpanel-${view}"`)
  })

  test('rejects malformed view before database queries', async () => {
    const f = await fixture()
    const prepare = vi.spyOn(f.db, 'prepare')
    await expect(
      f.run(renderGroups(f.scope, new URL('https://front.example/settings/groups?view=unknown'))),
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
    const f = await fixture(memberScope)
    const prepare = vi.spyOn(f.db, 'prepare')
    const node = await f.run(renderGroups(f.scope, new URL('https://front.example/settings/groups?view=members')))
    expect(node.props.view).toBe('groups')
    expect(node.props.initialData.groups.map((group: { id: string }) => group.id)).toEqual(['g1'])
    expect(node.props.initialData.details).toEqual([])
    expect(node.props.initialData.memberGroups).toEqual([])
    expect(prepare.mock.calls.some(([query]) => /left join "user_group_members"/i.test(query))).toBe(false)
    expect(prepare.mock.calls.some(([query]) => /"added_by".*inner join "users"/s.test(query))).toBe(false)
    expect(renderToStaticMarkup(node)).toContain('Only owners and admins manage groups.')
  })

  test('loads token metadata only from selected workspace and never serializes credential hashes', async () => {
    const f = await fixture()
    const node = await f.run(renderTokens(f.scope, url))
    expect(node.props.initialTokens).toEqual([token])
    expect(node.props.initialGrants).toEqual([connector])
    expect(node.props.mcpCommandTemplate).toContain('--header "Authorization: Bearer {{TOKEN}}"')
    expect(node.props.mcpCommandTemplate).toContain('--header "X-Workspace-Slug: alpha"')
    expect(JSON.stringify(node.props)).not.toContain('secret-token-hash')
    expect(f.calls).not.toHaveBeenCalled()
    expect(renderToStaticMarkup(node)).toContain('Agent token')
  })

  test('denies member token reads before credential DB access while preserving personal connector and guide controls', async () => {
    const member = { ...workspace, role: 'member' as const }
    const memberScope: RequestScope = {
      ...scope,
      workspaces: [member],
      selection: { kind: 'workspace', workspace: member },
    }
    const f = await fixture(memberScope)
    const prepare = vi.spyOn(f.db, 'prepare')
    const node = await f.run(renderTokens(f.scope, url))
    // Core rechecks live membership, but must not load token metadata for a member.
    expect(prepare.mock.calls.some(([query]) => /\bapi_tokens\b/.test(query))).toBe(false)
    expect(node.props.initialTokens).toEqual([])
    expect(node.props.tokensDenied).toBe(true)
    expect(node.props.initialGrants).toEqual([connector])
    const html = renderToStaticMarkup(node)
    expect(html).toContain('Connect Claude Code')
    expect(html).toContain('Disconnect')
    expect(html).toContain('Access denied.')
  })

  test('uses verified native auth for connector credentials and deployment MCP configuration without HTTP', async () => {
    const f = await fixture()
    const connectors = await f.run(renderConnectors(f.scope, url))
    expect(connectors.props.initialGrants).toEqual([connector])
    const guide = await f.run(renderConnectAgent(f.scope, url))
    expect(guide.props.mcpUrl).toBe(`${apiOrigin}/mcp/w1`)
    expect(f.calls).not.toHaveBeenCalled()
  })

  test('rejects forged selected workspace membership before DB', async () => {
    const deniedScope: RequestScope = { ...scope, workspaces: [] }
    const f = await fixture(deniedScope)
    const prepare = vi.spyOn(f.db, 'prepare')
    expect(renderToStaticMarkup(await f.run(renderGroups(f.scope, url)))).toContain('Only workspace owners and admins')
    expect(prepare).not.toHaveBeenCalled()
  })

  test('preserves forbidden connector guidance and optional unavailable MCP metadata', async () => {
    const f = await fixture()
    const unverified: RequestScope = { ...f.scope, auth: undefined }
    const node = await f.run(renderTokens(unverified, url))
    expect(node.props.initialTokens).toBeUndefined()
    expect(renderToStaticMarkup(node)).toContain('Access denied.')
    expect(renderToStaticMarkup(await f.run(renderConnectors(unverified, url)))).toContain('Signed-in members only.')
  })

  test('propagates core DB failures with redacted diagnostics', async () => {
    const f = await fixture()
    f.sqlite.exec('DROP TABLE user_groups')
    const error = await f.run(renderGroups(f.scope, url).pipe(Effect.catch((error) => Effect.succeed(error))))
    expect(error).toMatchObject({
      _tag: 'ApiError',
      message: 'An unexpected error occurred.',
      status: 500,
    })
    expect(JSON.stringify(error)).not.toContain('user_groups')
  })

  test('keeps concrete DTO validation for metadata, group roles and MCP config', () => {
    expect(() => Schema.decodeUnknownSync(TokenSchema)({ ...token, scopes: ['read'] })).toThrow()
    expect(() => Schema.decodeUnknownSync(ConnectorSchema)({ ...connector, expiresAt: 'tomorrow' })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(GroupDetailSchema)({
        id: 'g1',
        name: 'Team',
        description: null,
        members: [],
        grants: [{ projectId: 'p1', projectName: 'Project', projectKey: 'PROJ', role: 'owner' }],
      }),
    ).toThrow()
    expect(() => Schema.decodeUnknownSync(McpInfoSchema)({ mcpUrl: 42 })).toThrow()
  })
})
