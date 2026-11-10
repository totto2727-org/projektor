import { makeWorkerBridge } from 'alchemy/Cloudflare/Bridge'
import { WorkerEnvironment, WorkerExecutionContext } from 'alchemy/Cloudflare/Workers'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { Effect } from 'effect'

import { isCoreEnvironment, type CoreEnvironment, type CoreEnvironmentSource } from '../../src/core/environment'
import { makeCoreHandlersWithEnvironment } from '../../src/core/worker'
import { resetAuthCachesForTests } from '../../src/services/authentication'
import { Core as CoreIdentity } from '../../src/workers/identities'

// Test-only composition uses the same named domain handlers and official bridge.
// Loopback props must be resolved during invocation, not from the SDK's shared build.
const fixtureEnvironmentSource: CoreEnvironmentSource = Effect.gen(function* () {
  const env = yield* WorkerEnvironment
  const context = yield* WorkerExecutionContext
  const resolved = resolveFixtureEnvironment(context.raw.props, env)
  const environment = {
    ...resolved,
    invocation: { waitUntil: (promise: Promise<unknown>) => context.raw.waitUntil(promise) },
  }
  if (!isCoreEnvironment(environment)) return yield* Effect.die(new Error('Invalid native fixture bindings'))
  return instrumentEnvironment(environment, context.raw.props)
})

const FixtureCoreLive = CoreIdentity.make(
  Effect.succeed({ name: 'projektor-native-core', main: import.meta.url }),
  makeCoreHandlersWithEnvironment(fixtureEnvironmentSource).pipe(
    Effect.map((handlers) => ({
      ...handlers,
      apiAuthenticate: (...args: Parameters<typeof handlers.apiAuthenticate>) =>
        Effect.gen(function* () {
          const context = yield* WorkerExecutionContext
          observationFor(context.raw.props).authenticateCalls++
          return yield* handlers.apiAuthenticate(...args)
        }),
    })),
  ),
)
const FixtureCore = makeWorkerBridge(WorkerEntrypoint, {
  entrypoint: CoreIdentity.pipe(Effect.provide(FixtureCoreLive)),
  stack: { name: 'projektor-native', stage: 'test' },
})

export interface FixtureStatement {
  readonly sql: string
  readonly params: unknown[]
}

export interface FixtureQuery extends FixtureStatement {
  readonly method: 'all' | 'run' | 'first' | 'raw'
  readonly column?: string
  readonly options?: { readonly columnNames?: boolean }
}

export type FixtureConfiguration = Readonly<Record<string, string | null>>

export type FixtureLimiterMode = 'native' | 'absent' | 'reject' | 'hang'

export interface FixtureObservations {
  authenticateCalls: number
  jwksFetches: string[]
  authCacheGets: string[]
  authCachePuts: string[]
  cacheDeletes: string[]
  broadcasts: { url: string; body: string }[]
}

const observations = new Map<string, FixtureObservations>()
function observationFor(props: unknown): FixtureObservations {
  const epoch = configuration(props ?? {}).RATE_LIMIT_TEST_EPOCH ?? ''
  let observation = observations.get(epoch)
  if (!observation) {
    observation = {
      authenticateCalls: 0,
      jwksFetches: [],
      authCacheGets: [],
      authCachePuts: [],
      cacheDeletes: [],
      broadcasts: [],
    }
    observations.set(epoch, observation)
  }
  return observation
}

function instrumentEnvironment(env: CoreEnvironment, props: unknown): CoreEnvironment {
  const observation = observationFor(props)
  const settings = configuration(props ?? {})
  const rejectDelete = settings.FIXTURE_CACHE_DELETE_MODE === 'reject'
  const matches = (name: string, prefix: string | undefined) =>
    prefix !== undefined && (name === prefix || name.startsWith(`${prefix}:`))
  return {
    ...env,
    KV: new Proxy(env.KV, {
      get(target, key): unknown {
        if (key === 'get')
          return (...args: unknown[]) => {
            const name = args[0]
            if (typeof name === 'string') {
              observation.authCacheGets.push(name)
              if (matches(name, settings.FIXTURE_AUTH_KV_GET_FAILURE))
                return Promise.reject(new Error('Fixture auth KV read unavailable'))
            }
            const get: unknown = Reflect.get(target, 'get')
            if (typeof get !== 'function') throw new Error('Missing native KV get')
            return Reflect.apply(get, target, args)
          }
        if (key === 'put')
          return (...args: Parameters<typeof target.put>) => {
            observation.authCachePuts.push(args[0])
            if (matches(args[0], settings.FIXTURE_AUTH_KV_PUT_FAILURE))
              return Promise.reject(new Error('Fixture auth KV write unavailable'))
            return target.put(...args)
          }
        if (key === 'delete')
          return async (name: string) => {
            observation.cacheDeletes.push(name)
            if (rejectDelete) throw new Error('10048: your account has reached the free usage limit')
            return target.delete(name)
          }
        const value: unknown = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }),
    WORKSPACE_HUB:
      env.WORKSPACE_HUB &&
      new Proxy(env.WORKSPACE_HUB, {
        get(target, key): unknown {
          if (key === 'get')
            return (...args: Parameters<typeof target.get>) => {
              const stub = target.get(...args)
              return new Proxy(stub, {
                get(inner, member): unknown {
                  if (member === 'fetch')
                    return async (...fetchArgs: Parameters<typeof inner.fetch>) => {
                      const request = new Request(...fetchArgs)
                      observation.broadcasts.push({ url: request.url, body: await request.clone().text() })
                      return inner.fetch(request)
                    }
                  const value: unknown = Reflect.get(inner, member)
                  return typeof value === 'function' ? value.bind(inner) : value
                },
              })
            }
          const value: unknown = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      }),
  }
}

const fixtureLimiterCalls = new Map<string, number>()

function fixtureLimiterNamespace(epoch: string, mode: 'reject' | 'hang'): NonNullable<CoreEnvironment['RATE_LIMITER']> {
  // Only the native test artifact injects failures. The real Core policy still
  // runs, and this counter observes each actual attempt from that policy.
  return {
    idFromName: (name: string) => name,
    get: () => ({
      increment: () => {
        fixtureLimiterCalls.set(epoch, (fixtureLimiterCalls.get(epoch) ?? 0) + 1)
        return mode === 'reject'
          ? Promise.reject(new Error('Fixture rate limiter unavailable'))
          : new Promise<never>(() => {})
      },
    }),
  } as unknown as NonNullable<CoreEnvironment['RATE_LIMITER']>
}

function configuration(props: unknown): Record<string, string | undefined> {
  if (props === null || typeof props !== 'object' || Array.isArray(props)) {
    throw new Error('Invalid native fixture configuration')
  }
  const result: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(props)) {
    if (value !== null && typeof value !== 'string') throw new Error(`Invalid fixture configuration: ${key}`)
    if (key === 'FIXTURE_LIMITER_MODE') continue
    if (['DB', 'KV', 'OAUTH_KV', 'R2', 'CORE', 'RATE_LIMITER', 'WORKSPACE_HUB', 'JWT_SECRET'].includes(key)) continue
    result[key] = value === null ? undefined : value
  }
  return result
}

function objectMetadata(object: R2Object) {
  return {
    key: object.key,
    version: object.version,
    size: object.size,
    etag: object.etag,
    httpEtag: object.httpEtag,
    uploaded: object.uploaded,
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
    range: object.range,
    storageClass: object.storageClass,
    checksums: {
      md5: object.checksums.md5,
      sha1: object.checksums.sha1,
      sha256: object.checksums.sha256,
      sha384: object.checksums.sha384,
      sha512: object.checksums.sha512,
    },
  }
}

/** Only this native-test artifact exports fixture storage operations, never production Core. */
export default class NativeFixtureCore extends FixtureCore {
  declare readonly env: CoreEnvironment
  fixtureEnvironment() {
    return {
      database: typeof this.env.DB.prepare === 'function',
      cache: typeof this.env.KV.get === 'function',
      files: typeof this.env.R2.get === 'function',
      devEmail: this.env.DEV_USER_EMAIL ?? null,
      brandName: this.env.BRAND_NAME ?? null,
    }
  }

  async fixtureD1(query: FixtureQuery): Promise<unknown> {
    const statement = this.env.DB.prepare(query.sql).bind(...query.params)
    switch (query.method) {
      case 'all':
        return statement.all()
      case 'run':
        return statement.run()
      case 'first':
        return query.column === undefined ? statement.first() : statement.first(query.column)
      case 'raw':
        return query.options?.columnNames ? statement.raw({ columnNames: true }) : statement.raw()
    }
  }

  async fixtureD1Batch(statements: readonly FixtureStatement[]): Promise<D1Result[]> {
    return this.env.DB.batch(statements.map(({ sql, params }) => this.env.DB.prepare(sql).bind(...params)))
  }

  async fixtureD1Exec(sql: string): Promise<D1ExecResult> {
    return this.env.DB.exec(sql)
  }

  async fixtureKV(
    namespace: 'KV' | 'OAUTH_KV',
    method: 'get' | 'getWithMetadata' | 'put' | 'delete' | 'list',
    args: unknown[],
  ): Promise<unknown> {
    const kv = this.env[namespace]
    return Reflect.apply(kv[method], kv, args)
  }

  async fixtureR2(method: 'get' | 'head' | 'put' | 'delete' | 'list', args: unknown[]): Promise<unknown> {
    const bucket = this.env.R2
    if (method === 'delete') return Reflect.apply(bucket[method], bucket, args)
    if (method === 'list') {
      const listed: R2Objects = await Reflect.apply(bucket[method], bucket, args)
      return { ...listed, objects: listed.objects.map(objectMetadata) }
    }
    const object: R2Object | R2ObjectBody | null = await Reflect.apply(bucket[method], bucket, args)
    if (!object) return null
    return {
      ...objectMetadata(object),
      ...('body' in object ? { body: object.body, bodyUsed: object.bodyUsed } : {}),
    }
  }

  /** A native loopback binding keeps fixture policy request-local, without a custom RPC codec. */
  fixtureSession(settings: FixtureConfiguration) {
    const exports = this.ctx.exports as unknown as {
      Session: (options: { props: FixtureConfiguration }) => Fetcher
    }
    return exports.Session({ props: settings })
  }

  fixtureResetAuthCaches(): void {
    resetAuthCachesForTests()
  }

  fixtureObservations(epoch: string): FixtureObservations {
    return (
      observations.get(epoch) ?? {
        authenticateCalls: 0,
        jwksFetches: [],
        authCacheGets: [],
        authCachePuts: [],
        cacheDeletes: [],
        broadcasts: [],
      }
    )
  }

  fixtureResetObservations(epoch: string): void {
    observations.delete(epoch)
  }

  fixtureLimiterCalls(epoch: string): number {
    return fixtureLimiterCalls.get(epoch) ?? 0
  }
}

function resolveFixtureEnvironment(props: unknown, env: object) {
  const settings = configuration(props ?? {})
  const mode: unknown =
    typeof props === 'object' && props !== null && 'FIXTURE_LIMITER_MODE' in props
      ? props.FIXTURE_LIMITER_MODE
      : undefined
  if (
    mode !== undefined &&
    mode !== null &&
    mode !== 'native' &&
    mode !== 'absent' &&
    mode !== 'reject' &&
    mode !== 'hang'
  ) {
    throw new Error('Invalid native fixture limiter mode')
  }
  const epoch = settings.RATE_LIMIT_TEST_EPOCH ?? ''
  return {
    ...env,
    ...settings,
    ...(mode === 'absent'
      ? { RATE_LIMITER: undefined }
      : mode === 'reject' || mode === 'hang'
        ? { RATE_LIMITER: fixtureLimiterNamespace(epoch, mode) }
        : {}),
  }
}

/** Same official bridge and handlers, with invocation-local fixture settings. */
export class Session extends NativeFixtureCore {
  constructor(context: ExecutionContext, env: CoreEnvironment) {
    const resolved = resolveFixtureEnvironment(context.props, env)
    if (!isCoreEnvironment(resolved)) throw new Error('Invalid native fixture bindings')
    super(context, resolved)
  }
}
