import { Effect, Schema } from 'effect'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import type { ApiEnv, HonoEnv } from '#types'

import {
  bumpRateCounter as apiBumpRateCounter,
  LIMITER_TIMEOUT_MS as apiTimeout,
  rateLimiterObjectName as apiObjectName,
  rateLimitMiddleware,
} from '../../api/middleware/rate-limit'
import { RateLimitRequest, RateCounterRequest, RateLimitResult } from '../../contracts/request-rate-limit'
import { makeApiRateLimitHandlers } from '../../core/api/rate-limit'
import { decodeCoreReply } from '../../core/client'
import { createTestDatabase } from '../../web/test/database'
import { bumpRateCounter, checkRateLimit, LIMITER_TIMEOUT_MS, rateLimiterObjectName } from '../request-rate-limit'
import type { RequestRateLimitEnv } from '../request-rate-limit'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  const counters = new Map<string, { count: number; slot: number }>()
  const increment = vi.fn(async (key: string, windowSecs: number, nowSecs: number) => {
    const slot = Math.floor(nowSecs / windowSecs) * windowSecs
    const previous = counters.get(key)
    const counter = { count: previous?.slot === slot ? previous.count + 1 : 1, slot }
    counters.set(key, counter)
    return counter
  })
  // Bounded native namespace double, exposing only the RPC used by the kernel.
  const idFromName = vi.fn((key: string) => key)
  const namespace = {
    idFromName,
    get: (key: string) => ({ increment: (windowSecs: number, nowSecs: number) => increment(key, windowSecs, nowSecs) }),
  } as unknown as NonNullable<RequestRateLimitEnv['RATE_LIMITER']>
  const env: RequestRateLimitEnv = {
    DB: database.db,
    ENVIRONMENT: 'development',
    RATE_LIMITER: namespace,
    RATE_LIMIT_TEST_NOW_MS: '125000',
  }
  // An SDK-compatible binding substitute executes the real Core handlers against this SQLite fixture.
  const handlers = makeApiRateLimitHandlers(Effect.sync(() => env))
  const binding = {
    fetch: async () => new Response(null, { status: 404 }),
    apiCheckRateLimit: (input: typeof RateLimitRequest.Type) => Effect.runPromise(handlers.apiCheckRateLimit(input)),
    apiBumpRateCounter: (input: typeof RateCounterRequest.Type) =>
      Effect.runPromise(handlers.apiBumpRateCounter(input)),
  } as unknown as Fetcher
  const apiEnv: ApiEnv = {
    ...env,
    CORE: binding,
    OAUTH_KV: {} as KVNamespace,
    JWT_SECRET: 'unused-by-rate-limit',
    CF_ACCESS_TEAM_DOMAIN: '',
    CF_ACCESS_AUDIENCE: '',
  }
  return { ...database, env, apiEnv, handlers, increment, idFromName }
}
const request = (headers: HeadersInit = {}) => new Request('https://example.test/api/issues', { headers })

async function consume(count: number, req: Request, env: RequestRateLimitEnv) {
  for (let i = 0; i < count; i++) expect(await checkRateLimit(req, env)).toBeUndefined()
}

describe('shared request rate-limit policy', () => {
  it('retains 300 IP and 600 bearer defaults, with no JWT or app auth bindings', async () => {
    const f = fixture()
    await consume(300, request(), f.env)
    expect(await checkRateLimit(request(), f.env)).toEqual({ retryAfter: 55 })
    await consume(600, request({ Authorization: 'Bearer token' }), f.env)
    expect(await checkRateLimit(request({ Authorization: 'Bearer token' }), f.env)).toEqual({ retryAfter: 55 })
    expect(f.idFromName).toHaveBeenCalledWith('ip:127.0.0.1')
    expect(f.idFromName).toHaveBeenCalledWith('tok:3c469e9d6c5875d3')
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM rate_limit').get()).toEqual({ count: 0 })
  })

  it('keeps OAuth grant budgets across rotation, distinct grants and IPs separate, and bearer case exact', async () => {
    const f = fixture()
    f.env.RATE_LIMIT_API_MAX = '1'
    f.env.RATE_LIMIT_AUTH_MAX = '1'
    expect(await checkRateLimit(request({ Authorization: 'Bearer user:grant:first' }), f.env)).toBeUndefined()
    expect(await checkRateLimit(request({ Authorization: 'Bearer user:grant:rotated' }), f.env)).toEqual({
      retryAfter: 55,
    })
    expect(await checkRateLimit(request({ Authorization: 'Bearer user:other:first' }), f.env)).toBeUndefined()
    expect(
      await checkRateLimit(request({ Authorization: 'bearer token', 'CF-Connecting-IP': '1.2.3.4' }), f.env),
    ).toBeUndefined()
    expect(await checkRateLimit(request({ 'CF-Connecting-IP': '1.2.3.4' }), f.env)).toEqual({ retryAfter: 55 })
    expect(await checkRateLimit(request({ 'CF-Connecting-IP': '2.3.4.5' }), f.env)).toBeUndefined()
  })

  it('retains configurable windows, rollover, and the retry fallback for an expired returned slot', async () => {
    const f = fixture()
    f.env.RATE_LIMIT_AUTH_MAX = '1'
    f.env.RATE_LIMIT_WINDOW_SECS = '30'
    await checkRateLimit(request(), f.env)
    expect(await checkRateLimit(request(), f.env)).toEqual({ retryAfter: 25 })
    f.env.RATE_LIMIT_TEST_NOW_MS = '150000'
    expect(await checkRateLimit(request(), f.env)).toBeUndefined()
    f.increment.mockResolvedValueOnce({ count: 2, slot: 0 })
    expect(await checkRateLimit(request(), f.env)).toEqual({ retryAfter: 30 })
  })

  it('ignores test epochs and clocks in production and shares counter naming across adapters', async () => {
    const f = fixture()
    vi.spyOn(Date, 'now').mockReturnValue(185000)
    f.env.RATE_LIMIT_TEST_EPOCH = 'epoch'
    expect(rateLimiterObjectName(f.env, 'ip:test')).toBe('epoch|ip:test')
    f.env.ENVIRONMENT = 'production'
    await checkRateLimit(request(), f.env)
    expect(f.increment).toHaveBeenCalledWith('ip:127.0.0.1', 60, 185)
    expect(await apiBumpRateCounter({ ...f.apiEnv, ENVIRONMENT: 'production' }, 'authfail:ip:test', 60)).toBe(1)
    expect(apiTimeout).toBe(LIMITER_TIMEOUT_MS)
    expect(apiObjectName).toBe(rateLimiterObjectName)
    expect(await bumpRateCounter(f.env, 'authfail:ip:test', 60)).toBe(2)
    expect(f.increment).toHaveBeenCalledWith('authfail:ip:test', 60, 185)
  })

  it('fails open on rejected or stalled DO calls without switching to D1', async () => {
    const f = fixture()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    f.increment.mockRejectedValueOnce(new Error('offline'))
    expect(await checkRateLimit(request(), f.env)).toBeUndefined()
    vi.useFakeTimers()
    f.increment.mockImplementationOnce(() => new Promise(() => {}))
    const pending = checkRateLimit(request(), f.env)
    await vi.advanceTimersByTimeAsync(LIMITER_TIMEOUT_MS)
    expect(await pending).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM rate_limit').get()).toEqual({ count: 0 })
  })

  it('preserves D1 transactional increments, rollover and opportunistic pruning', async () => {
    const f = fixture()
    delete f.env.RATE_LIMITER
    f.env.RATE_LIMIT_AUTH_MAX = '1'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Date, 'now').mockReturnValue(125000)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    f.sqlite.exec("INSERT INTO rate_limit (key,count,window_start) VALUES ('stale',1,-1000)")
    expect(await checkRateLimit(request(), f.env)).toBeUndefined()
    expect(await checkRateLimit(request(), f.env)).toEqual({ retryAfter: 55 })
    expect(f.sqlite.prepare('SELECT * FROM rate_limit').all()).toEqual([
      { key: 'ip:127.0.0.1', count: 2, window_start: 120 },
    ])
    f.env.RATE_LIMIT_TEST_NOW_MS = '180000'
    expect(await checkRateLimit(request(), f.env)).toBeUndefined()
    expect(f.sqlite.prepare('SELECT count FROM rate_limit').get()).toEqual({ count: 1 })
    vi.spyOn(f.db, 'batch').mockRejectedValueOnce(new Error('D1 unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await checkRateLimit(request(), f.env)).toBeUndefined()
  })

  it.each([
    { roll: 0, pruned: true },
    { roll: 0.5, pruned: false },
  ])('PROJ-361: prunes only stale D1 rows when the Core probability roll is $roll', async ({ roll, pruned }) => {
    const f = fixture()
    delete f.env.RATE_LIMITER
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Date, 'now').mockReturnValue(125000)
    vi.spyOn(Math, 'random').mockReturnValue(roll)
    f.sqlite.exec("INSERT INTO rate_limit (key,count,window_start) VALUES ('stale-client',1,-1000)")

    expect(await checkRateLimit(request(), f.env)).toBeUndefined()

    expect(f.sqlite.prepare('SELECT key FROM rate_limit WHERE key = ?').get('stale-client') === undefined).toBe(pruned)
    expect(
      f.sqlite.prepare('SELECT key, count, window_start FROM rate_limit WHERE key = ?').get('ip:127.0.0.1'),
    ).toEqual({
      key: 'ip:127.0.0.1',
      count: 1,
      window_start: 120,
    })
  })

  it('shares the same counter between the API HTTP wrapper and another kernel caller', async () => {
    const f = fixture()
    f.env.RATE_LIMIT_AUTH_MAX = '1'
    f.apiEnv.RATE_LIMIT_AUTH_MAX = '1'
    const app = new Hono<HonoEnv>()
    app.use('*', rateLimitMiddleware)
    app.get('*', (c) => c.json({ ok: true }))
    expect((await app.request(request(), undefined, f.apiEnv)).status).toBe(200)
    expect(await checkRateLimit(request(), f.env)).toEqual({ retryAfter: 55 })
    const denied = await app.request(request(), undefined, f.apiEnv)
    expect(denied.status).toBe(429)
    expect(denied.headers.get('Retry-After')).toBe('55')
    expect(await denied.json()).toEqual({ error: 'Too Many Requests' })
  })

  it('never lets a caller override production budgets, epochs or clocks through Core', async () => {
    const f = fixture()
    f.env.ENVIRONMENT = 'production'
    f.env.RATE_LIMIT_AUTH_MAX = '1'
    vi.spyOn(Date, 'now').mockReturnValue(185000)
    const input = { testPolicy: { authMax: '9999', epoch: 'untrusted', nowMs: '0', windowSecs: '1' } }
    const reply = () => Effect.runPromise(decodeCoreReply(RateLimitResult, f.handlers.apiCheckRateLimit(input)))
    expect(await reply()).toBeNull()
    expect(await reply()).toEqual({ retryAfter: 55 })
    expect(f.increment).toHaveBeenCalledWith('ip:127.0.0.1', 60, 185)
    expect(f.idFromName).not.toHaveBeenCalledWith(expect.stringContaining('untrusted'))
  })

  it('retains the D1 fallback through the API without giving the adapter a DB binding', async () => {
    const f = fixture()
    delete f.env.RATE_LIMITER
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { DB: _db, ...withoutDatabase } = { ...f.apiEnv, DB: f.db }
    expect(withoutDatabase).not.toHaveProperty('DB')
    expect(await apiBumpRateCounter(withoutDatabase, 'authfail:ip:test', 60)).toBe(1)
    expect(await apiBumpRateCounter(withoutDatabase, 'authfail:ip:test', 60)).toBe(2)
    expect(f.sqlite.prepare('SELECT count FROM rate_limit WHERE key = ?').get('authfail:ip:test')).toEqual({ count: 2 })
  })

  it('fails open when the native Core transport fails without exposing its diagnostics', async () => {
    const f = fixture()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = {
      ...f.apiEnv,
      CORE: {
        apiCheckRateLimit: async () => {
          throw new Error('private-driver-detail')
        },
      } as unknown as Fetcher,
    }
    const app = new Hono<HonoEnv>()
    app.use('*', rateLimitMiddleware)
    app.get('*', (c) => c.json({ ok: true }))
    const response = await app.request(request(), undefined, env)
    expect(response.status).toBe(200)
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-driver-detail')
  })

  it('rejects malformed counter requests before touching storage', async () => {
    const f = fixture()
    const result = await Effect.runPromise(
      Effect.flip(
        decodeCoreReply(Schema.Number, f.handlers.apiBumpRateCounter({ key: 'authfail:ip:test', windowSecs: 0 })),
      ),
    )
    expect(result.status).toBe(400)
    expect(f.increment).not.toHaveBeenCalled()
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM rate_limit').get()).toEqual({ count: 0 })
  })
})
