import { Predicate } from 'effect'

import { MILLISECONDS_PER_SECOND } from '#contracts/time.ts'
import { formatTimestampDate } from '@/features/timestamp.ts'

/*
 * PROJ-875: one conversion pair between <input type="date"> strings ("YYYY-MM-DD") and
 * the API's unix seconds. Both directions use LOCAL midnight, so a date typed in and
 * read back is the same calendar day in every timezone. (`new Date("YYYY-MM-DD")`
 * parses as UTC midnight, which read back through local getters shifts the date a day
 * earlier anywhere west of UTC.)
 */

/**
 * "YYYY-MM-DD" → unix seconds at local midnight; empty/invalid → null.
 *
 * @param {string} value The date input text.
 * @returns {number | null} Local midnight in Unix seconds, or null if the input cannot be converted.
 */
export const dateInputToUnix = function dateInputToUnix(value: string): number | null {
  const parts = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(value.trim())?.groups
  if (!parts) {
    return null
  }
  const date = new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day))
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / MILLISECONDS_PER_SECOND)
}

/**
 * Unix seconds → "YYYY-MM-DD" in local time; null → "".
 *
 * @param {number | null | undefined} ts The Unix timestamp in seconds, when supplied.
 * @returns {string} The local calendar date for the input, or an empty string when absent.
 */
export const unixToDateInput = function unixToDateInput(ts: number | null | undefined): string {
  if (Predicate.isNullish(ts)) {
    return ''
  }
  const date = new Date(ts * MILLISECONDS_PER_SECOND)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Unix seconds → a UTC date for display; null → "—".
 *
 * @param {number | null | undefined} ts The Unix timestamp in seconds, when supplied.
 * @returns {string} The formatted UTC date, or an em dash when absent.
 */
export const formatUnixDate = function formatUnixDate(ts: number | null | undefined): string {
  if (Predicate.isNullish(ts)) {
    return '—'
  }
  return formatTimestampDate(ts)
}
