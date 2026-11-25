import { Predicate } from 'effect'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { LIMITER_TIMEOUT_MS, parseRateLimitSetting, rateLimiterObjectName } from '#contracts/request-rate-limit.ts'
import { MILLISECONDS_PER_SECOND, currentEpochMilliseconds, currentEpochSeconds } from '#contracts/time.ts'
import type { Env } from '#types'

export { LIMITER_TIMEOUT_MS, rateLimiterObjectName } from '#contracts/request-rate-limit.ts'

/** Native counter bindings and request policy only, with no application auth secrets. */
export type RequestRateLimitEnv = Pick<
  Env,
  | 'DB'
  | 'RATE_LIMITER'
  | 'ENVIRONMENT'
  | 'RATE_LIMIT_AUTH_MAX'
  | 'RATE_LIMIT_API_MAX'
  | 'RATE_LIMIT_WINDOW_SECS'
  | 'RATE_LIMIT_TEST_EPOCH'
  | 'RATE_LIMIT_TEST_NOW_MS'
>

/*
 * PROJ-658: token rotation must not refresh an OAuth grant's budget. The random
 * grant id, rather than the guessable user id alone, prevents naming another bucket.
 */
const oauthGrantKey = function oauthGrantKey(token: string): string | null {
  const parts = token.split(':')
  if (parts.length !== 3 || !parts[0] || !parts[1]) {
    return null
  }
  return `grant:${parts[0]}:${parts[1]}`
}

const sha256Prefix = async function sha256Prefix(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/*
 * Fixed-window policy shared by API requests and browser commands. Both adapters must
 * supply the same RATE_LIMITER namespace, not a worker-specific counter namespace.
 * Defaults: 300 IP-keyed requests, 600 bearer-keyed requests, per 60-second window.
 */
export const checkRateLimit = async function checkRateLimit(
  request: Request,
  env: RequestRateLimitEnv,
): Promise<{ retryAfter: number } | undefined> {
  const windowSecs = parseRateLimitSetting(env.RATE_LIMIT_WINDOW_SECS ?? '60')
  const testNow =
    env.ENVIRONMENT !== 'production' && isNonEmptyText(env.RATE_LIMIT_TEST_NOW_MS)
      ? Number(env.RATE_LIMIT_TEST_NOW_MS)
      : Number.NaN
  const nowMs = Number.isFinite(testNow) ? testNow : currentEpochMilliseconds()
  const now = Math.floor(nowMs / MILLISECONDS_PER_SECOND)

  const authHeader = request.headers.get('Authorization')
  const bearerPrefix = 'Bearer '
  const token = authHeader?.startsWith(bearerPrefix) === true ? authHeader.slice(bearerPrefix.length) : undefined
  const hasBearer = Predicate.isNotNullish(token)
  const key = hasBearer
    ? `tok:${oauthGrantKey(token) ?? (await sha256Prefix(token))}`
    : `ip:${request.headers.get('CF-Connecting-IP') ?? '127.0.0.1'}`
  const limit = parseRateLimitSetting(
    hasBearer ? (env.RATE_LIMIT_API_MAX ?? '600') : (env.RATE_LIMIT_AUTH_MAX ?? '300'),
  )

  // PROJ-430: a limiter error or stall is an outage, not a client problem.
  let count: number
  let slot: number
  try {
    ;({ count, slot } = await incrementCounter(env, key, windowSecs, now))
  } catch (error) {
    console.error('rate-limit counter unavailable, failing open', { key, err: String(error) })
    return undefined
  }

  if (count > limit) {
    const windowRemaining = slot + windowSecs - now
    return { retryAfter: windowRemaining > 0 ? windowRemaining : windowSecs }
  }
  return undefined
}

/** Auth-failure throttling reuses the same counter backend and window math. */
export const bumpRateCounter = async function bumpRateCounter(
  env: RequestRateLimitEnv,
  key: string,
  windowSecs: number,
): Promise<number> {
  const { count } = await incrementCounter(env, key, windowSecs, currentEpochSeconds())
  return count
}

// PROJ-361: opportunistic pruning of rows several windows older than active ones.
const PRUNE_PROBABILITY = 0.01
const PRUNE_RETENTION_WINDOWS = 10

const pruneStaleRateLimitRows = function pruneStaleRateLimitRows(
  db: D1Database,
  windowSecs: number,
): D1PreparedStatement {
  const cutoff = currentEpochSeconds() - windowSecs * PRUNE_RETENTION_WINDOWS
  return db.prepare('DELETE FROM rate_limit WHERE window_start < ?').bind(cutoff)
}

let warnedD1Fallback = false

const incrementD1Counter = async function incrementD1Counter(
  db: D1Database,
  key: string,
  slot: number,
  windowSecs: number,
): Promise<number> {
  /*
   * PROJ-432: one transactional batch, with a SELECT because local D1 may not
   * reliably return DML RETURNING values. Same slot increments, rollover resets.
   */
  const statements = [
    db
      .prepare(`
    INSERT INTO rate_limit (key, count, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN rate_limit.window_start = ? THEN rate_limit.count + 1 ELSE 1 END,
      window_start = ?
  `)
      .bind(key, slot, slot, slot),
    db.prepare('SELECT count FROM rate_limit WHERE key = ?').bind(key),
  ]

  // Pruning is last and cannot delete the active counter.
  if (Math.random() < PRUNE_PROBABILITY) {
    statements.push(pruneStaleRateLimitRows(db, windowSecs))
  }

  const [, selected] = await db.batch<{ count: number }>(statements)
  return selected.results[0]?.count ?? 1
}

async function incrementCounter(
  env: RequestRateLimitEnv,
  key: string,
  windowSecs: number,
  nowSecs: number,
): Promise<{ count: number; slot: number }> {
  const ns = env.RATE_LIMITER
  if (ns) {
    const stub = ns.get(ns.idFromName(rateLimiterObjectName(env, key)))
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('rate limiter timed out'))
      }, LIMITER_TIMEOUT_MS)
    })
    try {
      return await Promise.race([stub.increment(windowSecs, nowSecs), timeout])
    } finally {
      clearTimeout(timer)
    }
  }
  if (!warnedD1Fallback) {
    warnedD1Fallback = true
    console.warn(
      'RATE_LIMITER Durable Object binding missing: using the deprecated D1 rate limiter. ' +
        'Declare the existing RateLimiter binding in the Alchemy Worker; the D1 fallback will be removed.',
    )
  }
  const slot = Math.floor(nowSecs / windowSecs) * windowSecs
  return { count: await incrementD1Counter(env.DB, key, slot, windowSecs), slot }
}
