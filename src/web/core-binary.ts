import { Predicate, Effect, Schema } from 'effect'

import { HTTP_BAD_GATEWAY } from '#contracts/http-status.ts'
import { CORE_ACTOR_HEADER } from '#core/contract.ts'

import { RequestServices } from './request.ts'
import { ApiError } from './server/errors.ts'

const BinaryFailure = Schema.Struct({ error: Schema.String })

const decodeBinaryFailure = Schema.decodeUnknownEffect(BinaryFailure)

/**
 * Same-binding binary transport, with request-local proof and no buffering of file bytes.
 *
 * @param {string} path The internal path on Core's binary fetch surface.
 * @param {Readonly<{ method?: string; body?: BodyInit; headers?: HeadersInit }>} options The request method, headers, and optional upload body.
 * @returns {Effect.Effect<Response, ApiError, RequestServices>} An effect with the original successful response or a public failure.
 */
export const transferCoreBinary = function transferCoreBinary(
  path: string,
  options: Readonly<{ method?: string; body?: BodyInit; headers?: HeadersInit }> = {},
): Effect.Effect<Response, ApiError, RequestServices> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    const headers = new Headers(options.headers)
    const accessJwt =
      services.request.headers.get('cf-access-jwt-assertion') ??
      services.request.headers
        .get('cookie')
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('CF_Authorization='))
        ?.slice('CF_Authorization='.length)
    headers.set(
      CORE_ACTOR_HEADER,
      JSON.stringify({
        requestUrl: services.request.url,
        method: services.request.method,
        ...(Predicate.isNotNullish(accessJwt) && Predicate.isNotNullish(accessJwt) ? { accessJwt } : {}),
      }),
    )
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        services.env.CORE.fetch(
          new Request(`https://core.internal${path}`, {
            method: options.method ?? 'GET',
            headers,
            body: options.body,
            signal: AbortSignal.any([services.request.signal, signal]),
          }),
        ),
      catch: () => new ApiError('request', HTTP_BAD_GATEWAY, 'The operation could not be completed.'),
    })
    if (!response.ok) {
      const problem = yield* Effect.tryPromise(() => response.json()).pipe(
        Effect.flatMap(decodeBinaryFailure),
        Effect.catch(() => Effect.succeed({ error: 'The operation could not be completed.' })),
      )
      return yield* new ApiError('request', response.status, problem.error)
    }
    return response
  })
}
