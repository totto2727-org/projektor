import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { Iterable, Predicate } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { providerOptions } from '#contracts/oauth-provider.ts'
import { OAUTH_PURGE_STATE_KEY, purgeOAuthPage } from '#core/api/oauth-purge.ts'
import { runIndexedInOrder } from '#tests/run-effect.ts'

import { env } from './fixture-api.ts'

const memoryNamespace = function memoryNamespace() {
  const values = new Map<string, string>()
  const scans: { prefix: string; cursor?: string }[] = []
  let failGet: string | undefined
  let failPut = false
  const namespace = {
    async get(key: string, options?: string | { type?: string }) {
      if (key === failGet) {
        throw new Error('Injected KV read failure')
      }
      const value = values.get(key)
      if (Predicate.isNullish(value)) {
        return null
      }
      const type = Predicate.isString(options) ? options : options?.type
      return type === 'json' ? JSON.parse(value) : value
    },
    async put(key: string, value: string) {
      if (failPut) {
        throw new Error('Injected KV checkpoint failure')
      }
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
        .toSorted()
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

const fixture = function fixture() {
  const storage = memoryNamespace()
  const checkpoints = memoryNamespace()
  const provider = new OAuthProvider(
    providerOptions<{ OAUTH_KV: KVNamespace }>({ fetch: () => new Response('Not found', { status: 404 }) }),
  )
  const purgeEnv = { OAUTH_KV: storage.namespace, KV: checkpoints.namespace }
  const put = (key: string, value: unknown): Map<string, string> => storage.values.set(key, JSON.stringify(value))
  put('client:client', { clientId: 'client' })
  const grant = (id: string, userId = 'u', extra: Record<string, unknown> = {}): Map<string, string> =>
    put(`grant:${userId}:${id}`, { id, userId, clientId: 'client', ...extra })
  const state = () => JSON.parse(checkpoints.values.get(OAUTH_PURGE_STATE_KEY) ?? 'null')
  return {
    storage,
    checkpoints,
    env: purgeEnv,
    provider,
    put,
    grant,
    state,
    run: () => purgeOAuthPage(purgeEnv, provider),
  }
}

describe('official OAuth cleanup durable pagination', () => {
  test('resumes an opaque native KV cursor and reaches a late expired grant', async () => {
    const clientId = `purge-${crypto.randomUUID()}`
    const userId = `purge-${crypto.randomUUID()}`
    const keys = [`client:${clientId}`]
    const provider = new OAuthProvider(
      providerOptions<{ OAUTH_KV: KVNamespace }>({ fetch: () => new Response('Not found', { status: 404 }) }),
    )
    try {
      await env.KV.delete(OAUTH_PURGE_STATE_KEY)
      await env.OAUTH_KV.put(keys[0], JSON.stringify({ clientId }))
      await runIndexedInOrder(202, async (index): Promise<void> => {
        const id = String(index).padStart(3, '0')
        const key = `grant:${userId}:${id}`
        keys.push(key)
        await env.OAUTH_KV.put(
          key,
          JSON.stringify({ id, userId, clientId, ...(index === 201 ? { expiresAt: 1 } : {}) }),
        )
      })
      await expect(purgeOAuthPage(env, provider)).resolves.toMatchObject({ grantsChecked: 200, phase: 'grants' })
      const checkpoint = await env.KV.get<{ phase: string; cursor: string }>(OAUTH_PURGE_STATE_KEY, 'json')
      expect(checkpoint).toMatchObject({ cursor: expect.any(String), phase: 'grants' })
      await expect(purgeOAuthPage(env, provider)).resolves.toMatchObject({ grantsPurged: 1, nextPhase: 'tokens' })
      await expect(env.OAUTH_KV.get(`grant:${userId}:201`)).resolves.toBeNull()
      await expect(env.OAUTH_KV.get(`grant:${userId}:000`)).resolves.not.toBeNull()
      await expect(purgeOAuthPage(env, provider)).resolves.toMatchObject({ done: true, phase: 'tokens' })
    } finally {
      for (const key of keys) {
        await env.OAUTH_KV.delete(key)
      }
      await env.KV.delete(OAUTH_PURGE_STATE_KEY)
    }
  })

  test('passes more than 200 live grants and tokens without starving either phase', async () => {
    const testFixture = fixture()
    Iterable.forEach(Iterable.range(0, 405 - 1), (index): void => {
      const id = String(index).padStart(3, '0')
      testFixture.grant(id)
      testFixture.put(`token:u:000:${id}`, { userId: 'u', grantId: '000' })
    })
    testFixture.grant('expired', 'z', { expiresAt: 1 })
    testFixture.grant('orphan', 'z', { clientId: 'deleted-client' })
    testFixture.put('token:z:expired:access', { userId: 'z', grantId: 'expired' })
    testFixture.put('token:z:missing:access', { userId: 'z', grantId: 'missing' })

    const first = await testFixture.run()
    expect(first).toMatchObject({ done: false, grantsChecked: 200, phase: 'grants' })
    expect(testFixture.state()).toStrictEqual({ cursor: 'grant:u:199', phase: 'grants' })
    const result = await testFixture.run()
    expect(result.grantsChecked).toBe(200)
    await expect(testFixture.run()).resolves.toMatchObject({ grantsPurged: 2, nextPhase: 'tokens', phase: 'grants' })
    expect(testFixture.storage.values.has('grant:z:expired')).toBe(false)
    expect(testFixture.storage.values.has('grant:z:orphan')).toBe(false)
    expect(testFixture.storage.values.has('token:z:expired:access')).toBe(false)

    const grantScans = testFixture.storage.scans.filter((scan) => scan.prefix === 'grant:').length
    await expect(testFixture.run()).resolves.toMatchObject({ done: false, phase: 'tokens', tokensChecked: 200 })
    await expect(testFixture.run()).resolves.toMatchObject({ done: false, phase: 'tokens', tokensChecked: 200 })
    await expect(testFixture.run()).resolves.toMatchObject({ done: true, phase: 'tokens', tokensPurged: 1 })
    expect(testFixture.storage.scans.filter((scan) => scan.prefix === 'grant:')).toHaveLength(grantScans)
    expect(testFixture.storage.values.has('token:z:missing:access')).toBe(false)
    expect(testFixture.storage.values.has('token:u:000:404')).toBe(true)
    expect(testFixture.state()).toStrictEqual({ phase: 'grants' })
  })

  test('does not advance a saved cursor when an item in the next page fails', async () => {
    const testFixture = fixture()
    Iterable.forEach(Iterable.range(0, 205 - 1), (index): void => {
      testFixture.grant(String(index).padStart(3, '0'), 'u', index === 201 ? { expiresAt: 1 } : {})
    })
    testFixture.grant('expired', 'z', { expiresAt: 1 })
    await testFixture.run()
    const before = testFixture.state()
    testFixture.storage.failGet('grant:u:202')
    await expect(testFixture.run()).rejects.toThrow('Injected KV read failure')
    expect(testFixture.state()).toStrictEqual(before)
    expect(testFixture.storage.values.has('grant:u:201')).toBe(false)
    expect(testFixture.storage.values.has('grant:z:expired')).toBe(true)
    testFixture.storage.failGet()
    await expect(testFixture.run()).resolves.toMatchObject({ grantsPurged: 1, nextPhase: 'tokens' })
    expect(testFixture.storage.values.has('grant:z:expired')).toBe(false)
  })

  test('retries a page safely when persisting its checkpoint fails after revocation', async () => {
    const testFixture = fixture()
    testFixture.grant('expired', 'z', { expiresAt: 1 })
    testFixture.checkpoints.failPut(true)
    await expect(testFixture.run()).rejects.toThrow('Injected KV checkpoint failure')
    expect(testFixture.state()).toBeNull()
    expect(testFixture.storage.values.has('grant:z:expired')).toBe(false)
    testFixture.checkpoints.failPut(false)
    await expect(testFixture.run()).resolves.toMatchObject({ grantsPurged: 0, nextPhase: 'tokens' })
  })

  test('bounds nested SDK revocation calls without advancing past a partially processed grant', async () => {
    const testFixture = fixture()
    testFixture.grant('expired', 'z', { expiresAt: 1 })
    Iterable.forEach(Iterable.range(0, 850 - 1), (index): void => {
      testFixture.put(`token:z:expired:${index}`, { userId: 'z', grantId: 'expired' })
    })
    await expect(testFixture.run()).rejects.toThrow('OAuth purge KV call budget exhausted')
    expect(testFixture.state()).toBeNull()
    expect(testFixture.storage.values.has('grant:z:expired')).toBe(true)
    await expect(testFixture.run()).resolves.toMatchObject({ grantsPurged: 1, nextPhase: 'tokens' })
    expect([...testFixture.storage.values.keys()].some((key) => key.startsWith('token:z:expired:'))).toBe(false)
  })
})
