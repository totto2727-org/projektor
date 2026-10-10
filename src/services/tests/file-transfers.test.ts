import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  createLinkAttachment,
  deleteStoredAttachment,
  getStoredAttachment,
  MAX_UPLOAD_SIZE,
  storageQuotaBytes,
  uploadStoredAttachment,
} from '#commands/files'
import type { ServiceCtx } from '#commands/types'

import { createTestDatabase } from '../../web/test/database'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
    INSERT INTO users (id,email,name,created_at) VALUES ('u1','one@example.test','One',1);
    INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w1','One','one',1),('w2','Two','two',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',1);
    INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at,archived_at) VALUES
      ('p1','w1','Archived','ONE',1,1,2);
    INSERT INTO issues (id,workspace_id,project_id,number,title,status,priority,created_by_id,created_at,updated_at)
      VALUES ('i1','w1','p1',1,'Issue','backlog','medium','u1',1,1);
  `)
  const objects = new Map<string, ArrayBuffer>()
  // Deliberately bounded storage double: only the R2 operations used by file commands.
  const put = vi.fn(async (key: string, body: ArrayBuffer) => {
    objects.set(key, body)
    return null
  })
  const get = vi.fn(async (key: string) => {
    const body = objects.get(key)
    return body ? { arrayBuffer: async () => body } : null
  })
  const remove = vi.fn(async (key: string) => {
    objects.delete(key)
  })
  const ctx: ServiceCtx = {
    db: database.db,
    kv: {} as KVNamespace,
    r2: { put, get, delete: remove } as unknown as R2Bucket,
    workspaceId: 'w1',
    userId: 'u1',
    role: 'owner',
  }
  const file = new File([new Uint8Array([0, 255, 7, 128])], 'diagram.png', { type: 'image/png' })
  return { ...database, ctx, objects, put, get, remove, file }
}
const input = (file: File, entityId = 'i1') => ({ file, entityType: 'issue' as const, entityId })

describe('shared file transfer commands over migrated SQLite and bounded R2', () => {
  it('uploads exact bytes and metadata, reads archived-owner bytes, then deletes both stores', async () => {
    const f = fixture()
    const uploaded = await uploadStoredAttachment(f.ctx, input(f.file))
    expect(uploaded).toEqual({ id: expect.any(String), filename: 'diagram.png', contentType: 'image/png', size: 4 })
    const row = f.sqlite.prepare('SELECT * FROM attachments WHERE id = ?').get(uploaded.id)
    expect(row).toMatchObject({ workspace_id: 'w1', entity_id: 'i1', created_by_id: 'u1', size: 4 })
    expect(f.put).toHaveBeenCalledWith(expect.stringMatching(/^w1\//), await f.file.arrayBuffer(), {
      httpMetadata: { contentType: 'image/png' },
    })
    const stored = await getStoredAttachment(f.ctx, uploaded.id)
    expect(stored).toEqual({ body: await f.file.arrayBuffer(), filename: f.file.name, contentType: f.file.type })
    await deleteStoredAttachment(f.ctx, uploaded.id)
    expect(f.sqlite.prepare('SELECT id FROM attachments WHERE id = ?').get(uploaded.id)).toBeUndefined()
    expect(f.objects.size).toBe(0)
  })
  it('keeps the API 50 MiB boundary, MIME and quota checks before writing storage', async () => {
    const f = fixture()
    const unsupported = new File(['x'], 'bad.bin', { type: 'application/octet-stream' })
    await expect(uploadStoredAttachment(f.ctx, input(unsupported))).rejects.toMatchObject({
      kind: 'unsupported_media_type',
    })
    const oversized = new File([new Uint8Array(MAX_UPLOAD_SIZE + 1)], 'large.png', { type: 'image/png' })
    await expect(uploadStoredAttachment(f.ctx, input(oversized))).rejects.toMatchObject({
      kind: 'payload_too_large',
    })
    await expect(uploadStoredAttachment(f.ctx, input(f.file), 3)).rejects.toMatchObject({
      kind: 'payload_too_large',
    })
    expect(f.put).not.toHaveBeenCalled()
    const uploaded = await uploadStoredAttachment(f.ctx, input(f.file), 4)
    expect(uploaded.size).toBe(4)
    await expect(uploadStoredAttachment(f.ctx, input(f.file), 4)).rejects.toMatchObject({
      kind: 'payload_too_large',
    })
    expect(f.put).toHaveBeenCalledTimes(1)
  })
  it('removes newly stored bytes when metadata insertion fails', async () => {
    const f = fixture()
    f.sqlite.exec(
      "CREATE TRIGGER fail_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT, 'insert failure'); END",
    )
    await expect(uploadStoredAttachment(f.ctx, input(f.file))).rejects.toThrow('insert failure')
    expect(f.put).toHaveBeenCalledOnce()
    expect(f.remove).toHaveBeenCalledOnce()
    expect(f.objects.size).toBe(0)
  })
  it.each(['viewer', 'ungranted', 'project-viewer'] as const)(
    'cleans bytes after %s write authorization rejection',
    async (kind) => {
      const f = fixture()
      f.ctx.role = kind === 'viewer' ? 'viewer' : 'member'
      if (kind === 'project-viewer')
        f.sqlite.exec(`
      INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g1','w1','Readers',1);
      INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1);
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','viewer');
    `)
      await expect(uploadStoredAttachment(f.ctx, input(f.file))).rejects.toMatchObject({
        kind: kind === 'ungranted' ? 'not_found' : 'forbidden',
      })
      expect(f.objects.size).toBe(0)
      expect(f.remove).toHaveBeenCalledOnce()
    },
  )
  it('requires owner visibility and tenant scope before reading or deleting stored bytes', async () => {
    const f = fixture()
    const uploaded = await uploadStoredAttachment(f.ctx, input(f.file))
    f.ctx.workspaceId = 'w2'
    await expect(getStoredAttachment(f.ctx, uploaded.id)).rejects.toMatchObject({ kind: 'not_found' })
    await expect(deleteStoredAttachment(f.ctx, uploaded.id)).rejects.toMatchObject({ kind: 'not_found' })
    f.ctx.workspaceId = 'w1'
    f.ctx.role = 'member'
    await expect(getStoredAttachment(f.ctx, uploaded.id)).rejects.toMatchObject({ kind: 'not_found' })
    await expect(deleteStoredAttachment(f.ctx, uploaded.id)).rejects.toMatchObject({ kind: 'not_found' })
    expect(f.get).not.toHaveBeenCalled()
    expect(f.remove).not.toHaveBeenCalled()
    expect(f.objects.size).toBe(1)
    f.sqlite.exec(`
      INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g1','w1','Readers',1);
      INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1);
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','viewer');
    `)
    expect(await getStoredAttachment(f.ctx, uploaded.id)).not.toBeNull()
    // Existing deletion policy is flat workspace-write plus owner read visibility.
    await deleteStoredAttachment(f.ctx, uploaded.id)
    expect(f.objects.size).toBe(0)
  })
  it('preserves free-floating entity compatibility and null-project wiki uploads', async () => {
    const f = fixture()
    f.ctx.role = 'member'
    const orphan = await uploadStoredAttachment(f.ctx, input(f.file, 'missing-owner'))
    expect(await getStoredAttachment(f.ctx, orphan.id)).not.toBeNull()
    f.sqlite.exec(`INSERT INTO wiki_pages
      (id,workspace_id,slug,title,created_by_id,updated_by_id,created_at,updated_at)
      VALUES ('page','w1','page','Page','u1','u1',1,1)`)
    const page = await uploadStoredAttachment(f.ctx, { file: f.file, entityType: 'wiki_page', entityId: 'page' })
    expect(await getStoredAttachment(f.ctx, page.id)).not.toBeNull()
  })
  it('returns null for missing objects and skips R2 deletion for non-file metadata', async () => {
    const f = fixture()
    const uploaded = await uploadStoredAttachment(f.ctx, input(f.file))
    f.objects.clear()
    expect(await getStoredAttachment(f.ctx, uploaded.id)).toBeNull()
    const link = await createLinkAttachment(f.ctx, {
      kind: 'url',
      entityType: 'issue',
      entityId: 'i1',
      url: 'https://example.test',
    })
    await deleteStoredAttachment(f.ctx, link.id)
    expect(f.remove).not.toHaveBeenCalled()
  })
  it('uses finite positive configured quota or the unchanged default', () => {
    for (const value of [undefined, '', '0', '-1', 'invalid', 'Infinity'])
      expect(storageQuotaBytes({ STORAGE_QUOTA_BYTES: value })).toBe(1024 * 1024 * 1024)
    expect(storageQuotaBytes({ STORAGE_QUOTA_BYTES: '4' })).toBe(4)
  })
})
