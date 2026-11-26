import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { Predicate } from 'effect'
import type { Effect } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { SECONDS_PER_DAY, currentEpochSeconds } from '#contracts/time.ts'
import { drizzle, schema } from '#db'

import { queryEffect } from './errors.ts'
import type { DataQueryError } from './errors.ts'
import { buildCfdOverTime } from './flow-metrics-cfd.ts'
import {
  buildAgingWip,
  computeAutonomyRatios,
  computeCoreDistributions,
  computeFlowEfficiencies,
  computeHumanInterventions,
  summarize,
} from './flow-metrics-distributions.ts'
import type { Distribution, FlowIssueRow } from './flow-metrics-distributions.ts'
import {
  buildArrivalVsCompletion,
  buildBugShareOverTime,
  buildReviewLatencyOverTime,
  buildThroughputOverTime,
  buildWipOverTime,
  resolveFlowMetricWindows,
} from './flow-metrics-series.ts'
import { fetchHumanCommentCounts, fetchLeaseHeldSeconds, fetchWindowCounts } from './flow-metrics-storage.ts'

export type { Distribution } from './flow-metrics-distributions.ts'

/** App-validated range. Authorization and input validation belong to the caller. */
export interface FlowMetricsRange {
  projectId: string
  since?: number
  until?: number
  granularity: 'day' | 'week'
}

export interface FlowMetrics {
  leadTime: Distribution
  leadTimeExcluded: number
  cycleTime: Distribution
  wipOverTime: ReturnType<typeof buildWipOverTime>
  throughputOverTime: ReturnType<typeof buildThroughputOverTime>
  bugShareOverTime: ReturnType<typeof buildBugShareOverTime>
  bugTypeTracked: boolean
  reviewLatency: Distribution
  reviewLatencyOverTime: ReturnType<typeof buildReviewLatencyOverTime>
  humanInterventions: Distribution
  autonomyRatio: Distribution
  cfdOverTime: ReturnType<typeof buildCfdOverTime>
  timeInProgress: Distribution
  arrivalVsCompletionOverTime: ReturnType<typeof buildArrivalVsCompletion>
  flowEfficiency: Distribution
  agingWip: ReturnType<typeof buildAgingWip>
  factoryHealth: Omit<Awaited<ReturnType<typeof fetchWindowCounts>>, 'doneBeforeWindow'>
}

const readFlowMetrics = async function readFlowMetrics({
  db,
  now: fixedNow,
  range,
  workspaceId,
}: {
  db: D1Database
  now?: number
  range: FlowMetricsRange
  workspaceId: string
}): Promise<FlowMetrics> {
  const now = fixedNow ?? currentEpochSeconds()
  const { projectId, since, until, granularity } = range
  const orm = drizzle(db, { schema })

  const { throughputSince, throughputUntil, wipSince, wipUntil } = resolveFlowMetricWindows({ since, until }, now)

  /*
   * PROJ-866: scope the issue SELECT to the window instead of loading every issue in
   * the project.
   * - created_at <= until (or now): an issue created later can't have entered any
   *   stage by `until`, so no windowed series wants it.
   * - done_at >= doneBefore, only when `since` is given (when it's omitted, leadTime/
   *   cycleTime are deliberately unbounded, see inWindow below). doneBefore is the
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

  const loaded = await orm
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
  const issues = loaded.filter((issue) => inSqlWindow(issue))

  /*
   * Scope by project only, not created_at: since/until describe an activity window
   * (claimed/done), and an issue created before the window but active inside it must
   * still count (e.g. WIP). Row count stays bounded by the window (via the SQL filter
   * above) rather than total project size.
   */
  const inWindow = (timestamp: number): boolean =>
    (Predicate.isNullish(since) || timestamp >= since) && (Predicate.isNullish(until) || timestamp <= until)

  const { leadTimes, cycleTimes, reviewLatencies, timeInProgress } = computeCoreDistributions(issues, inWindow)

  // The issues the per-issue comment/lease lookups serve: done inside the window.
  const doneInWindowScope = and(
    projectScope,
    isNotNull(schema.issues.doneAt),
    Predicate.isNullish(since) ? undefined : gte(schema.issues.doneAt, since),
    Predicate.isNullish(until) ? undefined : lte(schema.issues.doneAt, until),
  )
  // Never let the per-issue lookups run without a tenant scope.
  if (!doneInWindowScope) {
    throw new Error('flow-metrics: missing issue scope')
  }

  const bugTypeFilter = and(eq(schema.taskTypes.workspaceId, workspaceId), eq(schema.taskTypes.key, 'bug'))

  /*
   * PROJ-446: everything below depends only on the window bounds plus ctx/projectId —
   * none of these reads depend on each other, so run them concurrently instead of one
   * round trip at a time.
   */
  const [humanCommentCounts, leaseHeldSeconds, bugTypeExists, windowCounts] = await Promise.all([
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
  ])
  const { doneBeforeWindow, ...factoryHealth } = windowCounts

  const humanInterventions = computeHumanInterventions(issues, humanCommentCounts, inWindow)
  const autonomyRatios = computeAutonomyRatios(issues, leaseHeldSeconds, inWindow)
  const wipOverTime = buildWipOverTime(issues, wipSince, wipUntil)
  const throughputWindow = { granularity, since: throughputSince, until: throughputUntil }
  const throughputOverTime = buildThroughputOverTime(issues, throughputWindow)
  const reviewLatencyOverTime = buildReviewLatencyOverTime(issues, throughputWindow)
  const cfdOverTime = buildCfdOverTime(issues, throughputWindow, { doneBeforeWindow, now })
  const bugShareOverTime = buildBugShareOverTime(issues, throughputWindow)
  const bugTypeTracked = Predicate.isNotNullish(bugTypeExists)
  const arrivalVsCompletionOverTime = buildArrivalVsCompletion(issues, throughputWindow)
  const flowEfficiencies = computeFlowEfficiencies(issues, leaseHeldSeconds, inWindow)
  const agingWip = buildAgingWip(loaded, now)

  return fieldsInOrder([
    ['leadTime', summarize(leadTimes)],
    /*
     * PROJ-921: issues done in the window that never sat in a ready status (straight from
     * backlog to in_progress/done). They have no lead time and are not in leadTime's
     * sample (leadTime.count); reported so a small or skewed sample is visible.
     */
    [
      'leadTimeExcluded',
      issues.filter(
        (issue) => Predicate.isNullish(issue.readyAt) && Predicate.isNotNullish(issue.doneAt) && inWindow(issue.doneAt),
      ).length,
    ],
    ['cycleTime', summarize(cycleTimes)],
    ['wipOverTime', wipOverTime],
    ['throughputOverTime', throughputOverTime],
    /*
     * PROJ-331: bug share of throughput — a rising share signals the factory shipping
     * more defects, not just more work.
     */
    ['bugShareOverTime', bugShareOverTime],
    /*
     * PROJ-341: whether a "bug"-keyed task type exists in the workspace at all —
     * distinguishes "tracked, 0 bugs" from "not tracked, no matching type".
     */
    ['bugTypeTracked', bugTypeTracked],
    /*
     * PROJ-328: collaboration-shape metrics. reviewLatency is the primary human
     * choke point (in_review -> done); humanInterventions and autonomyRatio are
     * aggregated per completed issue.
     */
    ['reviewLatency', summarize(reviewLatencies)],
    ['reviewLatencyOverTime', reviewLatencyOverTime],
    ['humanInterventions', summarize(humanInterventions)],
    ['autonomyRatio', summarize(autonomyRatios)],
    // PROJ-329: cumulative flow diagram + time-in-state breakdown.
    ['cfdOverTime', cfdOverTime],
    ['timeInProgress', summarize(timeInProgress)],
    // PROJ-330: arrival vs completion, flow efficiency, aging-WIP scatter.
    ['arrivalVsCompletionOverTime', arrivalVsCompletionOverTime],
    ['flowEfficiency', summarize(flowEfficiencies)],
    ['agingWip', agingWip],
    // PROJ-334: factory health — fault signals for the machinery itself.
    ['factoryHealth', factoryHealth],
  ])
}

/**
 * Read flow metrics when the caller executes the Effect. The caller validates the range and authorizes project access.
 *
 * @param {D1Database} db The target database.
 * @param {string} workspaceId The workspace that owns the project.
 * @param {FlowMetricsRange} range The project, date window and bucket granularity.
 * @param {number} [now] The optional clock value in epoch seconds.
 * @returns {Effect.Effect<FlowMetrics, DataQueryError>} The metrics or their named query error.
 */
// oxlint-disable-next-line eslint/max-params -- Existing callers pass the database, workspace, range and optional clock positionally.
export const getFlowMetrics = function getFlowMetrics(
  db: D1Database,
  workspaceId: string,
  range: FlowMetricsRange,
  now?: number,
): Effect.Effect<FlowMetrics, DataQueryError> {
  return queryEffect('getFlowMetrics', readFlowMetrics.bind(undefined, { db, now, range, workspaceId }))
}
