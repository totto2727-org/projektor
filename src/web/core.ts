import { Effect, Schema } from 'effect'
import { decodeCoreReply } from 'projektor/core-client'

import type { WebRequest } from '../core/web/scope'
import { ApiError, ScopeError } from './server/errors'

export function browserRequest(request: Request): WebRequest {
  return { url: request.url, method: request.method, headers: [...request.headers] }
}

export function coreResult<S extends Schema.Top, E, R>(schema: S, invocation: Effect.Effect<string, E, R>) {
  return decodeCoreReply(schema, invocation).pipe(
    Effect.mapError((error) =>
      error.status === 400 || error.status === 403 || error.status === 404
        ? new ScopeError(error.status, error.message)
        : new ApiError('request', error.status, error.message, undefined, error.details),
    ),
  )
}
