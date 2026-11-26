import { Array, DateTime, Function, Iterable, Option, Predicate, Result } from 'effect'

import { flowMetricsDefaultStarts, mondayAtOrBefore } from '#contracts/flow-metrics-range.ts'
import { JSON_NULL } from '#contracts/json-null.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { SECONDS_PER_DAY, SECONDS_PER_WEEK, formatUtcDatePrefix } from '#contracts/time.ts'

import { NO_EVENTS, summarize } from './flow-metrics-distributions.ts'
import type { FlowIssueRow } from './flow-metrics-distributions.ts'

export const FIRST_ARRAY_INDEX = 0

export const ARRAY_INDEX_STEP = 1

export const TIMESTAMP_STEP_SECONDS = 1

export const ADD_TO_COUNT = 1

export const REMOVE_FROM_COUNT = -1

export interface MetricBucketWindow {
  since: number
  until: number
  granularity: 'day' | 'week'
}

interface BucketRange {
  start: number
  end: number
}

export const dateLabel = function dateLabel(timestamp: number): string {
  return formatUtcDatePrefix(DateTime.toDateUtc(DateTime.fromEpochSeconds(timestamp)))
}

export const bucketSizeFor = function bucketSizeFor(granularity: 'day' | 'week'): number {
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
export const buildBucketStarts = function buildBucketStarts(
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

export const buildWipOverTime = function buildWipOverTime(
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

export const buildThroughputOverTime = function buildThroughputOverTime(
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
export const buildBugShareOverTime = function buildBugShareOverTime(
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
export const buildReviewLatencyOverTime = function buildReviewLatencyOverTime(
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
export const buildArrivalVsCompletion = function buildArrivalVsCompletion(
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

export const resolveFlowMetricWindows = function resolveFlowMetricWindows(
  { since, until }: { since: number | undefined; until: number | undefined },
  now: number,
): { throughputSince: number; throughputUntil: number; wipSince: number; wipUntil: number } {
  const defaults = flowMetricsDefaultStarts(now)
  const wipSince = since ?? defaults.wipSince
  const wipUntil = until ?? now
  // Default window = the current ISO week plus the preceding 5 weeks (6 weeks total).
  const throughputSince = since ?? defaults.bucketSince
  const throughputUntil = until ?? now
  return { throughputSince, throughputUntil, wipSince, wipUntil }
}
