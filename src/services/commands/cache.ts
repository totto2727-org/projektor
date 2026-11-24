export const get = async function get<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    return await kv.get<T>(key, { type: 'json' })
  } catch (error) {
    console.error(`[cache] get failed for key "${key}", treating as a cache miss:`, error)
    return null
  }
}

export const set = async function set<T>(kv: KVNamespace, key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds })
  } catch (error) {
    console.error(`[cache] set failed for key "${key}", continuing without caching:`, error)
  }
}

export const invalidate = async function invalidate(kv: KVNamespace, key: string): Promise<void> {
  try {
    await kv.delete(key)
  } catch (error) {
    console.error(`[cache] invalidate failed for key "${key}", entry may be stale until TTL expiry:`, error)
  }
}

export interface LocalCache<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  invalidate(key: string): void
}

export const createLocalCache = function createLocalCache<T>(ttlMs: number): LocalCache<T> {
  const store = new Map<string, { value: T; expiresAt: number }>()
  return {
    get(key) {
      const hit = store.get(key)
      return hit && hit.expiresAt > Date.now() ? hit.value : undefined
    },
    set(key, value) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
    },
    invalidate(key) {
      store.delete(key)
    },
  }
}
