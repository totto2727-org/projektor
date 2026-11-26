import { and, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { Data, Iterable, Predicate } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { SECONDS_PER_DAY } from '#contracts/time.ts'
import { schema } from '#db'
import type { drizzle } from '#db'
import { SQL_NULL } from '#db/sql-null.ts'

import { MIN_DURATION_SECONDS } from './flow-metrics-distributions.ts'
import type { FlowIssueRow } from './flow-metrics-distributions.ts'
import { fetchWindowCounts } from './flow-metrics-factory.ts'

export interface FlowIssueWindow {
  createdUntil: number
  doneBefore: number | undefined
  inSqlWindow: (issue: FlowIssueRow) => boolean
  projectScope: SQL | undefined
  windowOrOpenIssue: SQL | undefined
}

interface FlowWindowQueryOptions {
  issueWindow: FlowIssueWindow
  projectId: string
  since: number | undefined
  throughputSince: number
  throughputUntil: number
  until: number | undefined
  workspaceId: string
}

export interface BugTypeMarker {
  id: string
}

class MissingFlowIssueScope extends Data.TaggedError('MissingFlowIssueScope')<Readonly<{ message: string }>> {}

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

export const createFlowIssueWindow = function createFlowIssueWindow({
  now,
  projectId,
  since,
  until,
  workspaceId,
}: {
  now: number
  projectId: string
  since: number | undefined
  until: number | undefined
  workspaceId: string
}): FlowIssueWindow {
  /*
   * PROJ-866: scope the issue SELECT to the window instead of loading every issue in
   * the project.
   * - created_at <= until (or now): an issue created later can't have entered any
   *   stage by `until`, so no windowed series wants it.
   * - done_at >= doneBefore, only when `since` is given (when it's omitted, leadTime/
   *   cycleTime are deliberately unbounded, see collectIssueActivity). doneBefore is the
   *   start of wipOverTime's first day bucket, not `since` itself: that bucket samples
   *   at the day start, so an issue done between it and `since` still counts as WIP
   *   there. Issues done before doneBefore are in the CFD done band at every sample;
   *   they're counted (fetchWindowCounts) rather than loaded.
   */
  const createdUntil = until ?? now
  const doneBefore = Predicate.isNullish(since) ? undefined : Math.min(since, since - (since % SECONDS_PER_DAY))
  const windowPredicate = and(
    lte(schema.issues.createdAt, createdUntil),
    Predicate.isNullish(doneBefore)
      ? undefined
      : or(isNull(schema.issues.doneAt), gte(schema.issues.doneAt, doneBefore)),
  )
  const inSqlWindow = (issue: FlowIssueRow): boolean =>
    issue.createdAt <= createdUntil &&
    (Predicate.isNullish(doneBefore) || Predicate.isNullish(issue.doneAt) || issue.doneAt >= doneBefore)
  const projectScope = and(eq(schema.issues.workspaceId, workspaceId), eq(schema.issues.projectId, projectId))

  /*
   * Currently open issues are also loaded whatever their dates, for the
   * present-state agingWip snapshot only (a reopened issue keeps its old
   * write-once done_at, and one created after a past `until` is still open
   * now). They're filtered back out below for every windowed series.
   */
  const windowOrOpenIssue = or(windowPredicate, inArray(schema.issues.status, ['in_progress', 'in_review']))
  return { createdUntil, doneBefore, inSqlWindow, projectScope, windowOrOpenIssue }
}

export const selectFlowIssues = function selectFlowIssues(
  orm: ReturnType<typeof drizzle>,
  { projectScope, windowOrOpenIssue }: FlowIssueWindow,
): PromiseLike<FlowIssueRow[]> {
  return orm
    .select(
      fieldsInOrder([
        ['id', schema.issues.id],
        ['createdAt', schema.issues.createdAt],
        ['readyAt', schema.issues.readyAt],
        ['claimedAt', schema.issues.claimedAt],
        ['doneAt', schema.issues.doneAt],
        ['inReviewAt', schema.issues.inReviewAt],
        ['reviewBounceCount', schema.issues.reviewBounceCount],
        ['status', schema.issues.status],
        ['typeKey', schema.taskTypes.key],
      ]),
    )
    .from(schema.issues)
    .leftJoin(schema.taskTypes, eq(schema.issues.typeId, schema.taskTypes.id))
    .where(and(projectScope, windowOrOpenIssue))
}

const createDoneIssueScope = function createDoneIssueScope(
  projectScope: SQL | undefined,
  { since, until }: { since: number | undefined; until: number | undefined },
): SQL {
  // The issues the per-issue comment/lease lookups serve: done inside the window.
  const doneInWindowScope = and(
    projectScope,
    isNotNull(schema.issues.doneAt),
    Predicate.isNullish(since) ? undefined : gte(schema.issues.doneAt, since),
    Predicate.isNullish(until) ? undefined : lte(schema.issues.doneAt, until),
  )
  // Never let the per-issue lookups run without a tenant scope.
  if (!doneInWindowScope) {
    throw new MissingFlowIssueScope({ message: 'flow-metrics: missing issue scope' })
  }
  return doneInWindowScope
}

export const assembleFlowWindowQueries = function assembleFlowWindowQueries(
  orm: ReturnType<typeof drizzle>,
  {
    issueWindow: { createdUntil, doneBefore, projectScope },
    projectId,
    since,
    throughputSince,
    throughputUntil,
    until,
    workspaceId,
  }: FlowWindowQueryOptions,
): [
  Promise<Map<string, number>>,
  Promise<Map<string, number>>,
  Promise<BugTypeMarker | undefined>,
  ReturnType<typeof fetchWindowCounts>,
] {
  const doneInWindowScope = createDoneIssueScope(projectScope, { since, until })

  const bugTypeFilter = and(eq(schema.taskTypes.workspaceId, workspaceId), eq(schema.taskTypes.key, 'bug'))

  /*
   * PROJ-446: everything below depends only on the window bounds plus ctx/projectId —
   * none of these reads depend on each other, so run them concurrently instead of one
   * round trip at a time.
   */
  return [
    fetchHumanCommentCounts(orm, doneInWindowScope),
    fetchLeaseHeldSeconds(orm, workspaceId, doneInWindowScope),
    /*
     * PROJ-341: buildBugShareOverTime identifies bugs via typeKey === "bug" — if the
     * workspace has no type keyed "bug" (renamed/deleted default), that always reads 0%
     * with no indication anything's wrong. Surface whether the type exists at all so the
     * frontend can show a distinguishable "not tracked" state instead of a silent 0%.
     */
    orm.select({ id: schema.taskTypes.id }).from(schema.taskTypes).where(bugTypeFilter).get(),
    /*
     * PROJ-334: same window as the throughput/CFD/etc. buckets below — the "selected
     * window" the tile row is scoped to.
     */
    fetchWindowCounts(orm, {
      createdUntil,
      doneBefore,
      projectId,
      since: throughputSince,
      until: throughputUntil,
      workspaceId,
    }),
  ]
}
