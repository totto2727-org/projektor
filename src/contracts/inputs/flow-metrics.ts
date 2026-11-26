import { Predicate } from 'effect'
import { z } from 'zod'

import { flowMetricsDefaultStarts } from '#contracts/flow-metrics-range.ts'
import { SECONDS_PER_DAY, currentEpochSeconds } from '#contracts/time.ts'

import { objectInOrder } from './common.ts'

export { flowMetricsDefaultStarts, mondayAtOrBefore } from '#contracts/flow-metrics-range.ts'

/*
 * PROJ-866: an unbounded since/until (e.g. since=0 with day granularity) generated
 * tens of thousands of buckets — each iterating the whole issue set — for a single
 * request. Bound the requestable window per granularity so both the bucket count and
 * the SQL-side issue scan (see services/flow-metrics.ts) stay bounded regardless of
 * what a caller passes. `since`/`until` stay individually optional; a missing bound is
 * filled with the service's real default (above, or "now" for `until`) for the check.
 */
const MAX_DAILY_WINDOW_DAYS = 366
const MAX_WEEKLY_WINDOW_YEARS = 5
const DAYS_PER_COMMON_YEAR = 365
const MAX_DAY_WINDOW_SECONDS = MAX_DAILY_WINDOW_DAYS * SECONDS_PER_DAY
const MAX_WEEK_WINDOW_SECONDS = MAX_WEEKLY_WINDOW_YEARS * DAYS_PER_COMMON_YEAR * SECONDS_PER_DAY

type FlowGranularity = 'day' | 'week'

interface FlowWindow {
  granularity: FlowGranularity
  path: 'since' | 'until'
  since: number
  until: number
}

const checkFlowWindowSpan = function checkFlowWindowSpan(
  context: z.RefinementCtx,
  { granularity, path, since, until }: FlowWindow,
): void {
  const maxRange = granularity === 'day' ? MAX_DAY_WINDOW_SECONDS : MAX_WEEK_WINDOW_SECONDS
  if (until - since > maxRange) {
    context.addIssue({
      code: 'custom',
      message:
        granularity === 'day'
          ? 'Window too large for granularity "day": max 366 days'
          : 'Window too large for granularity "week": max 5 years',
      path: [path],
    })
  }
}

const checkFlowWindowWithSince = function checkFlowWindowWithSince(
  context: z.RefinementCtx,
  { granularity, since, until }: { granularity: FlowGranularity; since: number; until: number | undefined },
): void {
  const now = currentEpochSeconds()
  const end = until ?? now
  if (end < since) {
    context.addIssue({
      code: 'custom',
      message: 'until must be >= since',
      path: ['until'],
    })
    return
  }
  checkFlowWindowSpan(context, { granularity, path: 'since', since, until: end })
}

export const GetFlowMetricsSchema = objectInOrder([
  ['projectId', z.string().nonempty()],
  ['since', z.number().int().nonnegative().optional()],
  ['until', z.number().int().nonnegative().optional()],
  ['granularity', z.enum(['day', 'week']).default('week')],
]).superRefine((data, context) => {
  const { granularity, since, until } = data
  if (Predicate.isNotNullish(since)) {
    checkFlowWindowWithSince(context, { granularity, since, until })
    return
  }
  if (Predicate.isNotNullish(until)) {
    /*
     * `until` only: the service starts from its defaults. An `until` before them
     * is valid and just yields empty series (as it always has), so there is no
     * ordering error here; only the span from the earliest default start is capped.
     */
    const defaults = flowMetricsDefaultStarts(currentEpochSeconds())
    const start = Math.min(defaults.bucketSince, defaults.wipSince)
    checkFlowWindowSpan(context, { granularity, path: 'until', since: start, until })
  }
})
