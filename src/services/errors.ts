import { Data, Effect, Predicate } from 'effect'

/** Query failures contain no HTTP, app authorization or presentation semantics. */
export class DataQueryError extends Data.TaggedError('DataQueryError')<
  Readonly<{
    cause: unknown
    operation: string
  }>
> {}

// SQLite's error marker uses ASCII case folding.
const UNIQUE_CONSTRAINT_PATTERN = new RegExp(
  'unique constraint failed'.replaceAll(/[a-z]/gu, (letter) => `[${letter}${letter.toUpperCase()}]`),
  'u',
)

export const isUniqueConstraintError = function isUniqueConstraintError(cause: unknown): boolean {
  return Predicate.isError(cause) && UNIQUE_CONSTRAINT_PATTERN.test(cause.message)
}

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
