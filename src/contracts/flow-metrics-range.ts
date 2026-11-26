import { DAYS_PER_WEEK, SECONDS_PER_DAY, SECONDS_PER_WEEK } from './time.ts'

const FIRST_MONDAY_EPOCH_DAY = 4
const SUNDAY_TO_MONDAY_INDEX_OFFSET = 6
const DEFAULT_BUCKET_HISTORY_WEEKS = 5
const DEFAULT_WIP_HISTORY_DAYS = 30

/**
 * Align the timestamp to the start of its UTC ISO week.
 *
 * @param {number} timestamp Unix seconds before or after the epoch.
 * @returns {number} The aligned timestamp in Unix seconds.
 */
export const mondayAtOrBefore = function mondayAtOrBefore(timestamp: number): number {
  const dayIndex = Math.floor(timestamp / SECONDS_PER_DAY)
  const daysSinceMonday = ((dayIndex % DAYS_PER_WEEK) + DAYS_PER_WEEK - FIRST_MONDAY_EPOCH_DAY) % DAYS_PER_WEEK
  return (dayIndex - daysSinceMonday) * SECONDS_PER_DAY
}

/**
 * Return the Monday that starts the default reporting window, five weeks before the current Monday.
 *
 * @param {Date} now The reference date.
 * @returns {Date} The start of the reporting window at midnight UTC.
 */
export const defaultFlowMetricsStartDate = function defaultFlowMetricsStartDate(now: Date): Date {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dayOfMonth = monday.getUTCDate()
  const daysSinceMonday = (monday.getUTCDay() + SUNDAY_TO_MONDAY_INDEX_OFFSET) % DAYS_PER_WEEK
  monday.setUTCDate(dayOfMonth - daysSinceMonday - DEFAULT_BUCKET_HISTORY_WEEKS * DAYS_PER_WEEK)
  return monday
}

/**
 * Use the same default starts for validation and bucket generation.
 *
 * @param {number} now The current timestamp in Unix seconds.
 * @returns {{bucketSince: number, wipSince: number}} The default times for regular buckets and work in progress.
 */
export const flowMetricsDefaultStarts = function flowMetricsDefaultStarts(now: number): {
  bucketSince: number
  wipSince: number
} {
  return {
    bucketSince: mondayAtOrBefore(now) - DEFAULT_BUCKET_HISTORY_WEEKS * SECONDS_PER_WEEK,
    wipSince: now - DEFAULT_WIP_HISTORY_DAYS * SECONDS_PER_DAY,
  }
}
