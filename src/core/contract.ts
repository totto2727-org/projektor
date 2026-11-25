import type { HttpEffect, WorkerEnvironment, WorkerExecutionContext } from 'alchemy/Cloudflare/Workers'
import { Predicate, Cause, Data, Effect, Result, Schema } from 'effect'

import { HTTP_INTERNAL_SERVER_ERROR } from '#contracts/http-status.ts'

import type { ApiCoreRpcShape } from './api/operations.ts'
import type { WebCoreRpcShape } from './web/operations.ts'

export const CORE_ACTOR_HEADER = 'x-projektor-core-actor'

type ClientShape<T> = Readonly<{
  [K in keyof T]: T[K] extends (...args: infer Args) => Effect.Effect<infer A, infer E, infer _R>
    ? (...args: Args) => Effect.Effect<A, E>
    : never
}>
export type CoreRpcShape = ClientShape<ApiCoreRpcShape & WebCoreRpcShape>
type InvocationShape<T> = Readonly<{
  [K in keyof T]: T[K] extends (...args: infer Args) => Effect.Effect<infer A, infer E, infer R>
    ? (...args: Args) => Effect.Effect<A, E, R | WorkerEnvironment | WorkerExecutionContext>
    : never
}>
export type CoreShape = InvocationShape<CoreRpcShape> & Readonly<{ fetch: HttpEffect }>

export const CoreProblem = Schema.Struct({
  status: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 400, maximum: 599 })),
  message: Schema.String,
  occurrenceId: Schema.String.check(Schema.isPattern(/^urn:uuid:[0-9a-f-]{36}$/iu)),
  kind: Schema.optional(Schema.String),
  details: Schema.optional(Schema.JsonObject),
  retryAfter: Schema.optional(Schema.Number),
})
export type CoreProblem = typeof CoreProblem.Type

export type CoreReply<R, S extends Schema.Top = never> = Effect.Effect<
  string,
  never,
  R | (typeof CoreProblem | S)['EncodingServices']
>

/** Only explicitly selected public data may cross the native binding. */
export class CorePublicError extends Data.TaggedError('CorePublicError')<CoreProblem> {}

export const coreFailure = function coreFailure(
  status: number,
  message: string,
  metadata: Pick<CoreProblem, 'kind' | 'details' | 'retryAfter'> = {},
): CorePublicError {
  return new CorePublicError({ status, message, occurrenceId: `urn:uuid:${crypto.randomUUID()}`, ...metadata })
}

export const coreReplyCodec = <S extends Schema.Top>(
  success: S,
): Schema.fromJsonString<Schema.toCodecJson<Schema.Result<S, typeof CoreProblem>>> =>
  Schema.fromJsonString(Schema.toCodecJson(Schema.Result(success, CoreProblem)))

/**
 * Encode the outcome in the originating Worker so only validated public fields cross the binding.
 *
 * @param {string} operation The operation name recorded in the Worker's diagnostic log.
 * @param {S} success The schema for the successful result.
 * @param {Effect.Effect<unknown, E, R>} effect The operation whose outcome the Worker sends.
 * @returns {CoreReply<R, S>} The effect that encodes either the success value or a public problem as JSON.
 */
export const coreReply = function coreReply<E, R, S extends Schema.Top>(
  operation: string,
  success: S,
  effect: Effect.Effect<unknown, E, R>,
): CoreReply<R, S> {
  const codec = coreReplyCodec(success)
  return effect.pipe(
    Effect.flatMap((value) => Schema.encodeUnknownEffect(codec)(Result.succeed(value))),
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)))
      }
      const failure = Cause.findError(cause)
      const expected = !Cause.hasDies(cause) && Result.isSuccess(failure) && failure.success instanceof CorePublicError
      const problem = expected
        ? failure.success
        : coreFailure(HTTP_INTERNAL_SERVER_ERROR, 'An unexpected error occurred.')
      if (!expected) {
        console.error('[core]', { operation, occurrenceId: problem.occurrenceId, cause })
      }
      return Schema.encodeEffect(codec)(
        Result.fail({
          status: problem.status,
          message: problem.message,
          occurrenceId: problem.occurrenceId,
          ...(Predicate.isNullish(problem.kind) ? {} : { kind: problem.kind }),
          ...(Predicate.isNullish(problem.details) ? {} : { details: problem.details }),
          ...(Predicate.isNullish(problem.retryAfter) ? {} : { retryAfter: problem.retryAfter }),
        }),
      ).pipe(
        Effect.catchCause((encodingCause) => {
          const fallback = coreFailure(HTTP_INTERNAL_SERVER_ERROR, 'An unexpected error occurred.')
          console.error('[core]', { operation, occurrenceId: fallback.occurrenceId, cause: encodingCause })
          return Schema.encodeEffect(codec)(Result.fail(fallback)).pipe(Effect.orDie)
        }),
      )
    }),
  )
}
