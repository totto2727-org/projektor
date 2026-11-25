import { Iterable } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { resetAuthCachesForTests } from '#services/authentication.ts'
import { createTestDatabase } from '@/test/database.ts'

import { resolveCorePrincipal, resolveCoreServiceCtx } from './authorization.ts'
import type { CoreActor } from './authorization.ts'
import type { CoreEnvironment } from './environment.ts'

const databases: ReturnType<typeof createTestDatabase>[] = []

const fixture = async function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
    INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','User',1);
    INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w','Workspace','workspace',1),('other','Other','other',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w','u','member',1),('other','u','owner',1);
  `)
  const bearer = 'pk_core-regression'
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  database.sqlite
    .prepare(`INSERT INTO api_tokens (id, user_id, workspace_id, token_hash, name, scopes, created_at)
    VALUES ('t', 'u', 'w', ?, 'Core test', '["write"]', 1)`)
    .run(hash)
  const waitUntil = vi.fn<(promise: Promise<unknown>) => void>()
  const env = {
    DB: database.db,
    KV: {
      get: vi.fn<() => Promise<null>>(async () => null),
      put: vi.fn<() => Promise<undefined>>(async () => undefined),
    },
    R2: {},
    ENVIRONMENT: 'production',
    CF_ACCESS_TEAM_DOMAIN: '',
    CF_ACCESS_AUDIENCE: '',
    invocation: { waitUntil },
  } as unknown as CoreEnvironment
  const actor: CoreActor = { requestUrl: 'https://api.test/api/issues', method: 'POST', bearer }
  return { ...database, actor, env, waitUntil }
}

describe('core persistent authorization', () => {
  afterEach(() => {
    Iterable.forEach(databases.splice(0), (database) => {
      database.close()
    })
    resetAuthCachesForTests()
  })

  test('rechecks membership and role for each named domain operation', async () => {
    const testFixture = await fixture()
    const first = await resolveCoreServiceCtx(testFixture.actor, 'w', 'write', testFixture.env)
    expect(first).toMatchObject({
      auth: { kind: 'agent', method: 'pk' },
      role: 'member',
      userId: 'u',
      workspaceId: 'w',
    })
    testFixture.sqlite.exec("UPDATE workspace_members SET role = 'viewer' WHERE workspace_id = 'w'")
    const result = await resolveCoreServiceCtx(testFixture.actor, 'w', 'read', testFixture.env)
    expect(result.role).toBe('viewer')
    testFixture.sqlite.exec("DELETE FROM workspace_members WHERE workspace_id = 'w'")
    await expect(resolveCoreServiceCtx(testFixture.actor, 'w', 'read', testFixture.env)).rejects.toMatchObject({
      status: 403,
    })
  })

  test('rechecks token revocation and current scope rather than trusting a prior principal', async () => {
    const testFixture = await fixture()
    await resolveCoreServiceCtx(testFixture.actor, 'w', 'write', testFixture.env)
    testFixture.sqlite.exec(`UPDATE api_tokens SET scopes = '["read"]' WHERE id = 't'`)
    await expect(resolveCoreServiceCtx(testFixture.actor, 'w', 'write', testFixture.env)).rejects.toMatchObject({
      status: 403,
    })
    testFixture.sqlite.exec("DELETE FROM api_tokens WHERE id = 't'")
    await expect(resolveCoreServiceCtx(testFixture.actor, 'w', 'read', testFixture.env)).rejects.toMatchObject({
      status: 401,
    })
  })

  test('confines a workspace token even when the user owns another workspace', async () => {
    const testFixture = await fixture()
    await expect(resolveCoreServiceCtx(testFixture.actor, 'other', 'read', testFixture.env)).rejects.toMatchObject({
      status: 403,
    })
  })

  test('rejects expired credentials before domain execution', async () => {
    const testFixture = await fixture()
    testFixture.sqlite.exec('UPDATE api_tokens SET expires_at = 1')
    await expect(resolveCorePrincipal(testFixture.actor, testFixture.env)).rejects.toMatchObject({
      message: 'Token expired',
      status: 401,
    })
  })

  test('preserves provider OAuth workspace, scope, grant and agent confinement', async () => {
    const testFixture = await fixture()
    const actor: CoreActor = {
      requestUrl: 'https://api.test/mcp/w',
      method: 'POST',
      bearer: 'u:grant:secret',
      verifiedOauthGrant: {
        userId: 'u',
        email: 'u@example.test',
        name: 'User',
        workspaceId: 'w',
        scopes: ['projektor:read'],
        clientId: 'client',
      },
    }
    const principal = await resolveCorePrincipal(actor, testFixture.env)
    expect(principal).toMatchObject({
      auth: { clientId: 'client', credentialId: 'grant', kind: 'agent', method: 'oauth' },
      tokenScopes: ['read'],
      tokenWorkspaceId: 'w',
    })
    await expect(resolveCoreServiceCtx(actor, 'w', 'write', testFixture.env)).rejects.toMatchObject({ status: 403 })
    await expect(resolveCoreServiceCtx(actor, 'other', 'read', testFixture.env)).rejects.toMatchObject({ status: 403 })
    testFixture.sqlite.exec("DELETE FROM workspace_members WHERE workspace_id = 'w'")
    await expect(resolveCoreServiceCtx(actor, 'w', 'read', testFixture.env)).rejects.toMatchObject({ status: 403 })
  })

  test('never falls back to development identity for a present invalid Access proof', async () => {
    const testFixture = await fixture()
    const env = { ...testFixture.env, ENVIRONMENT: 'development' as const, DEV_USER_EMAIL: 'dev@example.test' }
    await expect(resolveCorePrincipal({ ...testFixture.actor, accessJwt: 'invalid' }, env)).rejects.toMatchObject({
      status: 401,
    })
    expect(testFixture.sqlite.prepare("SELECT id FROM users WHERE email = 'dev@example.test'").get()).toBeUndefined()
  })

  test('keeps unauthenticated MCP challengeable when the development bypass is enabled', async () => {
    const testFixture = await fixture()
    const env = { ...testFixture.env, ENVIRONMENT: 'development' as const, DEV_USER_EMAIL: 'dev@example.test' }
    await expect(
      resolveCorePrincipal({ requestUrl: 'https://api.test/mcp/w', method: 'POST' }, env),
    ).rejects.toMatchObject({ status: 401 })
  })

  test('registers coarsened token audit work on the Core invocation lifecycle', async () => {
    const testFixture = await fixture()
    await resolveCorePrincipal(testFixture.actor, testFixture.env)
    expect(testFixture.waitUntil).toHaveBeenCalledOnce()
    await testFixture.waitUntil.mock.calls[0][0]
    await resolveCorePrincipal(testFixture.actor, testFixture.env)
    expect(testFixture.waitUntil).toHaveBeenCalledOnce()
  })
})
