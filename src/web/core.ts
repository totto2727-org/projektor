import { Effect } from 'effect'
import type { Schema } from 'effect'
import { decodeCoreReply } from 'projektor/core-client'

import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_NOT_FOUND } from '#contracts/http-status.ts'
import type { WebRequest } from '#core/web/scope.ts'

import { ApiError, ScopeError } from './server/errors.ts'

export const browserRequest = function browserRequest(request: Request): WebRequest {
  return { url: request.url, method: request.method, headers: [...request.headers] }
}

export type CoreResult<A, R = never> = Effect.Effect<A, ApiError | ScopeError, R>

export const coreResult = function coreResult<S extends Schema.Top, E, R>(
  schema: S,
  invocation: Effect.Effect<string, E, R>,
): CoreResult<S['Type'], R | S['DecodingServices']> {
  return decodeCoreReply(schema, invocation).pipe(
    Effect.mapError((error) =>
      error.status === HTTP_BAD_REQUEST || error.status === HTTP_FORBIDDEN || error.status === HTTP_NOT_FOUND
        ? new ScopeError(error.status, error.message)
        : new ApiError('request', error.status, error.message, undefined, error.details),
    ),
  )
}
