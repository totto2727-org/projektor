import { Effect, Schema } from 'effect'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { resetAuthCachesForTests } from '#services/authentication'

import { ApiUserBootstrap } from '../../contracts/api-auth'
import { ApiConsentWorkspace, ApiRealtimeSnapshot } from '../../contracts/api-public'
import { ApiResults } from '../../contracts/api-results'
import { createTestDatabase } from '../../web/test/database'
import type { CoreActor } from '../authorization'
import { decodeCoreReply } from '../client'
import type { CoreEnvironment } from '../environment'
import { makeApiIdentityHandlers } from './identity-operations'
import { makeApiPublicHandlers } from './public-operations'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  resetAuthCachesForTests()
})

async function fixture() {
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
function reply<S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  invocation: Effect.Effect<string>,
) {
  return Effect.runPromise(decodeCoreReply(schema, invocation))
}

describe('API Core authorization and presentation boundaries', () => {
  it('filters both workspace catalogs and auth bootstrap by the original credential audience', async () => {
    const f = await fixture()
    const workspaces = await reply(ApiResults.apiListWorkspaces, f.handlers.apiListWorkspaces(f.actor))
    expect(workspaces.map((workspace) => workspace.id)).toEqual(['w'])
    expect(workspaces[0]).toHaveProperty('createdAt')
    const bootstrap = await reply(ApiUserBootstrap, f.handlers.apiUserBootstrap(f.actor))
    expect(bootstrap.workspaces.map((workspace) => workspace.id)).toEqual(['w'])
  })

  it('does not let a workspace credential mint an unconfined workspace', async () => {
    const f = await fixture()
    await expect(
      reply(ApiResults.apiCreateWorkspace, f.handlers.apiCreateWorkspace(f.actor, { name: 'New', slug: 'new' })),
    ).rejects.toMatchObject({ status: 403 })
    expect(f.sqlite.prepare("SELECT id FROM workspaces WHERE slug='new'").get()).toBeUndefined()
  })

  it('enforces read capability independently on global catalogs and auth bootstrap', async () => {
    const f = await fixture()
    f.sqlite.exec("UPDATE api_tokens SET scopes='[]' WHERE id='token'")
    await expect(reply(ApiResults.apiListWorkspaces, f.handlers.apiListWorkspaces(f.actor))).rejects.toMatchObject({
      status: 403,
    })
    await expect(reply(ApiUserBootstrap, f.handlers.apiUserBootstrap(f.actor))).rejects.toMatchObject({
      status: 403,
    })
  })

  it('authenticates before revealing whether a target workspace exists', async () => {
    const f = await fixture()
    const unauthorized = { ...f.actor, bearer: 'invalid' }
    for (const value of ['w', 'missing']) {
      await expect(
        reply(Schema.Unknown, f.handlers.apiResolveWorkspace(unauthorized, { kind: 'id', value })),
      ).rejects.toMatchObject({ status: 401 })
    }
  })

  it('does not authorize OAuth consent with an API token even when its owner is a workspace owner', async () => {
    const f = await fixture()
    await expect(reply(ApiConsentWorkspace, f.handlers.apiConsentWorkspace(f.actor, 'w'))).rejects.toMatchObject({
      status: 403,
    })
  })

  it('rechecks live socket membership and credential revocation on every visibility request', async () => {
    const f = await fixture()
    expect(await reply(ApiRealtimeSnapshot, f.handlers.apiRealtimeSnapshot(f.actor, 'w'))).toMatchObject({
      userId: 'u',
      role: 'owner',
    })
    f.sqlite.exec("UPDATE workspace_members SET role='viewer' WHERE workspace_id='w'")
    expect(await reply(ApiRealtimeSnapshot, f.handlers.apiRealtimeSnapshot(f.actor, 'w'))).toMatchObject({
      role: 'viewer',
    })
    f.sqlite.exec("DELETE FROM workspace_members WHERE workspace_id='w'")
    await expect(reply(ApiRealtimeSnapshot, f.handlers.apiRealtimeSnapshot(f.actor, 'w'))).rejects.toMatchObject({
      status: 403,
    })
    f.sqlite.exec("DELETE FROM api_tokens WHERE id='token'")
    await expect(reply(ApiRealtimeSnapshot, f.handlers.apiRealtimeSnapshot(f.actor, 'w'))).rejects.toMatchObject({
      status: 401,
    })
  })
})
