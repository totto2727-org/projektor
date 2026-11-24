import { DateTime, Option } from 'effect'

export const MILLISECONDS_PER_SECOND = 1000
export const MILLISECONDS_PER_DAY = 86_400_000
export const SECONDS_PER_MINUTE = 60
export const LAST_SECOND_OF_DAY = 86_399

const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export const currentEpochMilliseconds = function currentEpochMilliseconds(): number {
  return DateTime.toEpochMillis(DateTime.nowUnsafe())
}

export const currentEpochSeconds = function currentEpochSeconds(): number {
  return Math.floor(currentEpochMilliseconds() / MILLISECONDS_PER_SECOND)
}

const utcMidnight = function utcMidnight(day: string): Option.Option<DateTime.Utc> {
  return DateTime.make(`${day}T00:00:00Z`)
}

export const utcMidnightMilliseconds = function utcMidnightMilliseconds(day: string): number {
  return Option.match(utcMidnight(day), {
    onNone: () => Number.NaN,
    onSome: DateTime.toEpochMillis,
  })
}

export const canonicalUtcDayMilliseconds = function canonicalUtcDayMilliseconds(day: string): number {
  if (!CALENDAR_DAY_PATTERN.test(day)) {
    return Number.NaN
  }
  return Option.match(utcMidnight(day), {
    onNone: () => Number.NaN,
    onSome: (instant) => (DateTime.formatIsoDateUtc(instant) === day ? DateTime.toEpochMillis(instant) : Number.NaN),
  })
}
