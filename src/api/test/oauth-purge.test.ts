import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { describe, expect, it } from 'vite-plus/test'

import { providerOptions } from '../../contracts/oauth-provider'
import { OAUTH_PURGE_STATE_KEY, purgeOAuthPage } from '../../core/api/oauth-purge'
import { env } from './fixture-api'

function memoryNamespace() {
  const values = new Map<string, string>()
  const scans: { prefix: string; cursor?: string }[] = []
  let failGet: string | undefined
  let failPut = false
  const namespace = {
    async get(key: string, options?: string | { type?: string }) {
      if (key === failGet) throw new Error('Injected KV read failure')
      const value = values.get(key)
      if (value === undefined) return null
      const type = typeof options === 'string' ? options : options?.type
      return type === 'json' ? JSON.parse(value) : value
    },
    async put(key: string, value: string) {
      if (failPut) throw new Error('Injected KV checkpoint failure')
      values.set(key, value)
    },
    async delete(key: string) {
      values.delete(key)
    },
    async list(options?: KVNamespaceListOptions) {
      const prefix = options?.prefix ?? ''
      scans.push({ prefix, cursor: options?.cursor ?? undefined })
      const names = [...values.keys()]
        .filter((key) => key.startsWith(prefix) && (!options?.cursor || key > options.cursor))
        .sort()
      const selected = names.slice(0, options?.limit ?? 1000)
      const complete = selected.length === names.length
      return {
        keys: selected.map((name) => ({ name })),
        list_complete: complete,
        cursor: complete ? '' : selected.at(-1),
        cacheStatus: null,
      }
    },
  } as unknown as KVNamespace
  return {
    values,
    scans,
    namespace,
    failGet(key?: string) {
      failGet = key
    },
    failPut(value: boolean) {
      failPut = value
    },
  }
}

function fixture() {
  const storage = memoryNamespace()
  const checkpoints = memoryNamespace()
  const provider = new OAuthProvider(
    providerOptions<{ OAUTH_KV: KVNamespace }>({ fetch: () => new Response('Not found', { status: 404 }) }),
  )
  const env = { OAUTH_KV: storage.namespace, KV: checkpoints.namespace }
  const put = (key: string, value: unknown) => storage.values.set(key, JSON.stringify(value))
  put('client:client', { clientId: 'client' })
  const grant = (id: string, userId = 'u', extra: Record<string, unknown> = {}) =>
    put(`grant:${userId}:${id}`, { id, userId, clientId: 'client', ...extra })
  const state = () => JSON.parse(checkpoints.values.get(OAUTH_PURGE_STATE_KEY) ?? 'null')
  return { storage, checkpoints, env, provider, put, grant, state, run: () => purgeOAuthPage(env, provider) }
}

describe('official OAuth cleanup durable pagination', () => {
  it('resumes an opaque native KV cursor and reaches a late expired grant', async () => {
    const clientId = `purge-${crypto.randomUUID()}`
    const userId = `purge-${crypto.randomUUID()}`
    const keys = [`client:${clientId}`]
    const provider = new OAuthProvider(
      providerOptions<{ OAUTH_KV: KVNamespace }>({ fetch: () => new Response('Not found', { status: 404 }) }),
    )
    try {
      await env.KV.delete(OAUTH_PURGE_STATE_KEY)
      await env.OAUTH_KV.put(keys[0], JSON.stringify({ clientId }))
      for (let index = 0; index < 202; index++) {
        const id = String(index).padStart(3, '0')
        const key = `grant:${userId}:${id}`
        keys.push(key)
        await env.OAUTH_KV.put(
          key,
          JSON.stringify({ id, userId, clientId, ...(index === 201 ? { expiresAt: 1 } : {}) }),
        )
      }
      expect(await purgeOAuthPage(env, provider)).toMatchObject({ phase: 'grants', grantsChecked: 200 })
      const checkpoint = await env.KV.get<{ phase: string; cursor: string }>(OAUTH_PURGE_STATE_KEY, 'json')
      expect(checkpoint).toMatchObject({ phase: 'grants', cursor: expect.any(String) })
      expect(await purgeOAuthPage(env, provider)).toMatchObject({ grantsPurged: 1, nextPhase: 'tokens' })
      expect(await env.OAUTH_KV.get(`grant:${userId}:201`)).toBeNull()
      expect(await env.OAUTH_KV.get(`grant:${userId}:000`)).not.toBeNull()
      expect(await purgeOAuthPage(env, provider)).toMatchObject({ phase: 'tokens', done: true })
    } finally {
      for (const key of keys) await env.OAUTH_KV.delete(key)
      await env.KV.delete(OAUTH_PURGE_STATE_KEY)
    }
  })

  it('passes more than 200 live grants and tokens without starving either phase', async () => {
    const f = fixture()
    for (let index = 0; index < 405; index++) {
      const id = String(index).padStart(3, '0')
      f.grant(id)
      f.put(`token:u:000:${id}`, { userId: 'u', grantId: '000' })
    }
    f.grant('expired', 'z', { expiresAt: 1 })
    f.grant('orphan', 'z', { clientId: 'deleted-client' })
    f.put('token:z:expired:access', { userId: 'z', grantId: 'expired' })
    f.put('token:z:missing:access', { userId: 'z', grantId: 'missing' })

    const first = await f.run()
    expect(first).toMatchObject({ phase: 'grants', grantsChecked: 200, done: false })
    expect(f.state()).toEqual({ phase: 'grants', cursor: 'grant:u:199' })
    expect((await f.run()).grantsChecked).toBe(200)
    expect(await f.run()).toMatchObject({ phase: 'grants', grantsPurged: 2, nextPhase: 'tokens' })
    expect(f.storage.values.has('grant:z:expired')).toBe(false)
    expect(f.storage.values.has('grant:z:orphan')).toBe(false)
    expect(f.storage.values.has('token:z:expired:access')).toBe(false)

    const grantScans = f.storage.scans.filter((scan) => scan.prefix === 'grant:').length
    expect(await f.run()).toMatchObject({ phase: 'tokens', tokensChecked: 200, done: false })
    expect(await f.run()).toMatchObject({ phase: 'tokens', tokensChecked: 200, done: false })
    expect(await f.run()).toMatchObject({ phase: 'tokens', tokensPurged: 1, done: true })
    expect(f.storage.scans.filter((scan) => scan.prefix === 'grant:')).toHaveLength(grantScans)
    expect(f.storage.values.has('token:z:missing:access')).toBe(false)
    expect(f.storage.values.has('token:u:000:404')).toBe(true)
    expect(f.state()).toEqual({ phase: 'grants' })
  })

  it('does not advance a saved cursor when an item in the next page fails', async () => {
    const f = fixture()
    for (let index = 0; index < 205; index++) {
      f.grant(String(index).padStart(3, '0'), 'u', index === 201 ? { expiresAt: 1 } : {})
    }
    f.grant('expired', 'z', { expiresAt: 1 })
    await f.run()
    const before = f.state()
    f.storage.failGet('grant:u:202')
    await expect(f.run()).rejects.toThrow('Injected KV read failure')
    expect(f.state()).toEqual(before)
    expect(f.storage.values.has('grant:u:201')).toBe(false)
    expect(f.storage.values.has('grant:z:expired')).toBe(true)
    f.storage.failGet()
    expect(await f.run()).toMatchObject({ grantsPurged: 1, nextPhase: 'tokens' })
    expect(f.storage.values.has('grant:z:expired')).toBe(false)
  })

  it('retries a page safely when persisting its checkpoint fails after revocation', async () => {
    const f = fixture()
    f.grant('expired', 'z', { expiresAt: 1 })
    f.checkpoints.failPut(true)
    await expect(f.run()).rejects.toThrow('Injected KV checkpoint failure')
    expect(f.state()).toBeNull()
    expect(f.storage.values.has('grant:z:expired')).toBe(false)
    f.checkpoints.failPut(false)
    expect(await f.run()).toMatchObject({ grantsPurged: 0, nextPhase: 'tokens' })
  })

  it('bounds nested SDK revocation calls without advancing past a partially processed grant', async () => {
    const f = fixture()
    f.grant('expired', 'z', { expiresAt: 1 })
    for (let index = 0; index < 850; index++) {
      f.put(`token:z:expired:${index}`, { userId: 'z', grantId: 'expired' })
    }
    await expect(f.run()).rejects.toThrow('OAuth purge KV call budget exhausted')
    expect(f.state()).toBeNull()
    expect(f.storage.values.has('grant:z:expired')).toBe(true)
    expect(await f.run()).toMatchObject({ grantsPurged: 1, nextPhase: 'tokens' })
    expect([...f.storage.values.keys()].some((key) => key.startsWith('token:z:expired:'))).toBe(false)
  })
})
