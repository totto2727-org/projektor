import { makeRpcStub, WorkerEnvironment } from 'alchemy/Cloudflare/Workers'
import { Cause, Effect, Result, Schema } from 'effect'

import { coreFailure, CorePublicError, coreReplyCodec, type CoreRpcShape } from './contract'

// Consumers use this runtime entry for instanceof checks across the bundled boundary.
export { CorePublicError } from './contract'

type LazyCoreClient = {
  readonly [K in keyof CoreRpcShape]: CoreRpcShape[K] extends (
    ...args: infer Args
  ) => Effect.Effect<infer A, infer E, infer R>
    ? (...args: Args) => Effect.Effect<A, E, R | WorkerEnvironment>
    : never
}

/** The SDK resolves the service binding at dispatch, never at module initialization. */
export function makeCoreClient(): LazyCoreClient
export function makeCoreClient(binding: unknown): CoreRpcShape
export function makeCoreClient(binding?: unknown): CoreRpcShape | LazyCoreClient {
  return makeRpcStub<CoreRpcShape>(binding ?? WorkerEnvironment.pipe(Effect.map((env) => env.CORE)))
}

function decodeFailure(stage: 'transport' | 'reply', cause: Cause.Cause<unknown>) {
  if (Cause.hasInterruptsOnly(cause))
    return Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)))
  const problem = coreFailure(
    502,
    stage === 'transport'
      ? 'The Core service is temporarily unavailable.'
      : 'The Core service returned an invalid response.',
  )
  console.error('[core-client]', { stage, occurrenceId: problem.occurrenceId, diagnostic: Cause.pretty(cause) })
  return Effect.fail(problem)
}

/** Sanitize the native transport before decoding the application's validated envelope. */
export function decodeCoreReply<S extends Schema.Top, E, R>(schema: S, invocation: Effect.Effect<string, E, R>) {
  return invocation.pipe(
    Effect.catchCause((cause) => decodeFailure('transport', cause)),
    Effect.flatMap((wire) =>
      Schema.decodeUnknownEffect(coreReplyCodec(schema))(wire).pipe(
        Effect.catchCause((cause) => decodeFailure('reply', cause)),
      ),
    ),
    Effect.flatMap((reply) =>
      Result.isSuccess(reply) ? Effect.succeed(reply.success) : Effect.fail(new CorePublicError(reply.failure)),
    ),
  )
}
