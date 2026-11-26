import { Array, Predicate, Result } from 'effect'

import { JSON_NULL } from '#contracts/json-null.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

export const MIN_DURATION_SECONDS = 0

const LAST_INDEX_OFFSET = 1

const MEDIAN_FRACTION = 0.5

const P90_FRACTION = 0.9

export const NO_EVENTS = 0

const EMPTY_RATIO = 0

const FULL_RATIO = 1

export interface Distribution {
  count: number
  avg: number | null
  p50: number | null
  p90: number | null
}

export const summarize = function summarize(durations: Readonly<number[]>): Distribution {
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

export interface FlowIssueRow {
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

type IssueStartTimeField = 'readyAt' | 'claimedAt' | 'inReviewAt'

interface CompletedIssueTiming {
  completedAt: number
  duration: number
  issue: FlowIssueRow
  startedAt: number
}

const completedIssueTimings = function completedIssueTimings(
  issues: Readonly<FlowIssueRow[]>,
  startField: IssueStartTimeField,
  inWindow: (timestamp: number) => boolean,
): CompletedIssueTiming[] {
  return Array.filterMap(issues, (issue) => {
    const startedAt = issue[startField]
    if (Predicate.isNullish(startedAt)) {
      return Result.failVoid
    }
    const completedAt = issue.doneAt
    return Predicate.isNotNullish(completedAt) && inWindow(completedAt)
      ? Result.succeed({ completedAt, duration: completedAt - startedAt, issue, startedAt })
      : Result.failVoid
  })
}

export const computeCoreDistributions = function computeCoreDistributions(
  issues: Readonly<FlowIssueRow[]>,
  inWindow: (timestamp: number) => boolean,
): {
  leadTimes: number[]
  cycleTimes: number[]
  reviewLatencies: number[]
  timeInProgress: number[]
} {
  const leadTimes = completedIssueTimings(issues, 'readyAt', inWindow).map((timing) => timing.duration)
  const cycleTimes = completedIssueTimings(issues, 'claimedAt', inWindow).map((timing) => timing.duration)
  const reviewLatencies = completedIssueTimings(issues, 'inReviewAt', inWindow).map((timing) => timing.duration)
  // PROJ-329: time in in_progress = claimed -> the issue's next recorded stage
  // (entering review, or done directly for issues that skipped review).
  const timeInProgress = completedIssueTimings(issues, 'claimedAt', inWindow).map(
    ({ completedAt, issue, startedAt }) => (issue.inReviewAt ?? completedAt) - startedAt,
  )
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
export const computeHumanInterventions = function computeHumanInterventions(
  issues: Readonly<FlowIssueRow[]>,
  humanCommentCounts: Map<string, number>,
  inWindow: (timestamp: number) => boolean,
): number[] {
  return issues
    .filter((issue) => Predicate.isNotNullish(issue.doneAt) && inWindow(issue.doneAt))
    .map((issue) => (humanCommentCounts.get(issue.id) ?? NO_EVENTS) + issue.reviewBounceCount)
}

const leaseRatio = function leaseRatio(
  { duration, issue }: CompletedIssueTiming,
  leaseHeldSeconds: ReadonlyMap<string, number>,
): number {
  if (duration <= MIN_DURATION_SECONDS) {
    return EMPTY_RATIO
  }
  const held = leaseHeldSeconds.get(issue.id) ?? MIN_DURATION_SECONDS
  return Math.min(FULL_RATIO, held / duration)
}

/*
 * PROJ-328: autonomy ratio per completed issue = lease-held time / cycle time. Clamped
 * to [0, 1] — sequential re-leases can sum close to the full cycle but shouldn't exceed it.
 */
export const computeAutonomyRatios = function computeAutonomyRatios(
  issues: Readonly<FlowIssueRow[]>,
  leaseHeldSeconds: Map<string, number>,
  inWindow: (timestamp: number) => boolean,
): number[] {
  return completedIssueTimings(issues, 'claimedAt', inWindow).map((timing) => leaseRatio(timing, leaseHeldSeconds))
}

/*
 * PROJ-330: flow efficiency per completed issue = lease-held time / lead time (lead time
 * = done - ready, i.e. time since the issue was ready to work, not since it was claimed).
 * This is deliberately distinct from PROJ-328's autonomyRatio (lease-held / cycle time =
 * done - claimed): flow efficiency also counts queueing time between ready and claimed as
 * "waste", so it's always <= autonomyRatio for the same issue. Clamped to [0, 1] for the
 * same reason as autonomyRatio (sequential re-leases can sum close to the full lead time).
 */
export const computeFlowEfficiencies = function computeFlowEfficiencies(
  issues: Readonly<FlowIssueRow[]>,
  leaseHeldSeconds: Map<string, number>,
  inWindow: (timestamp: number) => boolean,
): number[] {
  return completedIssueTimings(issues, 'readyAt', inWindow).map((timing) => leaseRatio(timing, leaseHeldSeconds))
}

/*
 * PROJ-330: aging-WIP scatter — every currently open (in_progress/in_review) issue with
 * its age since claim. Not scoped to since/until (it's a present-state snapshot, not a
 * historical series — PROJ-866 loads open issues past the window bounds for it alone); the p50/p90 reference lines the UI overlays come from the window-
 * scoped cycleTime distribution already returned alongside this, so the chart still
 * reflects the shared date-range controls. Surfaces items stuck long enough to be worth
 * investigating before they finish and pollute the cycle-time percentiles.
 */
export const buildAgingWip = function buildAgingWip(
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
