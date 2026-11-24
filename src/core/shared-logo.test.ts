import { Iterable } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { createShareToken } from '#commands/share.ts'
import { createTestDatabase } from '@/test/database.ts'

import type { CoreEnvironment } from './environment.ts'
import { handleSharedLogoRequest } from './shared-logo.ts'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  Iterable.forEach(databases.splice(0), (database) => {
    database.close()
  })
})

const fixture = async function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
    INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','User',1);
    INSERT INTO workspaces (id,name,slug,created_at,brand) VALUES ('w','Workspace','workspace',1,'{"logoR2Key":"w/logo"}');
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w','u','owner',1);
    INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES ('p','w','Project','PRJ',1,1);
    INSERT INTO issues (id,workspace_id,project_id,number,title,status,priority,created_by_id,created_at,updated_at)
      VALUES ('i','w','p',1,'Issue','backlog','medium','u',1,1);
  `)
  const bytes = new Uint8Array([0, 255, 7, 128])
  const cancel = vi.fn()
  const buffer = vi.fn(() => {
    throw new Error('Logo transfer must not buffer bytes')
  })
  const get = vi.fn(async () => ({
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
      },
      cancel,
    }),
    arrayBuffer: buffer,
    httpMetadata: { contentType: 'image/png' },
  }))
  const env = { DB: database.db, KV: {}, R2: { get } } as unknown as CoreEnvironment
  const { token } = await createShareToken(
    { db: env.DB, kv: env.KV, r2: env.R2, workspaceId: 'w', userId: 'u', role: 'owner' },
    'i',
  )
  const request = (method = 'GET'): Request<unknown, CfProperties> =>
    new Request(`https://core.internal/share-logo/${token}`, { method })
  return { ...database, env, request, bytes, get, cancel, buffer }
}

describe('core shared logo binary delivery', () => {
  test('streams the exact body and forwards cancellation without buffering', async () => {
    const testFixture = await fixture()
    const response = await handleSharedLogoRequest(testFixture.request(), testFixture.env)
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toBe('image/png')
    const reader = response!.body!.getReader()
    const result = await reader.read()
    expect(result.value).toEqual(testFixture.bytes)
    await reader.cancel('disconnected')
    expect(testFixture.cancel).toHaveBeenCalledWith('disconnected')
    expect(testFixture.buffer).not.toHaveBeenCalled()
  })

  test('rechecks the share creator membership before touching storage', async () => {
    const testFixture = await fixture()
    testFixture.sqlite.exec('DELETE FROM workspace_members')
    const resolvedValue = await handleSharedLogoRequest(testFixture.request(), testFixture.env)
    expect(resolvedValue?.status).toBe(404)
    expect(testFixture.get).not.toHaveBeenCalled()
  })

  test('closes the authorized logo stream on HEAD without buffering it', async () => {
    const testFixture = await fixture()
    const response = await handleSharedLogoRequest(testFixture.request('HEAD'), testFixture.env)
    expect(response?.status).toBe(200)
    expect(response?.body).toBeNull()
    expect(testFixture.cancel).toHaveBeenCalledOnce()
    expect(testFixture.buffer).not.toHaveBeenCalled()
  })

  test('refuses revoked or archived share sources and unsupported methods', async () => {
    const testFixture = await fixture()
    testFixture.sqlite.exec('UPDATE projects SET archived_at = 2')
    expect((await handleSharedLogoRequest(testFixture.request(), testFixture.env))?.status).toBe(404)
    expect((await handleSharedLogoRequest(testFixture.request('POST'), testFixture.env))?.status).toBe(405)
    await expect(
      handleSharedLogoRequest(new Request('https://core.internal/unrelated'), testFixture.env),
    ).resolves.toBeUndefined()
    expect(testFixture.get).not.toHaveBeenCalled()
  })
})
