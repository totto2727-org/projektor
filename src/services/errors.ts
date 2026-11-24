import { Data, Effect } from 'effect'

/** Query failures contain no HTTP, app authorization or presentation semantics. */
export class DataQueryError extends Data.TaggedError('DataQueryError')<{
  readonly operation: string
  readonly cause: unknown
}> {}

/** Lazy D1 I/O bridge. No query runs before the caller executes the Effect. */
export const queryEffect = function queryEffect<A>(
  operation: string,
  query: () => PromiseLike<A>,
): Effect.Effect<A, DataQueryError> {
  return Effect.tryPromise({
    catch: (cause) => new DataQueryError({ operation, cause }),
    try: () => Promise.resolve(query()),
  })
}
