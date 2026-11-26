import { and, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'
import { Iterable, Array, Function, Option, Predicate, Result } from 'effect'
import type { Effect } from 'effect'

import { flowMetricsDefaultStarts, mondayAtOrBefore } from '#contracts/flow-metrics-range.ts'
import { JSON_NULL } from '#contracts/json-null.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import {
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_DAY,
  SECONDS_PER_WEEK,
  currentEpochSeconds,
  formatUtcDatePrefix,
} from '#contracts/time.ts'
import { drizzle, schema } from '#db'
import { SQL_NULL } from '#db/sql-null.ts'

import { queryEffect } from './errors.ts'
import type { DataQueryError } from './errors.ts'

const MIN_DURATION_SECONDS = 0
const FIRST_ARRAY_INDEX = 0
const ARRAY_INDEX_STEP = 1
const LAST_INDEX_OFFSET = 1
const MEDIAN_FRACTION = 0.5
const P90_FRACTION = 0.9
const TIMESTAMP_STEP_SECONDS = 1
const ADD_TO_COUNT = 1
const REMOVE_FROM_COUNT = -1
const NO_EVENTS = 0
const EMPTY_RATIO = 0
const FULL_RATIO = 1

/** App-validated range. Authorization and input validation belong to the caller. */
export interface FlowMetricsRange {
  projectId: string
  since?: number
  until?: number
  granularity: 'day' | 'week'
}

interface MetricBucketWindow {
  since: number
  until: number
  granularity: FlowMetricsRange['granularity']
}

interface BucketRange {
  start: number
  end: number
}

export interface Distribution {
  count: number
  avg: number | null
  p50: number | null
  p90: number | null
}

const summarize = function summarize(durations: Readonly<number[]>): Distribution {
  if (Array.isReadonlyArrayEmpty(durations)) {
    return fieldsInOrder([
      ['count', NO_EVENTS],
      ['avg', JSON_NULL],
      ['p50', JSON_NULL],
      ['p90', JSON_NULL],
    ])
  }
  const sorted = [...durations].toSorted((left, right) => left - right)
  const avg = sorted.reduce((sum, duration) => sum + duration, MIN_DURATION_SECONDS) / sorted.length
  const percentile = (fraction: number): number =>
    sorted[Math.min(sorted.length - LAST_INDEX_OFFSET, Math.floor(fraction * sorted.length))]
  return fieldsInOrder([
    ['count', sorted.length],
    ['avg', avg],
    ['p50', percentile(MEDIAN_FRACTION)],
    ['p90', percentile(P90_FRACTION)],
  ])
}

interface FlowIssueRow {
  id: string
  createdAt: number
  readyAt: number | null
  claimedAt: number | null
  doneAt: number | null
  inReviewAt: number | null
  reviewBounceCount: number
  status: string
  typeKey: string | null
}

const dateLabel = function dateLabel(timestamp: number): string {
  return formatUtcDatePrefix(new Date(timestamp * MILLISECONDS_PER_SECOND))
}

const bucketSizeFor = function bucketSizeFor(granularity: 'day' | 'week'): number {
  return granularity === 'day' ? SECONDS_PER_DAY : SECONDS_PER_WEEK
}

const firstBucketFor = function firstBucketFor(since: number, granularity: 'day' | 'week'): number {
  return granularity === 'day' ? since - (since % SECONDS_PER_DAY) : mondayAtOrBefore(since)
}

/*
 * PROJ-866: bucket start times only — bounded by the schema's max-window validation,
 * so this list itself is now always small (<=366 for day, <=~261 for week) regardless
 * of what the caller passes.
 */
const buildBucketStarts = function buildBucketStarts(
  since: number,
  until: number,
  granularity: 'day' | 'week',
): number[] {
  const bucketSize = bucketSizeFor(granularity)
  return Array.unfold(firstBucketFor(since, granularity), (bucketStart) =>
    bucketStart <= until ? Option.some([bucketStart, bucketStart + bucketSize]) : Option.none(),
  )
}

/*
 * Each bucket's *effective* range, clamped to [since, until] so an aligned edge bucket
 * doesn't pull in events from just outside the requested window (matches leadTime/
 * cycleTime's inWindow semantics exactly).
 */
const metricBuckets = function metricBuckets({ granularity, since, until }: MetricBucketWindow): {
  ranges: BucketRange[]
  starts: number[]
} {
  const bucketSize = bucketSizeFor(granularity)
  const starts = buildBucketStarts(since, until, granularity)
  const ranges = starts.map((bucketStart): BucketRange =>
    fieldsInOrder([
      ['start', Math.max(bucketStart, since)],
      ['end', Math.min(bucketStart + bucketSize, until + TIMESTAMP_STEP_SECONDS)],
    ]),
  )
  return { ranges, starts }
}

/*
 * PROJ-866: assign each item to its bucket in one pass over the SORTED item list plus
 * one pass over the (already small, bounded) bucket ranges — O(n log n + buckets)
 * instead of the old O(buckets * n) (filtering every issue per bucket). Ranges must be
 * non-decreasing and non-overlapping in `start`/`end` (true for metricBuckets() above,
 * since consecutive buckets are contiguous and since/until only clamp the two edges).
 */
const groupBySortedRanges = function groupBySortedRanges<T>(
  items: Readonly<T[]>,
  time: (item: T) => number,
  ranges: Readonly<BucketRange[]>,
): T[][] {
  const sorted = [...items].toSorted((left, right) => time(left) - time(right))
  const cursor = { index: FIRST_ARRAY_INDEX }
  const advanceBefore = function advanceBefore(cutoff: number): void {
    while (cursor.index < sorted.length && time(sorted[cursor.index]) < cutoff) {
      cursor.index += ARRAY_INDEX_STEP
    }
  }
  return ranges.map(({ start, end }) => {
    advanceBefore(start)
    const first = cursor.index
    advanceBefore(end)
    return sorted.slice(first, cursor.index)
  })
}

const buildWipOverTime = function buildWipOverTime(
  issues: Readonly<FlowIssueRow[]>,
  since: number,
  until: number,
): { date: string; count: number }[] {
  /*
   * PROJ-866: WIP-at-time-t is an interval-containment count (active during
   * [claimedAt, doneAt)). Instead of re-filtering every issue at every sampled day,
   * turn each issue into at most two delta events (+1 at claimedAt, -1 at doneAt) and
   * sweep a single running total across the sorted events as `t` advances — the
   * buckets loop and the event list are each walked once.
   */
  const events: [number, number][] = []
  Iterable.forEach(issues, (issue) => {
    if (Predicate.isNullish(issue.claimedAt)) {
      return
    }
    events.push([issue.claimedAt, ADD_TO_COUNT])
    if (Predicate.isNotNullish(issue.doneAt)) {
      events.push([issue.doneAt, REMOVE_FROM_COUNT])
    }
  })
  events.sort((left, right) => left[0] - right[0])

  const sweep = { count: NO_EVENTS, index: FIRST_ARRAY_INDEX }
  return buildBucketStarts(since, until, 'day').map((dayStart) => {
    while (sweep.index < events.length && events[sweep.index][0] <= dayStart) {
      sweep.count += events[sweep.index][1]
      sweep.index += ARRAY_INDEX_STEP
    }
    return fieldsInOrder([
      ['date', dateLabel(dayStart)],
      ['count', sweep.count],
    ])
  })
}

const completionTimestamps = function completionTimestamps(issues: Readonly<FlowIssueRow[]>): number[] {
  return Array.filterMap(issues, ({ doneAt }) =>
    Predicate.isNotNullish(doneAt) ? Result.succeed(doneAt) : Result.failVoid,
  )
}

const buildThroughputOverTime = function buildThroughputOverTime(
  issues: Readonly<FlowIssueRow[]>,
  window: MetricBucketWindow,
): { bucketStart: string; count: number }[] {
  const { ranges, starts } = metricBuckets(window)
  const groups = groupBySortedRanges(completionTimestamps(issues), Function.identity, ranges)
  return starts.map((bucketStart, idx) => ({ bucketStart: dateLabel(bucketStart), count: groups[idx].length }))
}

/*
 * PROJ-331: bug share of throughput, bucketed the same way as throughput. Untyped issues
 * (typeKey null) count toward the bucket total (so they aren't silently dropped from the
 * denominator) but never toward bugCount — "untyped" is treated as "not a bug", the same
 * as any other non-bug type. bugSharePercent is null (not 0) when a bucket completed
 * nothing, so an empty bucket reads as "no data" rather than "zero defects".
 */
const buildBugShareOverTime = function buildBugShareOverTime(
  issues: Readonly<FlowIssueRow[]>,
  window: MetricBucketWindow,
): { bucketStart: string; total: number; bugCount: number; bugSharePercent: number | null }[] {
  const { ranges, starts } = metricBuckets(window)
  const completed = Array.filterMap(issues, (issue) => {
    const { doneAt } = issue
    return Predicate.isNotNullish(doneAt) ? Result.succeed({ doneAt, typeKey: issue.typeKey }) : Result.failVoid
  })
  const groups = groupBySortedRanges(completed, (issue) => issue.doneAt, ranges)
  return starts.map((bucketStart, idx) => {
    const group = groups[idx]
    const bugCount = group.filter((issue) => issue.typeKey === 'bug').length
    return fieldsInOrder([
      ['bucketStart', dateLabel(bucketStart)],
      ['total', group.length],
      ['bugCount', bugCount],
      ['bugSharePercent', Array.isArrayNonEmpty(group) ? bugCount / group.length : JSON_NULL],
    ])
  })
}

/*
 * PROJ-328: review latency (in_review -> done) bucketed the same way as throughput, but
 * showing the bucket's p50 rather than a count — the "trend" the ticket asks for.
 */
const buildReviewLatencyOverTime = function buildReviewLatencyOverTime(
  issues: Readonly<FlowIssueRow[]>,
  window: MetricBucketWindow,
): { bucketStart: string; p50: number | null }[] {
  const { ranges, starts } = metricBuckets(window)
  const reviewed = Array.filterMap(issues, (issue) => {
    const { doneAt } = issue
    if (Predicate.isNullish(doneAt)) {
      return Result.failVoid
    }
    const { inReviewAt } = issue
    return Predicate.isNotNullish(inReviewAt) ? Result.succeed({ doneAt, inReviewAt }) : Result.failVoid
  })
  const groups = groupBySortedRanges(reviewed, (issue) => issue.doneAt, ranges)
  return starts.map((bucketStart, idx) => ({
    bucketStart: dateLabel(bucketStart),
    p50: summarize(groups[idx].map((issue) => issue.doneAt - issue.inReviewAt)).p50,
  }))
}

/*
 * PROJ-330: arrival vs completion — issues created vs issues completed per bucket, plus
 * the net (created - completed), bucketed the same way as throughput. Answers "is the
 * backlog growing or burning?" at a glance.
 */
const buildArrivalVsCompletion = function buildArrivalVsCompletion(
  issues: Readonly<FlowIssueRow[]>,
  window: MetricBucketWindow,
): { bucketStart: string; created: number; completed: number; net: number }[] {
  const { ranges, starts } = metricBuckets(window)
  const createdGroups = groupBySortedRanges(issues, (issue) => issue.createdAt, ranges)
  const completedGroups = groupBySortedRanges(completionTimestamps(issues), Function.identity, ranges)
  return starts.map((bucketStart, idx) => {
    const created = createdGroups[idx].length
    const done = completedGroups[idx].length
    return fieldsInOrder([
      ['bucketStart', dateLabel(bucketStart)],
      ['created', created],
      ['completed', done],
      ['net', created - done],
    ])
  })
}

/*
 * An issue's CFD band at a given sample instant is the furthest stage it has reached
 * by then (done > in_review > in_progress > backlog/todo), or excluded entirely if it
 * wasn't created yet. Order of checks matters: this is what makes the done band
 * monotonic non-decreasing (an issue never leaves it) once it's reached.
 */
type CfdBand = 'excluded' | 'backlogTodo' | 'inProgress' | 'inReview' | 'done'

interface CfdEvent {
  time: number
  band: Exclude<CfdBand, 'excluded'>
  delta: typeof ADD_TO_COUNT | typeof REMOVE_FROM_COUNT
}

const classifyCfdBand = function classifyCfdBand(issue: FlowIssueRow, sampleAt: number): CfdBand {
  if (issue.createdAt > sampleAt) {
    return 'excluded'
  }
  if (Predicate.isNotNullish(issue.doneAt) && issue.doneAt <= sampleAt) {
    return 'done'
  }
  if (Predicate.isNotNullish(issue.inReviewAt) && issue.inReviewAt <= sampleAt) {
    return 'inReview'
  }
  if (Predicate.isNotNullish(issue.claimedAt) && issue.claimedAt <= sampleAt) {
    return 'inProgress'
  }
  return 'backlogTodo'
}

const appendCfdEvent = function appendCfdEvent(
  events: CfdEvent[],
  time: number,
  { band, delta }: { band: CfdBand; delta: CfdEvent['delta'] },
): void {
  if (band === 'excluded') {
    return
  }
  events.push(
    fieldsInOrder([
      ['time', time],
      ['band', band],
      ['delta', delta],
    ]),
  )
}

/*
 * PROJ-866: precompute each issue's band-transition events instead of re-classifying
 * every issue at every sampled instant. classifyCfdBand is evaluated only at each
 * issue's OWN distinct timestamps (at most 4) — reusing the exact same priority logic
 * above, so this is not a re-derivation that could drift from it, just memoizing where
 * the band actually changes for that one issue. The resulting per-issue event list is
 * correct regardless of whether an issue's timestamps happen to be in the "expected"
 * created <= claimed <= in_review <= done order.
 */
const buildCfdEvents = function buildCfdEvents(issues: Readonly<FlowIssueRow[]>): CfdEvent[] {
  const events: CfdEvent[] = []
  Iterable.forEach(issues, (issue): void => {
    const thresholds = [
      ...new Set(
        [issue.createdAt, issue.claimedAt, issue.inReviewAt, issue.doneAt].filter((timestamp) =>
          Predicate.isNotNullish(timestamp),
        ),
      ),
    ].toSorted((left, right) => left - right)
    Iterable.reduce<number, CfdBand>(thresholds, 'excluded', (previousBand, threshold) => {
      const band = classifyCfdBand(issue, threshold)
      if (band !== previousBand) {
        appendCfdEvent(events, threshold, { band: previousBand, delta: REMOVE_FROM_COUNT })
        appendCfdEvent(events, threshold, { band, delta: ADD_TO_COUNT })
      }
      return band
    })
  })
  events.sort((left, right) => left.time - right.time)
  return events
}

/*
 * PROJ-329: cumulative flow diagram bands, sampled at each bucket's end (clamped to
 * `until`/`now`) from the write-once transition timestamps.
 *
 * PROJ-377: sampling at the bucket's *end* (not its start) matters for the always-
 * partial current bucket — a bucket-start sample lands before any activity in that
 * bucket has happened, so a bucket-worth of newly created/completed issues reads as
 * all zeros even though `arrivalVsCompletionOverTime` (which counts events across the
 * whole bucket range) shows them. `now` additionally clamps so we never sample into
 * the future when `until` extends past the present.
 *
 * PROJ-866: one pass over the (small, per-issue) event list instead of reclassifying
 * every issue at every bucket — the sampleAt sequence is non-decreasing across buckets
 * (each is min(bucket-end, until, now)), so a single running-counts object plus a
 * monotonic pointer into the sorted event list reproduces exactly what re-running
 * classifyCfdBand per bucket would have produced.
 */
const buildCfdOverTime = function buildCfdOverTime(
  issues: Readonly<FlowIssueRow[]>,
  { granularity, since, until }: MetricBucketWindow,
  { doneBeforeWindow, now }: { doneBeforeWindow: number; now: number },
): {
  bucketStart: string
  backlogTodo: number
  inProgress: number
  inReview: number
  done: number
}[] {
  const bucketSize = bucketSizeFor(granularity)
  const starts = buildBucketStarts(since, until, granularity)
  const events = buildCfdEvents(issues)
  /*
   * PROJ-866: issues done before the SQL window's lower bound aren't loaded, but they
   * are in the done band at every sample (each sample is >= that bound), so the band
   * starts from their count instead of zero.
   */
  const counts: Record<CfdEvent['band'], number> = fieldsInOrder([
    ['backlogTodo', NO_EVENTS],
    ['inProgress', NO_EVENTS],
    ['inReview', NO_EVENTS],
    ['done', doneBeforeWindow],
  ])
  const cursor = { index: FIRST_ARRAY_INDEX }
  return starts.map((bucketStart) => {
    const sampleAt = Math.min(bucketStart + bucketSize - TIMESTAMP_STEP_SECONDS, until, now)
    while (cursor.index < events.length && events[cursor.index].time <= sampleAt) {
      const event = events[cursor.index]
      counts[event.band] += event.delta
      cursor.index += ARRAY_INDEX_STEP
    }
    return fieldsInOrder([
      ['bucketStart', dateLabel(bucketStart)],
      ['backlogTodo', counts.backlogTodo],
      ['inProgress', counts.inProgress],
      ['inReview', counts.inReview],
      ['done', counts.done],
    ])
  })
}

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
const fetchHumanCommentCounts = async function fetchHumanCommentCounts(
  orm: ReturnType<typeof drizzle>,
  issueScope: SQL,
): Promise<Map<string, number>> {
  const rows = await orm
    .select({ issueId: schema.issueComments.issueId, n: sql<number>`count(*)` })
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
const fetchLeaseHeldSeconds = async function fetchLeaseHeldSeconds(
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

const computeCoreDistributions = function computeCoreDistributions(
  issues: Readonly<FlowIssueRow[]>,
  inWindow: (timestamp: number) => boolean,
): {
  leadTimes: number[]
  cycleTimes: number[]
  reviewLatencies: number[]
  timeInProgress: number[]
} {
  const leadTimes = issues
    .filter(
      (issue) =>
        Predicate.isNotNullish(issue.readyAt) && Predicate.isNotNullish(issue.doneAt) && inWindow(issue.doneAt),
    )
    // Filtered above
    .map((issue) => issue.doneAt! - issue.readyAt!)
  const cycleTimes = issues
    .filter(
      (issue) =>
        Predicate.isNotNullish(issue.claimedAt) && Predicate.isNotNullish(issue.doneAt) && inWindow(issue.doneAt),
    )
    // Filtered above
    .map((issue) => issue.doneAt! - issue.claimedAt!)
  const reviewLatencies = issues
    .filter(
      (issue) =>
        Predicate.isNotNullish(issue.inReviewAt) && Predicate.isNotNullish(issue.doneAt) && inWindow(issue.doneAt),
    )
    // Filtered above
    .map((issue) => issue.doneAt! - issue.inReviewAt!)
  // PROJ-329: time in in_progress = claimed -> the issue's next recorded stage
  // (entering review, or done directly for issues that skipped review).
  const timeInProgress = issues
    .filter(
      (issue) =>
        Predicate.isNotNullish(issue.claimedAt) && Predicate.isNotNullish(issue.doneAt) && inWindow(issue.doneAt),
    )
    // Filtered above
    .map((issue) => (issue.inReviewAt ?? issue.doneAt!) - issue.claimedAt!)
  return fieldsInOrder([
    ['leadTimes', leadTimes],
    ['cycleTimes', cycleTimes],
    ['reviewLatencies', reviewLatencies],
    ['timeInProgress', timeInProgress],
  ])
}

/*
 * PROJ-328: human interventions per completed issue = human comments + status bounces
 * out of review. The primary "how much human attention did this take" signal.
 */
const computeHumanInterventions = function computeHumanInterventions(
  issues: Readonly<FlowIssueRow[]>,
  humanCommentCounts: Map<string, number>,
  inWindow: (timestamp: number) => boolean,
): number[] {
  return issues
    .filter((issue) => Predicate.isNotNullish(issue.doneAt) && inWindow(issue.doneAt))
    .map((issue) => (humanCommentCounts.get(issue.id) ?? NO_EVENTS) + issue.reviewBounceCount)
}

/*
 * PROJ-328: autonomy ratio per completed issue = lease-held time / cycle time. Clamped
 * to [0, 1] — sequential re-leases can sum close to the full cycle but shouldn't exceed it.
 */
const computeAutonomyRatios = function computeAutonomyRatios(
  issues: Readonly<FlowIssueRow[]>,
  leaseHeldSeconds: Map<string, number>,
  inWindow: (timestamp: number) => boolean,
): number[] {
  return issues
    .filter(
      (issue) =>
        Predicate.isNotNullish(issue.claimedAt) && Predicate.isNotNullish(issue.doneAt) && inWindow(issue.doneAt),
    )
    .map((issue) => {
      // Filtered above
      const cycle = issue.doneAt! - issue.claimedAt!
      if (cycle <= MIN_DURATION_SECONDS) {
        return EMPTY_RATIO
      }
      const held = leaseHeldSeconds.get(issue.id) ?? MIN_DURATION_SECONDS
      return Math.min(FULL_RATIO, held / cycle)
    })
}

/*
 * PROJ-330: flow efficiency per completed issue = lease-held time / lead time (lead time
 * = done - ready, i.e. time since the issue was ready to work, not since it was claimed).
 * This is deliberately distinct from PROJ-328's autonomyRatio (lease-held / cycle time =
 * done - claimed): flow efficiency also counts queueing time between ready and claimed as
 * "waste", so it's always <= autonomyRatio for the same issue. Clamped to [0, 1] for the
 * same reason as autonomyRatio (sequential re-leases can sum close to the full lead time).
 */
const computeFlowEfficiencies = function computeFlowEfficiencies(
  issues: Readonly<FlowIssueRow[]>,
  leaseHeldSeconds: Map<string, number>,
  inWindow: (timestamp: number) => boolean,
): number[] {
  return issues
    .filter(
      (issue) =>
        Predicate.isNotNullish(issue.readyAt) && Predicate.isNotNullish(issue.doneAt) && inWindow(issue.doneAt),
    )
    .map((issue) => {
      // Filtered above
      const leadTime = issue.doneAt! - issue.readyAt!
      if (leadTime <= MIN_DURATION_SECONDS) {
        return EMPTY_RATIO
      }
      const held = leaseHeldSeconds.get(issue.id) ?? MIN_DURATION_SECONDS
      return Math.min(FULL_RATIO, held / leadTime)
    })
}

/*
 * PROJ-330: aging-WIP scatter — every currently open (in_progress/in_review) issue with
 * its age since claim. Not scoped to since/until (it's a present-state snapshot, not a
 * historical series — PROJ-866 loads open issues past the window bounds for it alone); the p50/p90 reference lines the UI overlays come from the window-
 * scoped cycleTime distribution already returned alongside this, so the chart still
 * reflects the shared date-range controls. Surfaces items stuck long enough to be worth
 * investigating before they finish and pollute the cycle-time percentiles.
 */
const buildAgingWip = function buildAgingWip(
  issues: Readonly<FlowIssueRow[]>,
  now: number,
): { id: string; status: 'in_progress' | 'in_review'; ageSeconds: number }[] {
  return Array.filterMap(issues, (issue) => {
    const { claimedAt } = issue
    if (Predicate.isNullish(claimedAt)) {
      return Result.failVoid
    }
    const { status } = issue
    if (status !== 'in_progress' && status !== 'in_review') {
      return Result.failVoid
    }
    return Result.succeed(
      fieldsInOrder([
        ['id', issue.id],
        ['status', status],
        ['ageSeconds', now - claimedAt],
      ]),
    )
  })
}

/*
 * PROJ-334: factory-health tiles — fault signals for the machinery itself, not the
 * work. Each count is windowed by when the fault EVENT happened (released_at /
 * occurred_at), not by an issue's doneAt like the distribution tiles above, since a
 * lease expiry or abandoned claim can happen on an issue that never completes in this
 * window (or ever). All counts are project-scoped the same way the rest of this
 * endpoint is.
 */
interface FactoryHealth {
  leaseExpiries: number
  abandonedClaims: number
  gateRejections: number
  wipCapPressure: number
}

/*
 * PROJ-866: the four factory-health counts and the CFD's done-before-window count are
 * independent scalar COUNT(*)s, so they run as subqueries of one statement (anchored on
 * the project row) instead of five round trips that each fetched every matching row.
 */
const fetchWindowCounts = async function fetchWindowCounts(
  orm: ReturnType<typeof drizzle>,
  workspaceId: string,
  projectId: string,
  opts: Readonly<{
    since: number
    until: number
    doneBefore: number | undefined
    createdUntil: number
  }>,
): Promise<FactoryHealth & { doneBeforeWindow: number }> {
  const { since, until } = opts
  const countOf = (query: SQLWrapper): SQL<number> => sql<number>`(${query})`
  const count = sql<number>`count(*)`
  const leaseExpiriesQuery = orm
    .select({ n: count })
    .from(schema.issueLeases)
    .innerJoin(schema.issues, eq(schema.issueLeases.issueId, schema.issues.id))
    .where(
      and(
        eq(schema.issueLeases.workspaceId, workspaceId),
        eq(schema.issues.projectId, projectId),
        eq(schema.issueLeases.releaseReason, 'expired'),
        gte(schema.issueLeases.releasedAt, since),
        lte(schema.issueLeases.releasedAt, until),
      ),
    )
  const abandonedClaimsQuery = orm
    .select({ n: count })
    .from(schema.issueFileClaims)
    .innerJoin(schema.issues, eq(schema.issueFileClaims.issueId, schema.issues.id))
    .where(
      and(
        eq(schema.issueFileClaims.workspaceId, workspaceId),
        eq(schema.issues.projectId, projectId),
        eq(schema.issueFileClaims.releaseReason, 'agent_ended'),
        gte(schema.issueFileClaims.releasedAt, since),
        lte(schema.issueFileClaims.releasedAt, until),
      ),
    )
  const gateRejectionsQuery = orm
    .select({ n: count })
    .from(schema.issueGateRejections)
    .innerJoin(schema.issues, eq(schema.issueGateRejections.issueId, schema.issues.id))
    .where(
      and(
        eq(schema.issueGateRejections.workspaceId, workspaceId),
        eq(schema.issues.projectId, projectId),
        gte(schema.issueGateRejections.occurredAt, since),
        lte(schema.issueGateRejections.occurredAt, until),
      ),
    )
  // PROJ-342: WIP-cap denials — claims rejected for hitting the per-project agent
  // WIP cap. Recorded at the denial site in claimIssue (services/issue-leases.ts).
  const wipCapPressureQuery = orm
    .select({ n: count })
    .from(schema.wipCapDenials)
    .where(
      and(
        eq(schema.wipCapDenials.workspaceId, workspaceId),
        eq(schema.wipCapDenials.projectId, projectId),
        gte(schema.wipCapDenials.occurredAt, since),
        lte(schema.wipCapDenials.occurredAt, until),
      ),
    )
  const doneBeforeWindowQuery = Predicate.isNullish(opts.doneBefore)
    ? undefined
    : orm
        .select({ n: count })
        .from(schema.issues)
        .where(
          and(
            eq(schema.issues.workspaceId, workspaceId),
            eq(schema.issues.projectId, projectId),
            lte(schema.issues.createdAt, opts.createdUntil),
            sql`${schema.issues.doneAt} < ${opts.doneBefore}`,
          ),
        )
  const row = await orm
    .select(
      fieldsInOrder([
        ['leaseExpiries', countOf(leaseExpiriesQuery)],
        ['abandonedClaims', countOf(abandonedClaimsQuery)],
        ['gateRejections', countOf(gateRejectionsQuery)],
        ['wipCapPressure', countOf(wipCapPressureQuery)],
        [
          'doneBeforeWindow',
          Predicate.isNullish(doneBeforeWindowQuery) ? sql<number>`0` : countOf(doneBeforeWindowQuery),
        ],
      ]),
    )
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, workspaceId)))
    .get()

  return fieldsInOrder([
    ['leaseExpiries', Number(row?.leaseExpiries ?? NO_EVENTS)],
    ['abandonedClaims', Number(row?.abandonedClaims ?? NO_EVENTS)],
    ['gateRejections', Number(row?.gateRejections ?? NO_EVENTS)],
    ['wipCapPressure', Number(row?.wipCapPressure ?? NO_EVENTS)],
    ['doneBeforeWindow', Number(row?.doneBeforeWindow ?? NO_EVENTS)],
  ])
}

const readFlowMetrics = async function readFlowMetrics(
  db: D1Database,
  workspaceId: string,
  range: FlowMetricsRange,
  now: number,
) {
  const { projectId, since, until, granularity } = range
  const orm = drizzle(db, { schema })

  const defaults = flowMetricsDefaultStarts(now)
  const wipSince = since ?? defaults.wipSince
  const wipUntil = until ?? now
  // Default window = the current ISO week plus the preceding 5 weeks (6 weeks total).
  const throughputSince = since ?? defaults.bucketSince
  const throughputUntil = until ?? now

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
    fetchWindowCounts(orm, workspaceId, projectId, {
      createdUntil,
      doneBefore,
      since: throughputSince,
      until: throughputUntil,
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

export type FlowMetrics = Awaited<ReturnType<typeof readFlowMetrics>>

/** Pure reads and domain calculations, executed only when the caller runs the Effect. */
export const getFlowMetrics = function getFlowMetrics(
  db: D1Database,
  workspaceId: string,
  range: FlowMetricsRange,
  now?: number,
): Effect.Effect<FlowMetrics, DataQueryError> {
  return queryEffect('getFlowMetrics', () => readFlowMetrics(db, workspaceId, range, now ?? currentEpochSeconds()))
}
