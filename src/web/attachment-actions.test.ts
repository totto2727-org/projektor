import { describe, expect, it, vi } from 'vite-plus/test'

import { actionFixture, formData } from './features/planning/action-test-fixture'

const { uploadAttachment, uploadInlineImage } = await import('./attachment-actions')

function fileFixture(origin = 'https://front.example', quotaBytes?: string) {
  const objects = new Map<string, ArrayBuffer>()
  // A bounded R2 double, with the real migrated database and command authorization.
  const put = vi.fn(async (key: string, body: ArrayBuffer) => {
    objects.set(key, body)
    return null
  })
  const remove = vi.fn(async (key: string) => {
    objects.delete(key)
  })
  const r2 = { put, delete: remove } as unknown as R2Bucket
  const fixture = actionFixture(
    () => {
      throw new Error('File transfer must not use API transport.')
    },
    origin,
    {
      R2: r2,
      STORAGE_QUOTA_BYTES: quotaBytes,
    },
  )
  return { ...fixture, objects, put, remove }
}
function file(bytes: Uint8Array<ArrayBuffer> = new Uint8Array([0, 255, 7, 128]), type = 'image/png') {
  return new File([bytes], 'diagram.png', { type })
}
function invoke(
  fixture: ReturnType<typeof fileFixture>,
  kind: 'native' | 'inline',
  upload = file(),
  workspaceSlug = 'alpha',
) {
  const input = { workspaceSlug, entityType: 'wiki_page' as const, entityId: 'wiki-1', file: upload }
  if (kind === 'inline') return fixture.invoke(uploadInlineImage, input)
  const fields = formData({ workspaceSlug, entityType: input.entityType, entityId: input.entityId })
  fields.set('file', upload)
  return fixture.invoke(uploadAttachment, null, fields)
}

describe('direct attachment ServerFns with shared guarded D1/R2 commands', () => {
  it.each(['native', 'inline'] as const)(
    'preserves exact 64 KiB bytes and concrete metadata without API transfer (%s)',
    async (kind) => {
      const fixture = fileFixture()
      const bytes = Uint8Array.from({ length: 64 * 1024 }, (_, index) => index % 256)
      const upload = file(bytes)
      const result = await invoke(fixture, kind, upload)
      expect(result).toEqual({
        ok: true,
        value: {
          id: expect.any(String),
          filename: 'diagram.png',
          contentType: 'image/png',
          size: bytes.length,
        },
      })
      expect(fixture.put).toHaveBeenCalledWith(expect.stringMatching(/^w1\//), await upload.arrayBuffer(), {
        httpMetadata: { contentType: 'image/png' },
      })
      expect(fixture.sqlite.prepare('SELECT workspace_id,entity_type,entity_id,size FROM attachments').get()).toEqual({
        workspace_id: 'w1',
        entity_type: 'wiki_page',
        entity_id: 'wiki-1',
        size: bytes.length,
      })
      expect(fixture.transport).not.toHaveBeenCalled()
      expect(fixture.invalidated).toHaveBeenCalledOnce()
    },
  )
  it.each(['native', 'inline'] as const)(
    'rejects cross-origin writes before authorization or storage (%s)',
    async (kind) => {
      const fixture = fileFixture('https://other.example')
      expect(await invoke(fixture, kind)).toMatchObject({ ok: false, status: 403 })
      expect(fixture.transport).not.toHaveBeenCalled()
      expect(fixture.put).not.toHaveBeenCalled()
      expect(fixture.invalidated).toHaveBeenCalledOnce()
    },
  )
  it.each(['native', 'inline'] as const)('preserves the effective Web 10 MiB cap (%s)', async (kind) => {
    const fixture = fileFixture()
    expect(await invoke(fixture, kind, file(new Uint8Array(10 * 1024 * 1024 + 1)))).toMatchObject({
      ok: false,
      status: 413,
    })
    expect(fixture.put).not.toHaveBeenCalled()
    expect(fixture.invalidated).toHaveBeenCalledOnce()
  })
  it.each(['native', 'inline'] as const)('retains shared MIME and configured quota rejection (%s)', async (kind) => {
    const unsupported = fileFixture()
    expect(await invoke(unsupported, kind, file(undefined, 'application/octet-stream'))).toMatchObject({
      ok: false,
      status: 415,
    })
    const quota = fileFixture('https://front.example', '3')
    expect(await invoke(quota, kind)).toMatchObject({ ok: false, status: 413 })
    expect(unsupported.put).not.toHaveBeenCalled()
    expect(quota.put).not.toHaveBeenCalled()
  })
  it.each(['native', 'inline'] as const)('rejects foreign workspace selection before storage (%s)', async (kind) => {
    const fixture = fileFixture()
    expect(await invoke(fixture, kind, file(), 'beta')).toMatchObject({ ok: false, status: 403 })
    expect(fixture.put).not.toHaveBeenCalled()
  })
  it.each(['native', 'inline'] as const)('compensates R2 and redacts a metadata write failure (%s)', async (kind) => {
    const fixture = fileFixture()
    fixture.sqlite.exec(
      "CREATE TRIGGER fail_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT, 'private storage failure'); END",
    )
    const result = await invoke(fixture, kind)
    expect(result).toMatchObject({ ok: false, status: 500 })
    expect(JSON.stringify(result)).not.toContain('private storage failure')
    expect(fixture.remove).toHaveBeenCalledOnce()
    expect(fixture.objects.size).toBe(0)
    expect(fixture.invalidated).toHaveBeenCalledOnce()
  })
})
