import { Effect } from 'effect'

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '#commands/errors'
import type { ServiceCtx } from '#commands/types'
import { checkRateLimit } from '#services/request-rate-limit'

import { RequestServices } from '../request'
import { requireDataWorkspace } from './data-context'
import { ApiError, ScopeError } from './errors'
import type { FunctionContext } from './function-context'

/** Expected domain failures are mapped here. Driver diagnostics are never public. */
export function commandError(cause: unknown): ApiError | ScopeError {
  if (cause instanceof ApiError || cause instanceof ScopeError) return cause
  if (cause instanceof ValidationError) return new ApiError('request', 400, cause.message, cause)
  if (cause instanceof NotFoundError) return new ApiError('request', 404, cause.message, cause, cause.details)
  if (cause instanceof ForbiddenError) return new ScopeError(403, cause.message)
  if (cause instanceof ConflictError) return new ApiError('request', 409, cause.message, cause, cause.details)
  if (cause instanceof PayloadTooLargeError) return new ApiError('request', 413, cause.message, cause)
  if (cause instanceof UnsupportedMediaTypeError) return new ApiError('request', 415, cause.message, cause)
  return new ApiError('request', 500, 'The operation could not be completed.', cause)
}

/** Only the verified request identity can construct a shared command capability. */
export function commandContext(context: FunctionContext) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* Effect.try({
      try: (): ServiceCtx => {
        const workspace = requireDataWorkspace(context.scope)
        const auth = context.scope.auth
        if (!auth || auth.kind !== 'human' || (auth.method !== 'access' && auth.method !== 'dev'))
          throw new ScopeError(403, 'An interactive browser session is required.')
        if (context.workspaceSlug && workspace.slug !== context.workspaceSlug)
          throw new ScopeError(403, 'Selected workspace is not accessible.')
        return {
          db: services.db,
          kv: services.env.KV,
          r2: services.env.R2,
          workspaceId: workspace.id,
          userId: context.scope.user.id,
          role: workspace.role,
          authKind: 'human',
          auth,
          workspaceHub: services.env.WORKSPACE_HUB,
        }
      },
      catch: commandError,
    })
  })
}

/** Each ServerFn passes its concrete domain operation, never an HTTP route or dispatch key. */
export function runCommand<A>(context: FunctionContext, operation: (ctx: ServiceCtx) => Promise<A>) {
  return Effect.gen(function* () {
    const ctx = yield* commandContext(context)
    const services = yield* RequestServices
    const limited = yield* Effect.tryPromise({
      try: () => checkRateLimit(services.request, services.env),
      catch: commandError,
    })
    if (limited)
      return yield* new ApiError('request', 429, 'Too many requests', undefined, { retryAfter: limited.retryAfter })
    return yield* Effect.tryPromise({ try: () => operation(ctx), catch: commandError })
  })
}
