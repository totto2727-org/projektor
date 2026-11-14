import { Schema } from 'effect'

export const RateLimitTestPolicy = Schema.Struct({
  epoch: Schema.optional(Schema.String),
  nowMs: Schema.optional(Schema.String),
  authMax: Schema.optional(Schema.String),
  apiMax: Schema.optional(Schema.String),
  windowSecs: Schema.optional(Schema.String),
})
export const RateLimitRequest = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  ip: Schema.optional(Schema.String),
  testPolicy: Schema.optional(RateLimitTestPolicy),
})
export const RateLimitResult = Schema.NullOr(Schema.Struct({ retryAfter: Schema.Number }))
export const RateCounterRequest = Schema.Struct({
  key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  windowSecs: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 86400 })),
  testPolicy: Schema.optional(RateLimitTestPolicy),
})

export const LIMITER_TIMEOUT_MS = 500

/** Test names are shared with the native counter fixture, never enabled in production. */
export function rateLimiterObjectName(
  env: { ENVIRONMENT?: string; RATE_LIMIT_TEST_EPOCH?: string },
  key: string,
): string {
  const epoch = env.ENVIRONMENT !== 'production' ? env.RATE_LIMIT_TEST_EPOCH : undefined
  return epoch ? `${epoch}|${key}` : key
}

export function rateLimitTestPolicy(env: {
  ENVIRONMENT?: string
  RATE_LIMIT_TEST_EPOCH?: string
  RATE_LIMIT_TEST_NOW_MS?: string
  RATE_LIMIT_AUTH_MAX?: string
  RATE_LIMIT_API_MAX?: string
  RATE_LIMIT_WINDOW_SECS?: string
}): typeof RateLimitTestPolicy.Type | undefined {
  if (env.ENVIRONMENT === 'production') return undefined
  return {
    epoch: env.RATE_LIMIT_TEST_EPOCH,
    nowMs: env.RATE_LIMIT_TEST_NOW_MS,
    authMax: env.RATE_LIMIT_AUTH_MAX,
    apiMax: env.RATE_LIMIT_API_MAX,
    windowSecs: env.RATE_LIMIT_WINDOW_SECS,
  }
}
