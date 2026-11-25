import { Iterable, Predicate, Effect, Schema } from 'effect'
import { Hono } from 'hono'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import {
  bumpRateCounter as apiBumpRateCounter,
  LIMITER_TIMEOUT_MS as apiTimeout,
  rateLimiterObjectName as apiObjectName,
  rateLimitMiddleware,
} from '#api/middleware/rate-limit.ts'
import { RateLimitRequest, RateCounterRequest, RateLimitResult } from '#contracts/request-rate-limit.ts'
import { makeApiRateLimitHandlers } from '#core/api/rate-limit.ts'
import { decodeCoreReply } from '#core/client.ts'
import {
  bumpRateCounter,
  checkRateLimit,
  LIMITER_TIMEOUT_MS,
  rateLimiterObjectName,
} from '#services/request-rate-limit.ts'
import type { RequestRateLimitEnv } from '#services/request-rate-limit.ts'
import { runTestEffect } from '#tests/run-effect.ts'
import type { ApiEnv, HonoEnv } from '#types'
import { createTestDatabase } from '@/test/database.ts'

const databases: ReturnType<typeof createTestDatabase>[] = []

const fixture = function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  const counters = new Map<string, { count: number; slot: number }>()
  const increment = vi.fn<
    (key: string, windowSecs: number, nowSecs: number) => Promise<{ count: number; slot: number }>
  >(async (key: string, windowSecs: number, nowSecs: number) => {
    const slot = Math.floor(nowSecs / windowSecs) * windowSecs
    const previous = counters.get(key)
    const counter = { count: previous?.slot === slot ? previous.count + 1 : 1, slot }
    counters.set(key, counter)
    return counter
  })
  // Bounded native namespace double, exposing only the RPC used by the kernel.
  const idFromName = vi.fn<(key: string) => string>((key: string) => key)
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
    fetch: async () => new Response(undefined, { status: 404 }),
    apiCheckRateLimit: (input: typeof RateLimitRequest.Type) => runTestEffect(handlers.apiCheckRateLimit(input)),
    apiBumpRateCounter: (input: typeof RateCounterRequest.Type) => runTestEffect(handlers.apiBumpRateCounter(input)),
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
const request = (headers: HeadersInit = {}): Request<unknown, CfProperties> =>
  new Request('https://example.test/api/issues', { headers })

const consume = async function consume(count: number, req: Request, env: RequestRateLimitEnv): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await expect(checkRateLimit(req, env)).resolves.toBeUndefined()
  }
}

describe('shared request rate-limit policy', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Iterable.forEach(databases.splice(0), (database) => {
      database.close()
    })
  })

  test('retains 300 IP and 600 bearer defaults, with no JWT or app auth bindings', async () => {
    const testFixture = fixture()
    await consume(300, request(), testFixture.env)
    await expect(checkRateLimit(request(), testFixture.env)).resolves.toStrictEqual({ retryAfter: 55 })
    await consume(600, request({ Authorization: 'Bearer token' }), testFixture.env)
    await expect(checkRateLimit(request({ Authorization: 'Bearer token' }), testFixture.env)).resolves.toStrictEqual({
      retryAfter: 55,
    })
    expect(testFixture.idFromName).toHaveBeenCalledWith('ip:127.0.0.1')
    expect(testFixture.idFromName).toHaveBeenCalledWith('tok:3c469e9d6c5875d3')
    expect(testFixture.sqlite.prepare('SELECT COUNT(*) AS count FROM rate_limit').get()).toEqual({ count: 0 })
  })

  test('keeps OAuth grant budgets across rotation, distinct grants and IPs separate, and bearer case exact', async () => {
    const testFixture = fixture()
    testFixture.env.RATE_LIMIT_API_MAX = '1'
    testFixture.env.RATE_LIMIT_AUTH_MAX = '1'
    await expect(
      checkRateLimit(request({ Authorization: 'Bearer user:grant:first' }), testFixture.env),
    ).resolves.toBeUndefined()
    await expect(
      checkRateLimit(request({ Authorization: 'Bearer user:grant:rotated' }), testFixture.env),
    ).resolves.toStrictEqual({
      retryAfter: 55,
    })
    await expect(
      checkRateLimit(request({ Authorization: 'Bearer user:other:first' }), testFixture.env),
    ).resolves.toBeUndefined()
    await expect(
      checkRateLimit(request({ Authorization: 'bearer token', 'CF-Connecting-IP': '1.2.3.4' }), testFixture.env),
    ).resolves.toBeUndefined()
    await expect(checkRateLimit(request({ 'CF-Connecting-IP': '1.2.3.4' }), testFixture.env)).resolves.toStrictEqual({
      retryAfter: 55,
    })
    await expect(checkRateLimit(request({ 'CF-Connecting-IP': '2.3.4.5' }), testFixture.env)).resolves.toBeUndefined()
  })

  test('retains configurable windows, rollover, and the retry fallback for an expired returned slot', async () => {
    const testFixture = fixture()
    testFixture.env.RATE_LIMIT_AUTH_MAX = '1'
    testFixture.env.RATE_LIMIT_WINDOW_SECS = '30'
    await checkRateLimit(request(), testFixture.env)
    await expect(checkRateLimit(request(), testFixture.env)).resolves.toStrictEqual({ retryAfter: 25 })
    testFixture.env.RATE_LIMIT_TEST_NOW_MS = '150000'
    await expect(checkRateLimit(request(), testFixture.env)).resolves.toBeUndefined()
    testFixture.increment.mockResolvedValueOnce({ count: 2, slot: 0 })
    await expect(checkRateLimit(request(), testFixture.env)).resolves.toStrictEqual({ retryAfter: 30 })
  })

  test('ignores test epochs and clocks in production and shares counter naming across adapters', async () => {
    const testFixture = fixture()
    vi.spyOn(Date, 'now').mockReturnValue(185_000)
    testFixture.env.RATE_LIMIT_TEST_EPOCH = 'epoch'
    expect(rateLimiterObjectName(testFixture.env, 'ip:test')).toBe('epoch|ip:test')
    testFixture.env.ENVIRONMENT = 'production'
    await checkRateLimit(request(), testFixture.env)
    expect(testFixture.increment).toHaveBeenCalledWith('ip:127.0.0.1', 60, 185)
    await expect(
      apiBumpRateCounter({ ...testFixture.apiEnv, ENVIRONMENT: 'production' }, 'authfail:ip:test', 60),
    ).resolves.toBe(1)
    expect(apiTimeout).toBe(LIMITER_TIMEOUT_MS)
    expect(apiObjectName).toBe(rateLimiterObjectName)
    await expect(bumpRateCounter(testFixture.env, 'authfail:ip:test', 60)).resolves.toBe(2)
    expect(testFixture.increment).toHaveBeenCalledWith('authfail:ip:test', 60, 185)
  })

  test('fails open on rejected or stalled DO calls without switching to D1', async () => {
    const testFixture = fixture()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    testFixture.increment.mockRejectedValueOnce(new Error('offline'))
    await expect(checkRateLimit(request(), testFixture.env)).resolves.toBeUndefined()
    vi.useFakeTimers()
    testFixture.increment.mockImplementationOnce(() => new Promise(() => {}))
    const pending = checkRateLimit(request(), testFixture.env)
    await vi.advanceTimersByTimeAsync(LIMITER_TIMEOUT_MS)
    await expect(pending).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    expect(testFixture.sqlite.prepare('SELECT COUNT(*) AS count FROM rate_limit').get()).toEqual({ count: 0 })
  })

  test('preserves D1 transactional increments, rollover and opportunistic pruning', async () => {
    const testFixture = fixture()
    delete testFixture.env.RATE_LIMITER
    testFixture.env.RATE_LIMIT_AUTH_MAX = '1'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Date, 'now').mockReturnValue(125_000)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    testFixture.sqlite.exec("INSERT INTO rate_limit (key,count,window_start) VALUES ('stale',1,-1000)")
    await expect(checkRateLimit(request(), testFixture.env)).resolves.toBeUndefined()
    await expect(checkRateLimit(request(), testFixture.env)).resolves.toStrictEqual({ retryAfter: 55 })
    expect(testFixture.sqlite.prepare('SELECT * FROM rate_limit').all()).toEqual([
      { count: 2, key: 'ip:127.0.0.1', window_start: 120 },
    ])
    testFixture.env.RATE_LIMIT_TEST_NOW_MS = '180000'
    await expect(checkRateLimit(request(), testFixture.env)).resolves.toBeUndefined()
    expect(testFixture.sqlite.prepare('SELECT count FROM rate_limit').get()).toEqual({ count: 1 })
    vi.spyOn(testFixture.db, 'batch').mockRejectedValueOnce(new Error('D1 unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(checkRateLimit(request(), testFixture.env)).resolves.toBeUndefined()
  })

  test.each([
    { roll: 0, pruned: true },
    { roll: 0.5, pruned: false },
  ])('covers PROJ-361: prunes only stale D1 rows when the Core probability roll is $roll', async ({ roll, pruned }) => {
    const testFixture = fixture()
    delete testFixture.env.RATE_LIMITER
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Date, 'now').mockReturnValue(125_000)
    vi.spyOn(Math, 'random').mockReturnValue(roll)
    testFixture.sqlite.exec("INSERT INTO rate_limit (key,count,window_start) VALUES ('stale-client',1,-1000)")

    await expect(checkRateLimit(request(), testFixture.env)).resolves.toBeUndefined()

    expect(
      Predicate.isNullish(testFixture.sqlite.prepare('SELECT key FROM rate_limit WHERE key = ?').get('stale-client')),
    ).toBe(pruned)
    expect(
      testFixture.sqlite.prepare('SELECT key, count, window_start FROM rate_limit WHERE key = ?').get('ip:127.0.0.1'),
    ).toEqual({
      count: 1,
      key: 'ip:127.0.0.1',
      window_start: 120,
    })
  })

  test('shares the same counter between the API HTTP wrapper and another kernel caller', async () => {
    const testFixture = fixture()
    testFixture.env.RATE_LIMIT_AUTH_MAX = '1'
    testFixture.apiEnv.RATE_LIMIT_AUTH_MAX = '1'
    const app = new Hono<HonoEnv>()
    app.use('*', rateLimitMiddleware)
    app.get('*', (httpContext) => httpContext.json({ ok: true }))
    const result = await app.request(request(), undefined, testFixture.apiEnv)
    expect(result.status).toBe(200)
    await expect(checkRateLimit(request(), testFixture.env)).resolves.toStrictEqual({ retryAfter: 55 })
    const denied = await app.request(request(), undefined, testFixture.apiEnv)
    expect(denied.status).toBe(429)
    expect(denied.headers.get('Retry-After')).toBe('55')
    await expect(denied.json()).resolves.toStrictEqual({ error: 'Too Many Requests' })
  })

  test('never lets a caller override production budgets, epochs or clocks through Core', async () => {
    const testFixture = fixture()
    testFixture.env.ENVIRONMENT = 'production'
    testFixture.env.RATE_LIMIT_AUTH_MAX = '1'
    vi.spyOn(Date, 'now').mockReturnValue(185_000)
    const input = { testPolicy: { authMax: '9999', epoch: 'untrusted', nowMs: '0', windowSecs: '1' } }
    const reply = () => runTestEffect(decodeCoreReply(RateLimitResult, testFixture.handlers.apiCheckRateLimit(input)))
    await expect(reply()).resolves.toBeNull()
    await expect(reply()).resolves.toStrictEqual({ retryAfter: 55 })
    expect(testFixture.increment).toHaveBeenCalledWith('ip:127.0.0.1', 60, 185)
    expect(testFixture.idFromName).not.toHaveBeenCalledWith(expect.stringContaining('untrusted'))
  })

  test('retains the D1 fallback through the API without giving the adapter a DB binding', async () => {
    const testFixture = fixture()
    delete testFixture.env.RATE_LIMITER
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { DB: _db, ...withoutDatabase } = { ...testFixture.apiEnv, DB: testFixture.db }
    expect(withoutDatabase).not.toHaveProperty('DB')
    await expect(apiBumpRateCounter(withoutDatabase, 'authfail:ip:test', 60)).resolves.toBe(1)
    await expect(apiBumpRateCounter(withoutDatabase, 'authfail:ip:test', 60)).resolves.toBe(2)
    expect(testFixture.sqlite.prepare('SELECT count FROM rate_limit WHERE key = ?').get('authfail:ip:test')).toEqual({
      count: 2,
    })
  })

  test('fails open when the native Core transport fails without exposing its diagnostics', async () => {
    const testFixture = fixture()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = {
      ...testFixture.apiEnv,
      CORE: {
        apiCheckRateLimit: async () => {
          throw new Error('private-driver-detail')
        },
      } as unknown as Fetcher,
    }
    const app = new Hono<HonoEnv>()
    app.use('*', rateLimitMiddleware)
    app.get('*', (httpContext) => httpContext.json({ ok: true }))
    const response = await app.request(request(), undefined, env)
    expect(response.status).toBe(200)
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-driver-detail')
  })

  test('rejects malformed counter requests before touching storage', async () => {
    const testFixture = fixture()
    const result = await runTestEffect(
      Effect.flip(
        decodeCoreReply(
          Schema.Number,
          testFixture.handlers.apiBumpRateCounter({ key: 'authfail:ip:test', windowSecs: 0 }),
        ),
      ),
    )
    expect(result.status).toBe(400)
    expect(testFixture.increment).not.toHaveBeenCalled()
    expect(testFixture.sqlite.prepare('SELECT COUNT(*) AS count FROM rate_limit').get()).toEqual({ count: 0 })
  })
})
