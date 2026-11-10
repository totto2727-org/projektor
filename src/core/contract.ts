import type { HttpEffect, WorkerEnvironment, WorkerExecutionContext } from 'alchemy/Cloudflare/Workers'
import { Cause, Data, Effect, Result, Schema } from 'effect'

import type { ApiCoreRpcShape } from './api/operations'
import type { WebCoreRpcShape } from './web/operations'

export const CORE_ACTOR_HEADER = 'x-projektor-core-actor'

type ClientShape<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer Args) => Effect.Effect<infer A, infer E, infer _R>
    ? (...args: Args) => Effect.Effect<A, E>
    : never
}
export type CoreRpcShape = ClientShape<ApiCoreRpcShape & WebCoreRpcShape>
type InvocationShape<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer Args) => Effect.Effect<infer A, infer E, infer R>
    ? (...args: Args) => Effect.Effect<A, E, R | WorkerEnvironment | WorkerExecutionContext>
    : never
}
export type CoreShape = InvocationShape<CoreRpcShape> & { readonly fetch: HttpEffect }

export const CoreProblem = Schema.Struct({
  status: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 400, maximum: 599 })),
  message: Schema.String,
  occurrenceId: Schema.String.check(Schema.isPattern(/^urn:uuid:[0-9a-f-]{36}$/i)),
  kind: Schema.optional(Schema.String),
  details: Schema.optional(Schema.JsonObject),
  retryAfter: Schema.optional(Schema.Number),
})
export type CoreProblem = typeof CoreProblem.Type

/** Only explicitly selected public data may cross the native binding. */
export class CorePublicError extends Data.TaggedError('CorePublicError')<CoreProblem> {}

export function coreFailure(
  status: number,
  message: string,
  metadata: Pick<CoreProblem, 'kind' | 'details' | 'retryAfter'> = {},
): CorePublicError {
  return new CorePublicError({ status, message, occurrenceId: `urn:uuid:${crypto.randomUUID()}`, ...metadata })
}

export const coreReplyCodec = <S extends Schema.Top>(success: S) =>
  Schema.fromJsonString(Schema.toCodecJson(Schema.Result(success, CoreProblem)))

/** Encode at the origin. Neither checked exceptions nor defects leave this Worker. */
export function coreReply<E, R, S extends Schema.Top>(
  operation: string,
  success: S,
  effect: Effect.Effect<unknown, E, R>,
) {
  const codec = coreReplyCodec(success)
  return effect.pipe(
    Effect.flatMap((value) => Schema.encodeUnknownEffect(codec)(Result.succeed(value))),
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause))
        return Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)))
      const failure = Cause.findError(cause)
      const expected = !Cause.hasDies(cause) && Result.isSuccess(failure) && failure.success instanceof CorePublicError
      const problem = expected ? failure.success : coreFailure(500, 'An unexpected error occurred.')
      if (!expected) {
        console.error('[core]', { operation, occurrenceId: problem.occurrenceId, cause })
      }
      return Schema.encodeEffect(codec)(
        Result.fail({
          status: problem.status,
          message: problem.message,
          occurrenceId: problem.occurrenceId,
          ...(problem.kind === undefined ? {} : { kind: problem.kind }),
          ...(problem.details === undefined ? {} : { details: problem.details }),
          ...(problem.retryAfter === undefined ? {} : { retryAfter: problem.retryAfter }),
        }),
      ).pipe(
        Effect.catchCause((encodingCause) => {
          const fallback = coreFailure(500, 'An unexpected error occurred.')
          console.error('[core]', { operation, occurrenceId: fallback.occurrenceId, cause: encodingCause })
          return Schema.encodeEffect(codec)(Result.fail(fallback)).pipe(Effect.orDie)
        }),
      )
    }),
  )
}
