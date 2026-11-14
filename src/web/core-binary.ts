import { Effect, Schema } from 'effect'

import { CORE_ACTOR_HEADER } from '../core/contract'
import { RequestServices } from './request'
import { ApiError } from './server/errors'

const BinaryFailure = Schema.Struct({ error: Schema.String })

/** Same-binding binary transport, with request-local proof and no buffering of file bytes. */
export function transferCoreBinary(
  path: string,
  options: { readonly method?: string; readonly body?: BodyInit; readonly headers?: HeadersInit } = {},
) {
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
        ...(accessJwt !== undefined && accessJwt !== null ? { accessJwt } : {}),
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
      catch: () => new ApiError('request', 502, 'The operation could not be completed.'),
    })
    if (!response.ok) {
      const problem = yield* Effect.tryPromise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(BinaryFailure)),
        Effect.catch(() => Effect.succeed({ error: 'The operation could not be completed.' })),
      )
      return yield* new ApiError('request', response.status, problem.error)
    }
    return response
  })
}
