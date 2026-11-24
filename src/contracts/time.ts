import { DateTime } from 'effect'

const MILLISECONDS_PER_SECOND = 1000

export const currentEpochMilliseconds = function currentEpochMilliseconds(): number {
  return DateTime.toEpochMillis(DateTime.nowUnsafe())
}

export const currentEpochSeconds = function currentEpochSeconds(): number {
  return Math.floor(currentEpochMilliseconds() / MILLISECONDS_PER_SECOND)
}
