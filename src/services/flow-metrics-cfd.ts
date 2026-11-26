import { Iterable, Predicate } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { NO_EVENTS } from './flow-metrics-distributions.ts'
import type { FlowIssueRow } from './flow-metrics-distributions.ts'
import {
  ADD_TO_COUNT,
  ARRAY_INDEX_STEP,
  FIRST_ARRAY_INDEX,
  REMOVE_FROM_COUNT,
  TIMESTAMP_STEP_SECONDS,
  bucketSizeFor,
  buildBucketStarts,
  dateLabel,
} from './flow-metrics-series.ts'
import type { MetricBucketWindow } from './flow-metrics-series.ts'

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
export const buildCfdOverTime = function buildCfdOverTime(
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
