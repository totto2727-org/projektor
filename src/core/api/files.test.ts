import { Iterable } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import type { CoreActor } from '#core/authorization.ts'
import { CORE_ACTOR_HEADER } from '#core/contract.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import { createTestDatabase } from '@/test/database.ts'

import { handleApiBinaryRequest } from './files.ts'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  Iterable.forEach(databases.splice(0), (database) => {
    database.close()
  })
})
const fixture = function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
    INSERT INTO users(id,email,name,created_at) VALUES('u','u@example.test','User',1);
    INSERT INTO workspaces(id,name,slug,brand,created_at) VALUES('w','Workspace','workspace','{"logoR2Key":"w/brand-logo/logo"}',1);
    INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES('w','u','owner',1);
  `)
  const cancel = vi.fn()
  const bytes = new Uint8Array([0, 255, 128, 7])
  const get = vi.fn(async () => ({
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
      },
      cancel,
    }),
    httpMetadata: { contentType: 'image/png' },
  }))
  const env = { DB: database.db, KV: {}, R2: { get }, ENVIRONMENT: 'production' } as unknown as CoreEnvironment
  const actor: CoreActor = {
    requestUrl: 'https://api.test/api/workspaces/workspace/brand/logo',
    method: 'GET',
    verifiedOauthGrant: {
      userId: 'u',
      email: 'u@example.test',
      name: 'User',
      workspaceId: 'w',
      scopes: ['projektor:read'],
    },
  }
  const request = (method = 'GET'): Request<unknown, CfProperties<unknown>> =>
    new Request('https://core.internal/workspace-logo?workspaceId=w', {
      method,
      headers: { [CORE_ACTOR_HEADER]: JSON.stringify(actor) },
    })
  return { ...database, env, get, cancel, bytes, request }
}

describe('covers API Core binary workspace logos', () => {
  test('streams bytes without buffering and propagates consumer cancellation', async () => {
    const testFixture = fixture()
    const response = await handleApiBinaryRequest(testFixture.request(), testFixture.env)
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toBe('image/png')
    const reader = response!.body!.getReader()
    const result = await reader.read()
    expect(result.value).toEqual(testFixture.bytes)
    await reader.cancel('consumer canceled')
    expect(testFixture.cancel).toHaveBeenCalledWith('consumer canceled')
  })

  test('releases the R2 body on HEAD without reading it', async () => {
    const testFixture = fixture()
    const response = await handleApiBinaryRequest(testFixture.request('HEAD'), testFixture.env)
    expect(response?.status).toBe(200)
    expect(response?.body).toBeNull()
    expect(testFixture.cancel).toHaveBeenCalledOnce()
  })

  test('checks current membership before accessing R2', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec("DELETE FROM workspace_members WHERE workspace_id='w'")
    const response = await handleApiBinaryRequest(testFixture.request(), testFixture.env)
    expect(response?.status).toBe(403)
    expect(testFixture.get).not.toHaveBeenCalled()
  })
})
