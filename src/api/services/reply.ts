import { Effect, type Schema } from 'effect'

import { decodeCoreReply } from '../../core/client'

/** The only shared adapter machinery is envelope decoding, never operation dispatch. */
export function apiReply<S extends Schema.Top & { readonly DecodingServices: never }, E>(
  schema: S,
  invocation: Effect.Effect<string, E>,
) {
  return Effect.runPromise(decodeCoreReply(schema, invocation))
}
