import { makeRpcStub, WorkerEnvironment } from 'alchemy/Cloudflare/Workers'
import { Cause, Effect, Result, Schema } from 'effect'

import { HTTP_BAD_GATEWAY } from '#contracts/http-status.ts'

import { coreFailure, CorePublicError, coreReplyCodec } from './contract.ts'
import type { CoreRpcShape } from './contract.ts'

// Consumers use this runtime entry for instanceof checks across the bundled boundary.
export { CorePublicError } from './contract.ts'

type LazyCoreClient = Readonly<{
  [K in keyof CoreRpcShape]: CoreRpcShape[K] extends (...args: infer Args) => Effect.Effect<infer A, infer E, infer R>
    ? (...args: Args) => Effect.Effect<A, E, R | WorkerEnvironment>
    : never
}>

/** The SDK resolves the service binding at dispatch, never at module initialization. */
export function makeCoreClient(): LazyCoreClient
export function makeCoreClient(binding: unknown): CoreRpcShape
export function makeCoreClient(binding?: unknown): CoreRpcShape | LazyCoreClient {
  return makeRpcStub<CoreRpcShape>(binding ?? WorkerEnvironment.pipe(Effect.map((env) => env.CORE)))
}

const decodeFailure = function decodeFailure(
  stage: 'transport' | 'reply',
  cause: Cause.Cause<unknown>,
): Effect.Effect<never, CorePublicError> {
  if (Cause.hasInterruptsOnly(cause)) {
    return Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)))
  }
  const problem = coreFailure(
    HTTP_BAD_GATEWAY,
    stage === 'transport'
      ? 'The Core service is temporarily unavailable.'
      : 'The Core service returned an invalid response.',
  )
  console.error('[core-client]', { stage, occurrenceId: problem.occurrenceId })
  return Effect.fail(problem)
}

/**
 * Sanitize transport failures before decoding the application's validated envelope.
 *
 * @param {S} schema The success schema expected by this caller.
 * @param {Effect.Effect<string, E, R>} invocation The native call that returns the encoded reply.
 * @returns {Effect.Effect<S['Type'], CorePublicError, R | S['DecodingServices']>} The decoded success or a public failure.
 */
export const decodeCoreReply = function decodeCoreReply<S extends Schema.Top, E, R>(
  schema: S,
  invocation: Effect.Effect<string, E, R>,
): Effect.Effect<S['Type'], CorePublicError, R | S['DecodingServices']> {
  return invocation.pipe(
    Effect.catchCause((cause) => decodeFailure('transport', cause)),
    Effect.flatMap((wire) =>
      // oxlint-disable-next-line rules/require-top-level-decoder -- The caller supplies the success schema. Build its reply decoder after the native call returns a wire value.
      Schema.decodeEffect(coreReplyCodec(schema))(wire).pipe(
        Effect.catchCause((cause) => decodeFailure('reply', cause)),
      ),
    ),
    Effect.flatMap((reply) =>
      Result.isSuccess(reply) ? Effect.succeed(reply.success) : Effect.fail(new CorePublicError(reply.failure)),
    ),
  )
}
