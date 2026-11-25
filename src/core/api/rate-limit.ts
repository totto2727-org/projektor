import { Predicate, Effect, Schema } from 'effect'

import { HTTP_BAD_REQUEST } from '#contracts/http-status.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { RateCounterRequest, RateLimitRequest, RateLimitResult } from '#contracts/request-rate-limit.ts'
import type { RateLimitTestPolicy } from '#contracts/request-rate-limit.ts'
import type { CoreReply } from '#core/contract.ts'
import { coreFailure, coreReply } from '#core/contract.ts'
import { publicDomainFailure } from '#core/domain-errors.ts'
import { bumpRateCounter, checkRateLimit } from '#services/request-rate-limit.ts'
import type { RequestRateLimitEnv } from '#services/request-rate-limit.ts'

const decodeRateLimitRequest = Schema.decodeUnknownEffect(RateLimitRequest)
const decodeRateCounterRequest = Schema.decodeUnknownEffect(RateCounterRequest)

const policyEnvironment = function policyEnvironment(
  env: RequestRateLimitEnv,
  policy: typeof RateLimitTestPolicy.Type | undefined,
): RequestRateLimitEnv {
  if (env.ENVIRONMENT === 'production' || !policy) {
    return env
  }
  return {
    ...env,
    ...fieldsInOrder([
      ['RATE_LIMIT_TEST_EPOCH', policy.epoch ?? env.RATE_LIMIT_TEST_EPOCH],
      ['RATE_LIMIT_TEST_NOW_MS', policy.nowMs ?? env.RATE_LIMIT_TEST_NOW_MS],
      ['RATE_LIMIT_AUTH_MAX', policy.authMax ?? env.RATE_LIMIT_AUTH_MAX],
      ['RATE_LIMIT_API_MAX', policy.apiMax ?? env.RATE_LIMIT_API_MAX],
      ['RATE_LIMIT_WINDOW_SECS', policy.windowSecs ?? env.RATE_LIMIT_WINDOW_SECS],
    ]),
  }
}

/** All request counter storage and budget decisions execute only in Core. */
export const makeApiRateLimitHandlers = function makeApiRateLimitHandlers<R>(
  envSource: Effect.Effect<RequestRateLimitEnv, never, R>,
) {
  return {
    apiCheckRateLimit: (input: typeof RateLimitRequest.Type): CoreReply<R> =>
      coreReply(
        'apiCheckRateLimit',
        RateLimitResult,
        Effect.gen(function* () {
          const proof = yield* decodeRateLimitRequest(input).pipe(
            Effect.mapError(() => coreFailure(HTTP_BAD_REQUEST, 'Invalid rate limit request.')),
          )
          const env = policyEnvironment(yield* envSource, proof.testPolicy)
          return yield* Effect.tryPromise({
            try: async () => {
              const headers = new Headers()
              if (Predicate.isNotNullish(proof.authorization)) {
                headers.set('Authorization', proof.authorization)
              }
              if (Predicate.isNotNullish(proof.ip)) {
                headers.set('CF-Connecting-IP', proof.ip)
              }
              return (await checkRateLimit(new Request('https://core.internal/rate-limit', { headers }), env)) ?? null
            },
            catch: publicDomainFailure,
          })
        }),
      ),
    apiBumpRateCounter: (input: typeof RateCounterRequest.Type): CoreReply<R> =>
      coreReply(
        'apiBumpRateCounter',
        Schema.Number,
        Effect.gen(function* () {
          const proof = yield* decodeRateCounterRequest(input).pipe(
            Effect.mapError(() => coreFailure(HTTP_BAD_REQUEST, 'Invalid rate counter request.')),
          )
          const env = policyEnvironment(yield* envSource, proof.testPolicy)
          return yield* Effect.tryPromise({
            catch: publicDomainFailure,
            try: () => bumpRateCounter(env, proof.key, proof.windowSecs),
          })
        }),
      ),
  }
}
