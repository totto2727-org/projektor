import { Predicate } from 'effect'
import { z } from 'zod'

import { currentEpochSeconds } from '#contracts/time.ts'

const DAY = 86_400

/*
 * Unix epoch day 0 (1970-01-01) was a Thursday; align to the preceding Monday so
 * week boundaries read as conventional (ISO) weeks rather than landing on Thursdays.
 */
export const mondayAtOrBefore = function mondayAtOrBefore(t: number): number {
  const dayIndex = Math.floor(t / DAY)
  const daysSinceMonday = ((dayIndex % 7) + 7 - 4) % 7 // Day 0 (Thu) is 4 days after Monday
  return (dayIndex - daysSinceMonday) * DAY
}

/*
 * The lower bounds services/flow-metrics.ts uses when `since` is omitted. They live here
 * so the span validation below checks the window the service will actually compute,
 * not a guess at it: bucket series default to the current ISO week plus the preceding
 * 5 weeks, and wipOverTime (always day-sampled) to the last 30 days.
 */
export const flowMetricsDefaultStarts = function flowMetricsDefaultStarts(now: number): {
  bucketSince: number
  wipSince: number
} {
  return { bucketSince: mondayAtOrBefore(now) - 5 * 7 * DAY, wipSince: now - 30 * DAY }
}

/*
 * PROJ-866: an unbounded since/until (e.g. since=0 with day granularity) generated
 * tens of thousands of buckets — each iterating the whole issue set — for a single
 * request. Bound the requestable window per granularity so both the bucket count and
 * the SQL-side issue scan (see services/flow-metrics.ts) stay bounded regardless of
 * what a caller passes. `since`/`until` stay individually optional; a missing bound is
 * filled with the service's real default (above, or "now" for `until`) for the check.
 */
const MAX_DAY_WINDOW_SECONDS = 366 * DAY
const MAX_WEEK_WINDOW_SECONDS = 5 * 365 * DAY

export const GetFlowMetricsSchema = z
  .object({
    projectId: z.string().nonempty(),
    since: z.number().int().nonnegative().optional(),
    until: z.number().int().nonnegative().optional(),
    granularity: z.enum(['day', 'week']).default('week'),
  })
  .superRefine((data, ctx) => {
    if (Predicate.isNullish(data.since) && Predicate.isNullish(data.until)) {
      return
    }
    const now = currentEpochSeconds()
    let effSince: number
    let effUntil: number
    if (Predicate.isNotNullish(data.since)) {
      effSince = data.since
      effUntil = data.until ?? now
      if (effUntil < effSince) {
        ctx.addIssue({
          code: 'custom',
          message: 'until must be >= since',
          path: ['until'],
        })
        return
      }
    } else {
      /*
       * `until` only: the service starts from its defaults. An `until` before them
       * is valid and just yields empty series (as it always has), so there is no
       * ordering error here; only the span from the earliest default start is capped.
       */
      const defaults = flowMetricsDefaultStarts(now)
      effSince = Math.min(defaults.bucketSince, defaults.wipSince)
      effUntil = data.until as number
    }
    const maxRange = data.granularity === 'day' ? MAX_DAY_WINDOW_SECONDS : MAX_WEEK_WINDOW_SECONDS
    if (effUntil - effSince > maxRange) {
      ctx.addIssue({
        code: 'custom',
        message:
          data.granularity === 'day'
            ? 'Window too large for granularity "day": max 366 days'
            : 'Window too large for granularity "week": max 5 years',
        path: [Predicate.isNotNullish(data.since) ? 'since' : 'until'],
      })
    }
  })
