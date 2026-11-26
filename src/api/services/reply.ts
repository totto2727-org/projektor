import { Effect } from 'effect'
import type { Schema } from 'effect'
import { decodeCoreReply } from 'projektor/core-client'

/**
 * The only shared adapter machinery is envelope decoding, never operation dispatch.
 *
 * @param {S} schema The expected successful RPC payload schema.
 * @param {Effect.Effect<string, E>} invocation An effect that returns the Core JSON envelope.
 * @returns {Promise<S['Type']>} The decoded success payload. A public Core failure rejects the promise.
 */
export const apiReply = function apiReply<S extends Schema.Top & Readonly<{ DecodingServices: never }>, E>(
  schema: S,
  invocation: Effect.Effect<string, E>,
): Promise<S['Type']> {
  // oxlint-disable-next-line rules/no-effect-runtime-run -- Hono and the Worker runtime await this promise at their request boundaries.
  return Effect.runPromise(decodeCoreReply(schema, invocation))
}
