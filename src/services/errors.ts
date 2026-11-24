import { Data, Effect } from 'effect'

/** Query failures contain no HTTP, app authorization or presentation semantics. */
export class DataQueryError extends Data.TaggedError('DataQueryError')<
  Readonly<{
    cause: unknown
    operation: string
  }>
> {}

/**
 * Keep D1 I/O deferred until the caller executes the Effect.
 *
 * @param {string} operation The operation name attached to query failures.
 * @param {() => PromiseLike<A>} query The deferred storage query.
 * @returns {Effect.Effect<A, DataQueryError>} The result or its named query failure.
 */
export const queryEffect = function queryEffect<A>(
  operation: string,
  query: () => PromiseLike<A>,
): Effect.Effect<A, DataQueryError> {
  return Effect.tryPromise({
    catch: (cause) => new DataQueryError({ cause, operation }),
    try: async () => query(),
  })
}
