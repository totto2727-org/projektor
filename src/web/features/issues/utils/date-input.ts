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

/** "YYYY-MM-DD" → unix seconds at local midnight; empty/invalid → null. */
export const dateInputToUnix = function dateInputToUnix(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim())
  if (!match) {
    return null
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / MILLISECONDS_PER_SECOND)
}

/** Unix seconds → "YYYY-MM-DD" in local time; null → "". */
export const unixToDateInput = function unixToDateInput(ts: number | null | undefined): string {
  if (ts === null || Predicate.isNullish(ts)) {
    return ''
  }
  const date = new Date(ts * MILLISECONDS_PER_SECOND)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Unix seconds → a UTC date for display; null → "—". */
export const formatUnixDate = function formatUnixDate(ts: number | null | undefined): string {
  if (ts === null || Predicate.isNullish(ts)) {
    return '—'
  }
  return formatTimestampDate(ts)
}
