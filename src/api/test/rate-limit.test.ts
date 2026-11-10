import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { bumpRateCounter } from '#services/request-rate-limit'
import type { Env } from '#types'

import { LIMITER_TIMEOUT_MS } from '../middleware/rate-limit'
import { configureCore, env, getCoreLimiterCalls } from './fixture-api'
import { authHeaders, seedFixture } from './helpers'
import { seedRateLimitCounter } from './rate-limit-reset'

// Must match vite.config.ts values.
const AUTH_LIMIT = 3
const API_LIMIT = 5
const WINDOW_SECS = 60 // RATE_LIMIT_WINDOW_SECS in vite.config.ts

// SHA-256 prefix — mirrors the middleware so we can pre-seed the correct key.
async function sha256Prefix(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Put a key at `count` hits in the current window (RateLimiter Durable Object).
async function seedCounter(key: string, count: number): Promise<void> {
  await seedRateLimitCounter(key, count, WINDOW_SECS)
}

// ── Deprecated D1 fallback (no RATE_LIMITER binding; removed in PROJ-924) ──
function currentSlot(): number {
  return Math.floor(Date.now() / 1000 / WINDOW_SECS) * WINDOW_SECS
}

async function seedD1Counter(key: string, count: number): Promise<void> {
  await env.DB.prepare('INSERT OR REPLACE INTO rate_limit (key, count, window_start) VALUES (?, ?, ?)')
    .bind(key, count, currentSlot())
    .run()
}

// Run the worker without the Durable Object binding, as a deploy that hasn't added it yet.
function withoutLimiterBinding() {
  let saved: Env['RATE_LIMITER']
  beforeEach(async () => {
    saved = env.RATE_LIMITER
    env.RATE_LIMITER = undefined
    await configureCore()
  })
  afterEach(async () => {
    env.RATE_LIMITER = saved
    await configureCore()
  })
}

describe('PROJ-19: rate limiting', () => {
  const ENDPOINT = 'http://localhost/api/workspaces'

  describe('IP-keyed (no bearer token)', () => {
    it('allows a request within the limit', async () => {
      // No CF-Connecting-IP → middleware falls back to '127.0.0.1'
      const res = await SELF.fetch(ENDPOINT)
      // 401 from auth is the expected non-rate-limited response
      expect(res.status).not.toBe(429)
    })

    it('returns 429 with Retry-After when the IP limit is exceeded', async () => {
      // Seed against the fallback IP used when CF-Connecting-IP is absent in tests
      await seedCounter('ip:127.0.0.1', AUTH_LIMIT)

      const res = await SELF.fetch(ENDPOINT) // no CF-Connecting-IP → key = ip:127.0.0.1
      expect(res.status).toBe(429)
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10)
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(WINDOW_SECS)
    })

    it('IP-keyed and token-keyed buckets are independent', async () => {
      // Exhaust the IP bucket; authenticated requests must not be affected
      await seedCounter('ip:127.0.0.1', AUTH_LIMIT)

      const fixture = await seedFixture()
      const res = await SELF.fetch(ENDPOINT, {
        headers: authHeaders(fixture.token, fixture.workspace.slug),
      })
      // Token-keyed bucket is separate → should not be 429
      expect(res.status).not.toBe(429)
    })
  })

  describe('token-keyed (bearer token present)', () => {
    it('allows a request within the limit', async () => {
      const fixture = await seedFixture()
      const res = await SELF.fetch(ENDPOINT, {
        headers: authHeaders(fixture.token, fixture.workspace.slug),
      })
      expect(res.status).not.toBe(429)
    })

    it('returns 429 with Retry-After when the token limit is exceeded', async () => {
      const fixture = await seedFixture()
      const fingerprint = await sha256Prefix(fixture.token)
      await seedCounter(`tok:${fingerprint}`, API_LIMIT)

      const res = await SELF.fetch(ENDPOINT, {
        headers: authHeaders(fixture.token, fixture.workspace.slug),
      })
      expect(res.status).toBe(429)
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10)
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(WINDOW_SECS)
    })

    it('does not share buckets between different tokens', async () => {
      const fixtureA = await seedFixture()
      const fixtureB = await seedFixture()

      // Exhaust fixtureA's token bucket; fixtureB's should be unaffected
      const fingerprintA = await sha256Prefix(fixtureA.token)
      await seedCounter(`tok:${fingerprintA}`, API_LIMIT)

      const res = await SELF.fetch(ENDPOINT, {
        headers: authHeaders(fixtureB.token, fixtureB.workspace.slug),
      })
      expect(res.status).not.toBe(429)
    })
  })
})

describe('PROJ-198: failed bearer-auth throttle (IP-keyed)', () => {
  const ENDPOINT = 'http://localhost/api/workspaces'
  const AUTH_FAIL_LIMIT = 3 // RATE_LIMIT_AUTH_FAIL_MAX in vite.config.ts

  it('returns 401 for an invalid bearer token while under the failure limit', async () => {
    const res = await SELF.fetch(ENDPOINT, {
      headers: { Authorization: 'Bearer pk_not_a_real_token' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 429 once invalid bearer auths from one IP exceed the limit', async () => {
    // Pre-seed the IP's failure counter at the limit; the next invalid-token attempt trips it.
    // Without CF-Connecting-IP the middleware keys by the 127.0.0.1 fallback.
    await seedCounter('authfail:127.0.0.1', AUTH_FAIL_LIMIT)

    const res = await SELF.fetch(ENDPOINT, {
      headers: { Authorization: 'Bearer pk_still_not_a_real_token' },
    })
    expect(res.status).toBe(429)
  })

  it("does not throttle a valid token even when the IP's failure counter is high", async () => {
    // A successful auth never touches the authfail counter, so legit clients sharing an IP
    // with an attacker are unaffected.
    await seedCounter('authfail:127.0.0.1', AUTH_FAIL_LIMIT + 5)
    const fixture = await seedFixture()

    const res = await SELF.fetch(ENDPOINT, {
      headers: authHeaders(fixture.token, fixture.workspace.slug),
    })
    expect(res.status).not.toBe(429)
    expect(res.status).not.toBe(401)
  })
})

// PROJ-432: the limiter runs on every request, and its upsert + read-back used to be two
// sequential awaits. They're one D1 batch now — same statements, same order, one round trip.
describe('PROJ-432: the D1 fallback counter costs one round trip', () => {
  const d1Only = (db: D1Database): Env => ({ ...env, DB: db, RATE_LIMITER: undefined })
  function countingDb(db: D1Database) {
    const counts = { prepare: 0, batch: 0 }
    const proxy = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'prepare') counts.prepare++
        if (prop === 'batch') counts.batch++
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    return { counts, proxy }
  }

  it('issues a single batch rather than sequential statements', async () => {
    const { counts, proxy } = countingDb(env.DB)
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5) // no prune
    try {
      await bumpRateCounter(d1Only(proxy), `ip:batch-${crypto.randomUUID().slice(0, 8)}`, WINDOW_SECS)
    } finally {
      randomSpy.mockRestore()
    }

    expect(counts.batch).toBe(1)
  })

  it('still counts correctly through the batch', async () => {
    const key = `ip:batch-count-${crypto.randomUUID().slice(0, 8)}`
    expect(await bumpRateCounter(d1Only(env.DB), key, WINDOW_SECS)).toBe(1)
    expect(await bumpRateCounter(d1Only(env.DB), key, WINDOW_SECS)).toBe(2)
    expect(await bumpRateCounter(d1Only(env.DB), key, WINDOW_SECS)).toBe(3)
  })
})

describe('PROJ-867: counters live in the RateLimiter Durable Object, not D1', () => {
  const ENDPOINT = 'http://localhost/api/workspaces'

  async function rateLimitRows(): Promise<number> {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM rate_limit').first<{ n: number }>()
    return row?.n ?? 0
  }

  it('GET requests write nothing to D1', async () => {
    const fixture = await seedFixture()
    for (let i = 0; i < 3; i++) {
      const res = await SELF.fetch(ENDPOINT, {
        headers: authHeaders(fixture.token, fixture.workspace.slug),
      })
      expect(res.status).toBe(200)
    }
    await SELF.fetch(ENDPOINT) // IP-keyed, unauthenticated
    expect(await rateLimitRows()).toBe(0)
  })

  it('still enforces the token limit (API max 5) from the Durable Object counter', async () => {
    const fixture = await seedFixture()
    const statuses: number[] = []
    for (let i = 0; i < API_LIMIT + 1; i++) {
      const res = await SELF.fetch(ENDPOINT, {
        headers: authHeaders(fixture.token, fixture.workspace.slug),
      })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, API_LIMIT).every((s) => s === 200)).toBe(true)
    expect(statuses[API_LIMIT]).toBe(429)
    expect(await rateLimitRows()).toBe(0)
  })

  it('Retry-After is the seconds left in the fixed window, as before', async () => {
    const slotStartMs = currentSlot() * 1000
    env.RATE_LIMIT_TEST_NOW_MS = String(slotStartMs + 20_000) // 20s into the window
    await configureCore()
    try {
      const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
      let res: Response | undefined
      for (let i = 0; i < AUTH_LIMIT + 1; i++) {
        res = await SELF.fetch(ENDPOINT, { headers: { 'CF-Connecting-IP': ip } })
      }
      expect(res?.status).toBe(429)
      expect(res?.headers.get('Retry-After')).toBe(String(WINDOW_SECS - 20))
      expect(await res?.json()).toEqual({ error: 'Too Many Requests' })
    } finally {
      env.RATE_LIMIT_TEST_NOW_MS = undefined
      await configureCore()
    }
  })

  describe('fails open when the limiter is unavailable', () => {
    afterEach(async () => {
      await configureCore()
    })

    it('allows the request when the Durable Object call throws', async () => {
      await configureCore({ FIXTURE_LIMITER_MODE: 'reject' })
      const fixture = await seedFixture()
      const res = await SELF.fetch(ENDPOINT, {
        headers: authHeaders(fixture.token, fixture.workspace.slug),
      })
      expect(await getCoreLimiterCalls()).toBeGreaterThan(0)
      expect(res.status).toBe(200)
    })

    it('an invalid token still gets 401, not 500, from the auth-failure throttle', async () => {
      await configureCore({ FIXTURE_LIMITER_MODE: 'reject' })
      const res = await SELF.fetch(ENDPOINT, {
        headers: { Authorization: 'Bearer pk_not_a_real_token' },
      })
      expect(await getCoreLimiterCalls()).toBeGreaterThanOrEqual(2)
      expect(res.status).toBe(401)
    })

    it("allows the request when the Durable Object doesn't answer in time", async () => {
      await configureCore({ FIXTURE_LIMITER_MODE: 'hang' })
      const fixture = await seedFixture()
      const started = Date.now()
      const res = await SELF.fetch(ENDPOINT, {
        headers: authHeaders(fixture.token, fixture.workspace.slug),
      })
      expect(await getCoreLimiterCalls()).toBeGreaterThan(0)
      expect(res.status).toBe(200)
      expect(Date.now() - started).toBeLessThan(LIMITER_TIMEOUT_MS + 5_000)
    })
  })

  describe('without the binding (deploys not yet updated)', () => {
    withoutLimiterBinding()

    it('falls back to the D1 counter and still enforces the limit', async () => {
      await seedD1Counter('ip:127.0.0.1', AUTH_LIMIT)
      const res = await SELF.fetch(ENDPOINT)
      expect(res.status).toBe(429)
    })
  })
})
