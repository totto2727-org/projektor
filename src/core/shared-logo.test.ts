import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { createShareToken } from '#commands/share'

import { createTestDatabase } from '../web/test/database'
import type { CoreEnvironment } from './environment'
import { handleSharedLogoRequest } from './shared-logo'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

async function fixture() {
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
  const request = (method = 'GET') => new Request(`https://core.internal/share-logo/${token}`, { method })
  return { ...database, env, request, bytes, get, cancel, buffer }
}

describe('Core shared logo binary delivery', () => {
  it('streams the exact body and forwards cancellation without buffering', async () => {
    const f = await fixture()
    const response = await handleSharedLogoRequest(f.request(), f.env)
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toBe('image/png')
    const reader = response!.body!.getReader()
    expect((await reader.read()).value).toEqual(f.bytes)
    await reader.cancel('disconnected')
    expect(f.cancel).toHaveBeenCalledWith('disconnected')
    expect(f.buffer).not.toHaveBeenCalled()
  })

  it('rechecks the share creator membership before touching storage', async () => {
    const f = await fixture()
    f.sqlite.exec('DELETE FROM workspace_members')
    expect((await handleSharedLogoRequest(f.request(), f.env))?.status).toBe(404)
    expect(f.get).not.toHaveBeenCalled()
  })

  it('closes the authorized logo stream on HEAD without buffering it', async () => {
    const f = await fixture()
    const response = await handleSharedLogoRequest(f.request('HEAD'), f.env)
    expect(response?.status).toBe(200)
    expect(response?.body).toBeNull()
    expect(f.cancel).toHaveBeenCalledOnce()
    expect(f.buffer).not.toHaveBeenCalled()
  })

  it('refuses revoked or archived share sources and unsupported methods', async () => {
    const f = await fixture()
    f.sqlite.exec('UPDATE projects SET archived_at = 2')
    expect((await handleSharedLogoRequest(f.request(), f.env))?.status).toBe(404)
    expect((await handleSharedLogoRequest(f.request('POST'), f.env))?.status).toBe(405)
    expect(await handleSharedLogoRequest(new Request('https://core.internal/unrelated'), f.env)).toBeUndefined()
    expect(f.get).not.toHaveBeenCalled()
  })
})
