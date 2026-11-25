import { String, Predicate } from 'effect'

import { defaultFlowMetricsStartDate } from '#contracts/flow-metrics-range.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import {
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
  LAST_SECOND_OF_DAY,
  MILLISECONDS_PER_SECOND,
  formatUtcDatePrefix,
  utcMidnightMilliseconds,
} from '#contracts/time.ts'
import { formatTimestampDate } from '@/features/timestamp.ts'

import type { RangeState, SprintIssue } from './types.ts'

/** Original local-midnight date input contract, including timezone-safe round trips. */
export const dateInputToUnix = function dateInputToUnix(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim())
  if (!match) {
    return null
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / MILLISECONDS_PER_SECOND)
}
export const unixToDateInput = function unixToDateInput(ts: number | null): string {
  if (Predicate.isNullish(ts)) {
    return ''
  }
  const date = new Date(ts * MILLISECONDS_PER_SECOND)
  return `${date.getFullYear()}-${globalThis.String(date.getMonth() + 1).padStart(2, '0')}-${globalThis.String(date.getDate()).padStart(2, '0')}`
}
export const formatUnixDate = function formatUnixDate(ts: number | null): string {
  return Predicate.isNullish(ts) ? '\u2013' : formatTimestampDate(ts)
}
export const getStoryPoints = function getStoryPoints(issue: SprintIssue): number {
  const field = issue.customFields.find((entry) => entry.key === 'story_points')
  if (!field) {
    return 0
  }
  const value = Number.parseFloat(field.value)
  return Number.isNaN(value) ? 0 : value
}
export const issueHref = function issueHref(issue: SprintIssue, workspaceSlug: string): string {
  const query = new URLSearchParams({ id: issue.id, workspace: workspaceSlug })
  if (!isNonEmptyText(issue.project_key)) {
    return `/issues/view?${query}`
  }
  const slug = issue.title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
  return `/projects/${encodeURIComponent(issue.project_key)}/issues/${issue.number}/${slug}?workspace=${encodeURIComponent(workspaceSlug)}`
}
export const defaultRange = function defaultRange(now = new Date()): RangeState {
  const monday = defaultFlowMetricsStartDate(now)
  return {
    since: formatUtcDatePrefix(monday),
    until: formatUtcDatePrefix(now),
    granularity: 'week',
  }
}
export const dateEpochStart = function dateEpochStart(date: string): number {
  return Math.floor(utcMidnightMilliseconds(date) / MILLISECONDS_PER_SECOND)
}
export const dateEpochEnd = function dateEpochEnd(date: string): number {
  return dateEpochStart(date) + LAST_SECOND_OF_DAY
}
export const rangeFromUrl = function rangeFromUrl(url: URL, now = new Date()): RangeState {
  const fallback = defaultRange(now)
  const date = (key: 'since' | 'until'): string => {
    const value = url.searchParams.get(key)
    return Predicate.isNotNullish(value) &&
      String.isNonEmpty(value) &&
      /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
      Number.isFinite(dateEpochStart(value))
      ? value
      : fallback[key]
  }
  const since = date('since')
  const until = date('until')
  return {
    since: since <= until ? since : until,
    until,
    granularity: url.searchParams.get('granularity') === 'day' ? 'day' : 'week',
  }
}
export const formatDuration = function formatDuration(seconds: number | null): string {
  if (Predicate.isNullish(seconds)) {
    return '\u2013'
  }
  const abs = Math.abs(seconds)
  if (abs < SECONDS_PER_MINUTE) {
    return `${Math.round(seconds)}s`
  }
  if (abs < SECONDS_PER_HOUR) {
    return `${(seconds / SECONDS_PER_MINUTE).toFixed(1)}m`
  }
  if (abs < SECONDS_PER_DAY) {
    return `${(seconds / SECONDS_PER_HOUR).toFixed(1)}h`
  }
  return `${(seconds / SECONDS_PER_DAY).toFixed(1)}d`
}
export const formatPercent = (value: number | null): string =>
  Predicate.isNullish(value) ? '\u2013' : `${Math.round(value * 100)}%`
export const formatCount = (value: number | null): string => (Predicate.isNullish(value) ? '\u2013' : value.toFixed(1))
