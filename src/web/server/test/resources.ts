import type { Env } from '../../request'

/** Unit-test storage doubles only. Worker acceptance uses actual native KV/R2 bindings. */
export function inMemoryKV(): KVNamespace {
  const values = new Map<string, string>()
  return {
    get: async (key: string, options?: string | { type?: string }) => {
      const value = values.get(key) ?? null
      const type = typeof options === 'string' ? options : options?.type
      if (value === null) return null
      if (type === 'json') return JSON.parse(value)
      if (type === 'arrayBuffer') return new TextEncoder().encode(value).buffer
      if (type === 'stream') return new Response(value).body
      return value
    },
    getWithMetadata: async (key: string) => ({ value: values.get(key) ?? null, metadata: null, cacheStatus: null }),
    put: async (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) => {
      const text = typeof value === 'string' ? value : await new Response(value as BodyInit).text()
      values.set(key, text)
    },
    delete: async (key: string) => {
      values.delete(key)
    },
    list: async (options?: { prefix?: string }) => ({
      keys: [...values.keys()].filter((name) => name.startsWith(options?.prefix ?? '')).map((name) => ({ name })),
      list_complete: true,
      cacheStatus: null,
    }),
  } as KVNamespace
}

export function inMemoryR2(): R2Bucket {
  const values = new Map<string, { bytes: Uint8Array<ArrayBuffer>; httpMetadata: R2HTTPMetadata }>()
  const object = (key: string, value: { bytes: Uint8Array<ArrayBuffer>; httpMetadata: R2HTTPMetadata }) => ({
    key,
    size: value.bytes.byteLength,
    version: 'test',
    etag: 'test',
    httpEtag: '"test"',
    uploaded: new Date(0),
    checksums: { toJSON: () => ({}) },
    httpMetadata: value.httpMetadata,
    customMetadata: {},
    storageClass: 'Standard' as const,
    writeHttpMetadata: (headers: Headers) => {
      if (value.httpMetadata.contentType) headers.set('content-type', value.httpMetadata.contentType)
    },
  })
  return {
    createMultipartUpload: async () => {
      throw new Error('Multipart R2 uploads are not exercised by this unit fixture.')
    },
    resumeMultipartUpload: () => {
      throw new Error('Multipart R2 uploads are not exercised by this unit fixture.')
    },
    put: async (key: string, body: BodyInit | null, options?: { httpMetadata?: R2HTTPMetadata }) => {
      const value = {
        bytes: new Uint8Array(await new Response(body).arrayBuffer()),
        httpMetadata: options?.httpMetadata ?? {},
      }
      values.set(key, value)
      return object(key, value)
    },
    get: async (key: string) => {
      const value = values.get(key)
      if (!value) return null
      const response = new Response(value.bytes)
      return {
        ...object(key, value),
        body: response.body!,
        bodyUsed: false,
        arrayBuffer: () => response.arrayBuffer(),
        text: () => response.text(),
        json: () => response.json(),
        blob: () => response.blob(),
        bytes: async () => new Uint8Array(await response.arrayBuffer()),
      }
    },
    head: async (key: string) => {
      const value = values.get(key)
      return value ? object(key, value) : null
    },
    delete: async (keys: string | string[]) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) values.delete(key)
    },
    list: async (options?: { prefix?: string }) => ({
      objects: [...values.entries()]
        .filter(([key]) => key.startsWith(options?.prefix ?? ''))
        .map(([key, value]) => object(key, value)),
      truncated: false,
      delimitedPrefixes: [],
    }),
  } as R2Bucket
}

export function createTestResources() {
  const kv = inMemoryKV()
  const oauthKv = inMemoryKV()
  const r2 = inMemoryR2()
  return { kv, oauthKv, r2, KV: kv, OAUTH_KV: oauthKv, R2: r2 }
}

export function testEnvironment(db: D1Database, email = 'owner@example.test', overrides: Partial<Env> = {}): Env {
  const resources = createTestResources()
  return {
    KV: resources.kv,
    OAUTH_KV: resources.oauthKv,
    R2: resources.r2,
    ENVIRONMENT: 'development',
    DEV_USER_EMAIL: email,
    CF_ACCESS_TEAM_DOMAIN: '',
    CF_ACCESS_AUDIENCE: '',
    ...overrides,
    DB: db,
  }
}
