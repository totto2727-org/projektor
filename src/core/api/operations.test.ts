import { Iterable, Effect, Schema } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { ApiUserBootstrap } from '#contracts/api-auth.ts'
import { ApiConsentWorkspace, ApiRealtimeSnapshot } from '#contracts/api-public.ts'
import { ApiResults } from '#contracts/api-results.ts'
import type { CoreActor } from '#core/authorization.ts'
import { decodeCoreReply } from '#core/client.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import { resetAuthCachesForTests } from '#services/authentication.ts'
import { runTestEffect } from '#tests/run-effect.ts'
import { createTestDatabase } from '@/test/database.ts'

import { makeApiIdentityHandlers } from './identity-operations.ts'
import { makeApiPublicHandlers } from './public-operations.ts'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  Iterable.forEach(databases.splice(0), (database) => {
    database.close()
  })
  resetAuthCachesForTests()
})

const fixture = async function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
    INSERT INTO users(id,email,name,created_at) VALUES('u','u@example.test','User',1);
    INSERT INTO workspaces(id,name,slug,created_at) VALUES('w','Workspace','workspace',1),('other','Other','other',1);
    INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES('w','u','owner',1),('other','u','owner',1);
  `)
  const bearer = 'pk_api-boundary-regression'
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  database.sqlite
    .prepare(`INSERT INTO api_tokens(id,user_id,workspace_id,token_hash,name,scopes,created_at)
    VALUES('token','u','w',?,'Test','["write"]',1)`)
    .run(hash)
  const env = {
    DB: database.db,
    KV: { get: async () => null, put: async () => undefined },
    R2: {},
    ENVIRONMENT: 'production',
    CF_ACCESS_TEAM_DOMAIN: '',
    CF_ACCESS_AUDIENCE: '',
  } as unknown as CoreEnvironment
  const actor: CoreActor = { requestUrl: 'https://api.test/api/workspaces', method: 'GET', bearer }
  const source = Effect.succeed(env)
  const handlers = { ...makeApiIdentityHandlers(source), ...makeApiPublicHandlers(source) }
  return { ...database, actor, env, handlers }
}
const reply = function reply<S extends Schema.Top & Readonly<{ DecodingServices: never }>>(
  schema: S,
  invocation: Effect.Effect<string>,
) {
  return runTestEffect(decodeCoreReply(schema, invocation))
}

describe('covers API Core authorization and presentation boundaries', () => {
  test('filters both workspace catalogs and auth bootstrap by the original credential audience', async () => {
    const testFixture = await fixture()
    const workspaces = await reply(
      ApiResults.apiListWorkspaces,
      testFixture.handlers.apiListWorkspaces(testFixture.actor),
    )
    expect(workspaces.map((workspace) => workspace.id)).toStrictEqual(['w'])
    expect(workspaces[0]).toHaveProperty('createdAt')
    const bootstrap = await reply(ApiUserBootstrap, testFixture.handlers.apiUserBootstrap(testFixture.actor))
    expect(bootstrap.workspaces.map((workspace) => workspace.id)).toStrictEqual(['w'])
  })

  test('does not let a workspace credential mint an unconfined workspace', async () => {
    const testFixture = await fixture()
    await expect(
      reply(
        ApiResults.apiCreateWorkspace,
        testFixture.handlers.apiCreateWorkspace(testFixture.actor, { name: 'New', slug: 'new' }),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(testFixture.sqlite.prepare("SELECT id FROM workspaces WHERE slug='new'").get()).toBeUndefined()
  })

  test('enforces read capability independently on global catalogs and auth bootstrap', async () => {
    const testFixture = await fixture()
    testFixture.sqlite.exec("UPDATE api_tokens SET scopes='[]' WHERE id='token'")
    await expect(
      reply(ApiResults.apiListWorkspaces, testFixture.handlers.apiListWorkspaces(testFixture.actor)),
    ).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      reply(ApiUserBootstrap, testFixture.handlers.apiUserBootstrap(testFixture.actor)),
    ).rejects.toMatchObject({
      status: 403,
    })
  })

  test('authenticates before revealing whether a target workspace exists', async () => {
    const testFixture = await fixture()
    const unauthorized = { ...testFixture.actor, bearer: 'invalid' }
    for (const value of ['w', 'missing']) {
      await expect(
        reply(Schema.Unknown, testFixture.handlers.apiResolveWorkspace(unauthorized, { kind: 'id', value })),
      ).rejects.toMatchObject({ status: 401 })
    }
  })

  test('does not authorize OAuth consent with an API token even when its owner is a workspace owner', async () => {
    const testFixture = await fixture()
    await expect(
      reply(ApiConsentWorkspace, testFixture.handlers.apiConsentWorkspace(testFixture.actor, 'w')),
    ).rejects.toMatchObject({
      status: 403,
    })
  })

  test('rechecks live socket membership and credential revocation on every visibility request', async () => {
    const testFixture = await fixture()
    await expect(
      reply(ApiRealtimeSnapshot, testFixture.handlers.apiRealtimeSnapshot(testFixture.actor, 'w')),
    ).resolves.toMatchObject({
      role: 'owner',
      userId: 'u',
    })
    testFixture.sqlite.exec("UPDATE workspace_members SET role='viewer' WHERE workspace_id='w'")
    await expect(
      reply(ApiRealtimeSnapshot, testFixture.handlers.apiRealtimeSnapshot(testFixture.actor, 'w')),
    ).resolves.toMatchObject({
      role: 'viewer',
    })
    testFixture.sqlite.exec("DELETE FROM workspace_members WHERE workspace_id='w'")
    await expect(
      reply(ApiRealtimeSnapshot, testFixture.handlers.apiRealtimeSnapshot(testFixture.actor, 'w')),
    ).rejects.toMatchObject({
      status: 403,
    })
    testFixture.sqlite.exec("DELETE FROM api_tokens WHERE id='token'")
    await expect(
      reply(ApiRealtimeSnapshot, testFixture.handlers.apiRealtimeSnapshot(testFixture.actor, 'w')),
    ).rejects.toMatchObject({
      status: 401,
    })
  })
})
