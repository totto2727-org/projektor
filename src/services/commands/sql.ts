import { Array } from 'effect'

export const prepareQuery = function prepareQuery(
  db: D1Database,
  query: Readonly<{ sql: string; params: unknown[] }>,
): D1PreparedStatement {
  return db.prepare(query.sql).bind(...query.params)
}

/*
 * Cloudflare D1 rejects any query carrying more than 100 bound parameters. A query
 * whose parameter count grows with an input array — drizzle `inArray`, a raw `IN (...)`,
 * or a batched mutation keyed by ids — will therefore throw at runtime once the array is
 * large enough (manifesting as a 500). The boundary is invisible in tests: the vitest
 * runner backs D1 with SQLite, whose limit is 32766, so an un-chunked query passes CI and
 * only fails on real D1.
 *
 * RULE: never bind a row- or user-scaled array straight into a query. Split it with
 * `inChunks` so each underlying query stays under the cap.
 */
const D1_BOUND_PARAM_LIMIT = 100

/*
 * PROJ-518: shared by services/issues.ts (issues_fts) and services/wiki.ts (wiki_fts) —
 * FTS5 MATCH treats bare input as query syntax (AND/OR/NOT, column filters, prefix "*",
 * etc). Wrap each whitespace-separated token in double quotes so raw user text is always
 * treated as a literal phrase search, never interpreted as FTS query syntax.
 */
export const sanitizeFtsQuery = function sanitizeFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/u)
    .filter((token) => Boolean(token) && /\w/u.test(token))
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' ')
}

/*
 * Conservative chunk size: leaves ~10 parameters of headroom for the other predicates in
 * the same query (a workspaceId filter, status filters, etc.). Every current caller binds
 * fewer than 10 extra params, so 90 is safe; shrink it if a query ever needs more.
 */
const CHUNK_SIZE = D1_BOUND_PARAM_LIMIT - 10

/**
 * Run `op` over `items` in chunks small enough that each resulting query stays under D1's
 * bound-parameter cap, concatenating the rows each chunk returns. For mutations that
 * return nothing, have `op` return an empty array.
 */
export const inChunks = async function inChunks<I, O>(
  items: Readonly<I[]>,
  op: (chunk: I[]) => Promise<O[]>,
): Promise<O[]> {
  if (Array.isReadonlyArrayEmpty(items)) {
    return []
  }
  const out: O[] = []
  for (let index = 0; index < items.length; index += CHUNK_SIZE) {
    out.push(...(await op(items.slice(index, index + CHUNK_SIZE))))
  }
  return out
}
