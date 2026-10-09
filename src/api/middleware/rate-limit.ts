import type { Context, Next } from 'hono'

import { checkRateLimit } from '#services/request-rate-limit'
import type { HonoEnv } from '#types'

// Preserve the API helper contract for auth throttling and native pool tests.
export { bumpRateCounter, LIMITER_TIMEOUT_MS, rateLimiterObjectName } from '#services/request-rate-limit'

/** HTTP response shaping stays at the API boundary. */
export async function rateLimitMiddleware(c: Context<HonoEnv>, next: Next): Promise<Response | undefined> {
  const limited = await checkRateLimit(c.req.raw, c.env)
  if (limited) {
    c.header('Retry-After', String(limited.retryAfter))
    return c.json({ error: 'Too Many Requests' }, 429)
  }
  await next()
}
