import { DateTime, Option } from 'effect'

import { MILLISECONDS_PER_SECOND } from '#contracts/time.ts'

const ISO_DATE_LENGTH = 10
const ISO_PREFIX_START = 0
const ISO_SECONDS_PREFIX_LENGTH = 19
const INVALID_DATE_TEXT = 'Invalid Date'

const toIsoTimestamp = function toIsoTimestamp(seconds: number): Option.Option<string> {
  return Option.map(DateTime.make(seconds * MILLISECONDS_PER_SECOND), DateTime.formatIso)
}

/**
 * Display API timestamps in UTC during SSR and hydration.
 *
 * @param {number} seconds Unix timestamp in seconds.
 * @returns {string} The UTC date and time or the invalid-date display.
 */
export const formatTimestamp = function formatTimestamp(seconds: number): string {
  return Option.match(toIsoTimestamp(seconds), {
    onNone: () => INVALID_DATE_TEXT,
    onSome: (iso) => `${iso.slice(ISO_PREFIX_START, ISO_SECONDS_PREFIX_LENGTH).replace('T', ' ')} UTC`,
  })
}

/**
 * Display the UTC calendar day. Date-input parsing keeps its local-midnight contract.
 *
 * @param {number} seconds Unix timestamp in seconds.
 * @returns {string} The UTC calendar day or the invalid-date display.
 */
export const formatTimestampDate = function formatTimestampDate(seconds: number): string {
  return Option.match(toIsoTimestamp(seconds), {
    onNone: () => INVALID_DATE_TEXT,
    onSome: (iso) => `${iso.slice(ISO_PREFIX_START, ISO_DATE_LENGTH)} UTC`,
  })
}
