import { Effect, Schema } from 'effect'
import type { Context, Next } from 'hono'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'

import { RateLimitResult, rateLimitTestPolicy } from '#contracts/request-rate-limit.ts'
import type { ApiEnv, HonoEnv } from '#types'

export { LIMITER_TIMEOUT_MS, rateLimiterObjectName } from '#contracts/request-rate-limit.ts'

/** Auth failures share the same Core-owned counter backend as normal requests. */
export function bumpRateCounter(env: ApiEnv, key: string, windowSecs: number): Promise<number> {
  return Effect.runPromise(
    decodeCoreReply(
      Schema.Number,
      makeCoreClient(env.CORE).apiBumpRateCounter({
        key,
        windowSecs,
        testPolicy: rateLimitTestPolicy(env),
      }),
    ),
  )
}

/** HTTP response shaping stays at the API boundary, policy and storage do not. */
export async function rateLimitMiddleware(httpContext: Context<HonoEnv>, next: Next): Promise<Response | undefined> {
  let limited: typeof RateLimitResult.Type = null
  try {
    limited = await Effect.runPromise(
      decodeCoreReply(
        RateLimitResult,
        makeCoreClient(httpContext.env.CORE).apiCheckRateLimit({
          authorization: httpContext.req.header('Authorization'),
          ip: httpContext.req.header('CF-Connecting-IP'),
          testPolicy: rateLimitTestPolicy(httpContext.env),
        }),
      ),
    )
  } catch {
    // Preserve fail-open outage policy without logging credentials or remote diagnostics.
    console.error('Core rate-limit service unavailable, failing open')
  }
  if (limited) {
    httpContext.header('Retry-After', String(limited.retryAfter))
    return httpContext.json({ error: 'Too Many Requests' }, 429)
  }
  await next()
  return undefined
}
