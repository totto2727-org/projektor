import { and, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { Iterable, Predicate } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { schema } from '#db'
import type { drizzle } from '#db'
import { SQL_NULL } from '#db/sql-null.ts'

import { MIN_DURATION_SECONDS } from './flow-metrics-distributions.ts'

/*
 * PROJ-866: the per-issue lookups below join back to `issues` on the same project scope
 * plus `doneInWindow` (see getFlowMetrics) instead of binding an issue-id IN-list, so
 * each is one statement however many issues the window holds. doneInWindow is exactly
 * the set their consumers read: humanInterventions, autonomyRatio and flowEfficiency
 * all only look at issues done inside the window.
 */

/*
 * PROJ-328: human-authored comments per issue, keyed by the ctx.authKind stamped at
 * write time (comments.ts) — not the deprecated agent_sessions.kind. Rows written before
 * that column existed have author_kind NULL and are excluded rather than guessed.
 */
export const fetchHumanCommentCounts = async function fetchHumanCommentCounts(
  orm: ReturnType<typeof drizzle>,
  issueScope: SQL,
): Promise<Map<string, number>> {
  const rows = await orm
    .select({ issueId: schema.issueComments.issueId, n: sql`count(*)` })
    .from(schema.issueComments)
    .innerJoin(schema.issues, eq(schema.issueComments.issueId, schema.issues.id))
    .where(and(issueScope, eq(schema.issueComments.authorKind, 'human')))
    .groupBy(schema.issueComments.issueId)
  return new Map(rows.map((row) => [row.issueId, Number(row.n)]))
}

/*
 * PROJ-328: total lease-held seconds per issue, from issue_leases (already the
 * authoritative "an agent worked this issue" record — see issue-leases.ts). A lease
 * still held when the issue finished counts through doneAt, not "now".
 *
 * PROJ-866/F-P2: issue_leases.workspace_id is filtered too, so the lease side of the
 * join is tenant-scoped like every other cross-tenant read and can use its indexes.
 */
export const fetchLeaseHeldSeconds = async function fetchLeaseHeldSeconds(
  orm: ReturnType<typeof drizzle>,
  workspaceId: string,
  issueScope: SQL,
): Promise<Map<string, number>> {
  const rows = await orm
    .select(
      fieldsInOrder([
        ['issueId', schema.issueLeases.issueId],
        ['claimedAt', schema.issueLeases.claimedAt],
        ['releasedAt', schema.issueLeases.releasedAt],
        ['doneAt', schema.issues.doneAt],
      ]),
    )
    .from(schema.issueLeases)
    .innerJoin(schema.issues, eq(schema.issueLeases.issueId, schema.issues.id))
    .where(and(eq(schema.issueLeases.workspaceId, workspaceId), issueScope))
  const held = new Map<string, number>()
  Iterable.forEach(rows, (row) => {
    const end = row.releasedAt ?? row.doneAt ?? SQL_NULL
    if (Predicate.isNullish(end)) {
      return
    }
    const seconds = Math.max(MIN_DURATION_SECONDS, end - row.claimedAt)
    held.set(row.issueId, (held.get(row.issueId) ?? MIN_DURATION_SECONDS) + seconds)
  })
  return held
}

export { fetchWindowCounts } from './flow-metrics-factory.ts'
