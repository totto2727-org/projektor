import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import type { CoreActor } from '#core/authorization.ts'
import { CORE_ACTOR_HEADER } from '#core/contract.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import { createTestDatabase } from '@/test/database.ts'

import { handleApiBinaryRequest } from './files.ts'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
  }
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
  const request = (method = 'GET') =>
    new Request('https://core.internal/workspace-logo?workspaceId=w', {
      method,
      headers: { [CORE_ACTOR_HEADER]: JSON.stringify(actor) },
    })
  return { ...database, env, get, cancel, bytes, request }
}

describe('API Core binary workspace logos', () => {
  test('streams bytes without buffering and propagates consumer cancellation', async () => {
    const f = fixture()
    const response = await handleApiBinaryRequest(f.request(), f.env)
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toBe('image/png')
    const reader = response!.body!.getReader()
    expect((await reader.read()).value).toEqual(f.bytes)
    await reader.cancel('consumer canceled')
    expect(f.cancel).toHaveBeenCalledWith('consumer canceled')
  })

  test('releases the R2 body on HEAD without reading it', async () => {
    const f = fixture()
    const response = await handleApiBinaryRequest(f.request('HEAD'), f.env)
    expect(response?.status).toBe(200)
    expect(response?.body).toBeNull()
    expect(f.cancel).toHaveBeenCalledTimes(1)
  })

  test('checks current membership before accessing R2', async () => {
    const f = fixture()
    f.sqlite.exec("DELETE FROM workspace_members WHERE workspace_id='w'")
    const response = await handleApiBinaryRequest(f.request(), f.env)
    expect(response?.status).toBe(403)
    expect(f.get).not.toHaveBeenCalled()
  })
})
