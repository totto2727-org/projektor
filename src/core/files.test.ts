import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { createTestDatabase } from '../web/test/database'
import type { CoreActor } from './authorization'
import { CORE_ACTOR_HEADER } from './contract'
import type { CoreEnvironment } from './environment'
import { handleCoreFileRequest } from './files'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
    INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','User',1);
    INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w','Workspace','workspace',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w','u','member',1);
    INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at,archived_at)
      VALUES ('p','w','Archived','ARC',1,1,2),('hidden','w','Hidden','HID',1,1,NULL);
    INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g','w','Visible',1);
    INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g','u','u',1);
    INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g','p','member');
    INSERT INTO issues (id,workspace_id,project_id,number,title,status,priority,created_by_id,created_at,updated_at)
      VALUES ('i','w','p',1,'Archived owner','backlog','medium','u',1,1),('hidden','w','hidden',1,'Hidden owner','backlog','medium','u',1,1);
    INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at)
      VALUES ('a','w','file','w/object','image.png','image/png',4,'issue','i','u',1),
      ('secret','w','file','w/secret','secret.png','image/png',4,'issue','hidden','u',1);
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
  }))
  const head = vi.fn(async () => ({ size: bytes.length }))
  const env = { DB: database.db, KV: {}, R2: { get, head }, ENVIRONMENT: 'production' } as unknown as CoreEnvironment
  const actor: CoreActor = {
    requestUrl: 'https://api.test/mcp/w',
    method: 'POST',
    verifiedOauthGrant: {
      userId: 'u',
      email: 'u@example.test',
      name: 'User',
      workspaceId: 'w',
      scopes: ['projektor:read'],
    },
  }
  const request = (id = 'a', method = 'GET') =>
    new Request(`https://core.internal/files/${id}?workspaceId=w`, {
      method,
      headers: { [CORE_ACTOR_HEADER]: JSON.stringify(actor) },
    })
  return { ...database, env, request, get, head, cancel, bytes }
}

describe('Core narrow same-binding binary transfer', () => {
  it('streams exact binary bytes from an authorized archived owner without buffering', async () => {
    const f = fixture()
    const response = await handleCoreFileRequest(f.request(), f.env)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-projektor-filename')).toBe('image.png')
    const reader = response.body!.getReader()
    expect((await reader.read()).value).toEqual(f.bytes)
    await reader.cancel('client canceled')
    expect(f.cancel).toHaveBeenCalledWith('client canceled')
  })

  it('authorizes before any R2 read and hides ungranted owners', async () => {
    const f = fixture()
    const response = await handleCoreFileRequest(f.request('secret'), f.env)
    expect(response.status).toBe(404)
    expect(f.get).not.toHaveBeenCalled()
  })

  it('rechecks current membership on every transfer', async () => {
    const f = fixture()
    f.sqlite.exec('DELETE FROM workspace_members')
    expect((await handleCoreFileRequest(f.request(), f.env)).status).toBe(403)
    expect(f.get).not.toHaveBeenCalled()
  })

  it('uses R2 metadata rather than a body read for HEAD', async () => {
    const f = fixture()
    const response = await handleCoreFileRequest(f.request('a', 'HEAD'), f.env)
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(f.head).toHaveBeenCalledWith('w/object')
    expect(f.get).not.toHaveBeenCalled()
  })

  it('never becomes a generic internal HTTP proxy', async () => {
    const f = fixture()
    expect((await handleCoreFileRequest(new Request('https://core.internal/api/issues'), f.env)).status).toBe(404)
    expect(f.get).not.toHaveBeenCalled()
  })
})
