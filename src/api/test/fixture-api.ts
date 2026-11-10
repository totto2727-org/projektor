import { env as nativeEnv } from 'cloudflare:test'

import type { Env } from '#types'

import type NativeFixtureCore from '../../../tests/native-workers/core.worker'

type FixtureCore = Pick<NativeFixtureCore, 'fixtureD1' | 'fixtureD1Batch' | 'fixtureD1Exec' | 'fixtureKV' | 'fixtureR2'>

function core(): FixtureCore {
  // Only the native test Core entrypoint exposes these fixture operations.
  return Reflect.get(nativeEnv, 'CORE') as FixtureCore
}

class FixturePreparedStatement {
  readonly sql: string
  readonly params: unknown[]

  constructor(sql: string, params: unknown[] = []) {
    this.sql = sql
    this.params = params
  }

  bind(...params: unknown[]): FixturePreparedStatement {
    return new FixturePreparedStatement(this.sql, params)
  }

  all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return core().fixtureD1({ sql: this.sql, params: this.params, method: 'all' }) as Promise<D1Result<T>>
  }

  run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return core().fixtureD1({ sql: this.sql, params: this.params, method: 'run' }) as Promise<D1Result<T>>
  }

  first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    return core().fixtureD1({ sql: this.sql, params: this.params, method: 'first', column }) as Promise<T | null>
  }

  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    return core().fixtureD1({ sql: this.sql, params: this.params, method: 'raw', options }) as Promise<T[]>
  }
}

const db = {
  prepare(sql: string) {
    return new FixturePreparedStatement(sql)
  },
  batch(statements: FixturePreparedStatement[]) {
    return core().fixtureD1Batch(statements.map(({ sql, params }) => ({ sql, params })))
  },
  exec(sql: string) {
    return core().fixtureD1Exec(sql)
  },
  withSession(): never {
    throw new Error('Fixture D1 sessions are not supported')
  },
  dump(): Promise<ArrayBuffer> {
    return Promise.reject(new Error('Fixture D1 dump is not supported'))
  },
}

function fixtureKV(namespace: 'KV' | 'OAUTH_KV') {
  return {
    get: (...args: unknown[]) => core().fixtureKV(namespace, 'get', args),
    getWithMetadata: (...args: unknown[]) => core().fixtureKV(namespace, 'getWithMetadata', args),
    put: (...args: unknown[]) => core().fixtureKV(namespace, 'put', args),
    delete: (...args: unknown[]) => core().fixtureKV(namespace, 'delete', args),
    list: (...args: unknown[]) => core().fixtureKV(namespace, 'list', args),
  }
}

function r2Object(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  const metadata = Reflect.get(value, 'httpMetadata') as R2HTTPMetadata | undefined
  const object = {
    ...value,
    writeHttpMetadata(headers: Headers) {
      const names: Record<string, string> = {
        contentType: 'content-type',
        contentLanguage: 'content-language',
        contentDisposition: 'content-disposition',
        contentEncoding: 'content-encoding',
        cacheControl: 'cache-control',
        cacheExpiry: 'expires',
      }
      for (const [key, entry] of Object.entries(metadata ?? {})) {
        if (entry !== undefined)
          headers.set(names[key] ?? key, entry instanceof Date ? entry.toUTCString() : String(entry))
      }
    },
  }
  const body: unknown = Reflect.get(value, 'body')
  if (!(body instanceof ReadableStream)) return object
  const response = new Response(body)
  return {
    ...object,
    get bodyUsed() {
      return response.bodyUsed
    },
    arrayBuffer: () => response.arrayBuffer(),
    text: () => response.text(),
    json: () => response.json(),
    blob: () => response.blob(),
  }
}

const r2 = {
  get: async (...args: unknown[]) => r2Object(await core().fixtureR2('get', args)),
  head: async (...args: unknown[]) => r2Object(await core().fixtureR2('head', args)),
  put: async (...args: unknown[]) => r2Object(await core().fixtureR2('put', args)),
  delete: (...args: unknown[]) => core().fixtureR2('delete', args),
  list: (...args: unknown[]) => core().fixtureR2('list', args),
}

const fixtures = { DB: db, KV: fixtureKV('KV'), R2: r2 }

/** Test-only storage access crosses native RPC to Core. Scalar settings and native
 * bindings remain on the real API environment so existing per-test overrides apply. */
export const env: Env = new Proxy(nativeEnv, {
  get(target, key, receiver): unknown {
    if (key === 'DB' || key === 'KV' || key === 'R2') return fixtures[key]
    return Reflect.get(target, key, receiver)
  },
  set(target, key, value): boolean {
    return Reflect.set(target, key, value)
  },
  ownKeys(target) {
    return [...new Set([...Reflect.ownKeys(target), ...Object.keys(fixtures)])]
  },
  getOwnPropertyDescriptor(target, key) {
    if (key === 'DB' || key === 'KV' || key === 'R2')
      return { configurable: true, enumerable: true, writable: false, value: fixtures[key] }
    return Reflect.getOwnPropertyDescriptor(target, key)
  },
})
