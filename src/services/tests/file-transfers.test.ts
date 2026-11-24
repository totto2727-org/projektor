import { Iterable } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import {
  createLinkAttachment,
  deleteStoredAttachment,
  getStoredAttachment,
  MAX_UPLOAD_SIZE,
  storageQuotaBytes,
  uploadStoredAttachment,
} from '#commands/files.ts'
import type { ServiceCtx } from '#commands/types.ts'
import { createTestDatabase } from '@/test/database.ts'

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
  const put = vi.fn(async (key: string, body: ReadableStream<Uint8Array>) => {
    objects.set(key, await new Response(body).arrayBuffer())
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
const input = (file: File, entityId = 'i1'): { file: File; entityType: 'issue'; entityId: string } => ({
  file,
  entityType: 'issue' as const,
  entityId,
})

describe('shared file transfer commands over migrated SQLite and bounded R2', () => {
  test('accepts only one concurrent upload when both preflights see the same remaining quota', async () => {
    const testFixture = fixture()
    const ready = Promise.withResolvers<void>()
    let arrivals = 0
    testFixture.put.mockImplementation(async (key, body) => {
      testFixture.objects.set(key, await new Response(body).arrayBuffer())
      if (++arrivals === 2) {
        ready.resolve()
      }
      await ready.promise
      return null
    })
    const results = await Promise.allSettled([
      uploadStoredAttachment(testFixture.ctx, input(testFixture.file), 4),
      uploadStoredAttachment(testFixture.ctx, input(testFixture.file), 4),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { kind: 'payload_too_large' },
    })
    expect(testFixture.sqlite.prepare('SELECT COUNT(*) AS n, SUM(size) AS total FROM attachments').get()).toMatchObject(
      {
        n: 1,
        total: 4,
      },
    )
    expect(testFixture.objects.size).toBe(1)
    expect(testFixture.remove).toHaveBeenCalledOnce()
  })

  test('streams upload bytes without materializing the File as an ArrayBuffer', async () => {
    const testFixture = fixture()
    const buffer = vi.spyOn(testFixture.file, 'arrayBuffer').mockRejectedValue(new Error('must not buffer upload'))
    await uploadStoredAttachment(testFixture.ctx, input(testFixture.file))
    expect(buffer).not.toHaveBeenCalled()
    expect(new Uint8Array([...testFixture.objects.values()][0])).toStrictEqual(new Uint8Array([0, 255, 7, 128]))
  })

  test('uploads exact bytes and metadata, reads archived-owner bytes, then deletes both stores', async () => {
    const testFixture = fixture()
    const uploaded = await uploadStoredAttachment(testFixture.ctx, input(testFixture.file))
    expect(uploaded).toStrictEqual({
      contentType: 'image/png',
      filename: 'diagram.png',
      id: expect.any(String),
      size: 4,
    })
    const row = testFixture.sqlite.prepare('SELECT * FROM attachments WHERE id = ?').get(uploaded.id)
    expect(row).toMatchObject({ created_by_id: 'u1', entity_id: 'i1', size: 4, workspace_id: 'w1' })
    expect(testFixture.put).toHaveBeenCalledWith(expect.stringMatching(/^w1\//u), expect.any(ReadableStream), {
      httpMetadata: { contentType: 'image/png' },
    })
    expect([...testFixture.objects.values()]).toStrictEqual([await testFixture.file.arrayBuffer()])
    const stored = await getStoredAttachment(testFixture.ctx, uploaded.id)
    expect(stored).toStrictEqual({
      body: await testFixture.file.arrayBuffer(),
      filename: testFixture.file.name,
      contentType: testFixture.file.type,
    })
    await deleteStoredAttachment(testFixture.ctx, uploaded.id)
    expect(testFixture.sqlite.prepare('SELECT id FROM attachments WHERE id = ?').get(uploaded.id)).toBeUndefined()
    expect(testFixture.objects.size).toBe(0)
  })

  test('keeps the API 50 MiB boundary, MIME and quota checks before writing storage', async () => {
    const testFixture = fixture()
    const unsupported = new File(['x'], 'bad.bin', { type: 'application/octet-stream' })
    await expect(uploadStoredAttachment(testFixture.ctx, input(unsupported))).rejects.toMatchObject({
      kind: 'unsupported_media_type',
    })
    const oversized = new File([new Uint8Array(MAX_UPLOAD_SIZE + 1)], 'large.png', { type: 'image/png' })
    await expect(uploadStoredAttachment(testFixture.ctx, input(oversized))).rejects.toMatchObject({
      kind: 'payload_too_large',
    })
    await expect(uploadStoredAttachment(testFixture.ctx, input(testFixture.file), 3)).rejects.toMatchObject({
      kind: 'payload_too_large',
    })
    expect(testFixture.put).not.toHaveBeenCalled()
    const uploaded = await uploadStoredAttachment(testFixture.ctx, input(testFixture.file), 4)
    expect(uploaded.size).toBe(4)
    await expect(uploadStoredAttachment(testFixture.ctx, input(testFixture.file), 4)).rejects.toMatchObject({
      kind: 'payload_too_large',
    })
    expect(testFixture.put).toHaveBeenCalledOnce()
  })

  test('removes newly stored bytes when metadata insertion fails', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec(
      "CREATE TRIGGER fail_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT, 'insert failure'); END",
    )
    await expect(uploadStoredAttachment(testFixture.ctx, input(testFixture.file))).rejects.toThrow('insert failure')
    expect(testFixture.put).toHaveBeenCalledOnce()
    expect(testFixture.remove).toHaveBeenCalledOnce()
    expect(testFixture.objects.size).toBe(0)
  })

  test.each(['viewer', 'ungranted', 'project-viewer'] as const)(
    'rejects %s writes before storing bytes',
    async (kind) => {
      const testFixture = fixture()
      testFixture.ctx.role = kind === 'viewer' ? 'viewer' : 'member'
      if (kind === 'project-viewer') {
        testFixture.sqlite.exec(`
      INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g1','w1','Readers',1);
      INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1);
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','viewer');
    `)
      }
      await expect(uploadStoredAttachment(testFixture.ctx, input(testFixture.file))).rejects.toMatchObject({
        kind: kind === 'project-viewer' ? 'forbidden' : 'not_found',
      })
      expect(testFixture.objects.size).toBe(0)
      expect(testFixture.put).not.toHaveBeenCalled()
      expect(testFixture.remove).not.toHaveBeenCalled()
    },
  )

  test('requires owner visibility and tenant scope before reading or deleting stored bytes', async () => {
    const testFixture = fixture()
    const uploaded = await uploadStoredAttachment(testFixture.ctx, input(testFixture.file))
    testFixture.ctx.workspaceId = 'w2'
    await expect(getStoredAttachment(testFixture.ctx, uploaded.id)).rejects.toMatchObject({ kind: 'not_found' })
    await expect(deleteStoredAttachment(testFixture.ctx, uploaded.id)).rejects.toMatchObject({ kind: 'not_found' })
    testFixture.ctx.workspaceId = 'w1'
    testFixture.ctx.role = 'member'
    await expect(getStoredAttachment(testFixture.ctx, uploaded.id)).rejects.toMatchObject({ kind: 'not_found' })
    await expect(deleteStoredAttachment(testFixture.ctx, uploaded.id)).rejects.toMatchObject({ kind: 'not_found' })
    expect(testFixture.get).not.toHaveBeenCalled()
    expect(testFixture.remove).not.toHaveBeenCalled()
    expect(testFixture.objects.size).toBe(1)
    testFixture.sqlite.exec(`
      INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g1','w1','Readers',1);
      INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1);
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','viewer');
    `)
    await expect(getStoredAttachment(testFixture.ctx, uploaded.id)).resolves.not.toBeNull()
    await expect(deleteStoredAttachment(testFixture.ctx, uploaded.id)).rejects.toMatchObject({ kind: 'forbidden' })
    expect(testFixture.objects.size).toBe(1)
    testFixture.sqlite.exec("UPDATE group_project_grants SET role = 'member' WHERE group_id = 'g1'")
    testFixture.ctx.role = 'viewer'
    await deleteStoredAttachment(testFixture.ctx, uploaded.id)
    expect(testFixture.objects.size).toBe(0)
  })

  test('preserves free-floating entity compatibility and null-project wiki uploads', async () => {
    const testFixture = fixture()
    testFixture.ctx.role = 'member'
    const orphan = await uploadStoredAttachment(testFixture.ctx, input(testFixture.file, 'missing-owner'))
    await expect(getStoredAttachment(testFixture.ctx, orphan.id)).resolves.not.toBeNull()
    testFixture.sqlite.exec(`INSERT INTO wiki_pages
      (id,workspace_id,slug,title,created_by_id,updated_by_id,created_at,updated_at)
      VALUES ('page','w1','page','Page','u1','u1',1,1)`)
    const page = await uploadStoredAttachment(testFixture.ctx, {
      file: testFixture.file,
      entityType: 'wiki_page',
      entityId: 'page',
    })
    await expect(getStoredAttachment(testFixture.ctx, page.id)).resolves.not.toBeNull()
  })

  test('returns null for missing objects and skips R2 deletion for non-file metadata', async () => {
    const testFixture = fixture()
    const uploaded = await uploadStoredAttachment(testFixture.ctx, input(testFixture.file))
    testFixture.objects.clear()
    await expect(getStoredAttachment(testFixture.ctx, uploaded.id)).resolves.toBeNull()
    const link = await createLinkAttachment(testFixture.ctx, {
      kind: 'url',
      entityType: 'issue',
      entityId: 'i1',
      url: 'https://example.test',
    })
    await deleteStoredAttachment(testFixture.ctx, link.id)
    expect(testFixture.remove).not.toHaveBeenCalled()
  })

  test('retains metadata and quota accounting when storage deletion fails, then permits retry', async () => {
    const testFixture = fixture()
    const uploaded = await uploadStoredAttachment(testFixture.ctx, input(testFixture.file))
    testFixture.remove.mockRejectedValueOnce(new Error('R2 unavailable'))
    await expect(deleteStoredAttachment(testFixture.ctx, uploaded.id)).rejects.toThrow('R2 unavailable')
    expect(
      testFixture.sqlite.prepare('SELECT r2_key,size FROM attachments WHERE id = ?').get(uploaded.id),
    ).toMatchObject({
      size: 4,
    })
    expect(testFixture.objects.size).toBe(1)
    await deleteStoredAttachment(testFixture.ctx, uploaded.id)
    expect(testFixture.sqlite.prepare('SELECT id FROM attachments WHERE id = ?').get(uploaded.id)).toBeUndefined()
    expect(testFixture.objects.size).toBe(0)
  })

  test('preserves the metadata error when compensation also fails', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec(
      "CREATE TRIGGER fail_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT, 'original insert failure'); END",
    )
    testFixture.remove.mockRejectedValueOnce(new Error('cleanup failure'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(uploadStoredAttachment(testFixture.ctx, input(testFixture.file))).rejects.toThrow(
        'original insert failure',
      )
      expect(log).toHaveBeenCalledWith(
        'uploadStoredAttachment: compensation failed',
        expect.objectContaining({ r2Key: expect.stringMatching(/^w1\//u) }),
      )
    } finally {
      log.mockRestore()
    }
  })

  test('uses finite positive configured quota or the unchanged default', () => {
    Iterable.forEach([undefined, '', '0', '-1', 'invalid', 'Infinity'], (value) => {
      expect(storageQuotaBytes({ STORAGE_QUOTA_BYTES: value })).toBe(1024 * 1024 * 1024)
    })
    expect(storageQuotaBytes({ STORAGE_QUOTA_BYTES: '4' })).toBe(4)
  })
})
