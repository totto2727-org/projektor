import { formatTimestampDate } from '../timestamp'
import type { RangeState, SprintIssue } from './types'

/** Original local-midnight date input contract, including timezone-safe round trips. */
export function dateInputToUnix(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000)
}
export function unixToDateInput(ts: number | null): string {
  if (ts === null) return ''
  const date = new Date(ts * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function formatUnixDate(ts: number | null): string {
  return ts === null ? '\u2013' : formatTimestampDate(ts)
}
export function getStoryPoints(issue: SprintIssue): number {
  const field = issue.customFields.find((entry) => entry.key === 'story_points')
  if (!field) return 0
  const value = Number.parseFloat(field.value)
  return Number.isNaN(value) ? 0 : value
}
export function issueHref(issue: SprintIssue, workspaceSlug: string): string {
  const query = new URLSearchParams({ id: issue.id, workspace: workspaceSlug })
  if (!issue.project_key) return `/issues/view?${query}`
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `/projects/${encodeURIComponent(issue.project_key)}/issues/${issue.number}/${slug}?workspace=${encodeURIComponent(workspaceSlug)}`
}
export function defaultRange(now = new Date()): RangeState {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 35)
  return {
    since: monday.toISOString().slice(0, 10),
    until: now.toISOString().slice(0, 10),
    granularity: 'week',
  }
}
export function dateEpochStart(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000)
}
export function dateEpochEnd(date: string): number {
  return dateEpochStart(date) + 86399
}
export function rangeFromUrl(url: URL, now = new Date()): RangeState {
  const fallback = defaultRange(now)
  const date = (key: 'since' | 'until') => {
    const value = url.searchParams.get(key)
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dateEpochStart(value)) ? value : fallback[key]
  }
  const since = date('since')
  const until = date('until')
  return {
    since: since <= until ? since : until,
    until,
    granularity: url.searchParams.get('granularity') === 'day' ? 'day' : 'week',
  }
}
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '\u2013'
  const abs = Math.abs(seconds)
  if (abs < 60) return `${Math.round(seconds)}s`
  if (abs < 3600) return `${(seconds / 60).toFixed(1)}m`
  if (abs < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${(seconds / 86400).toFixed(1)}d`
}
export const formatPercent = (value: number | null) => (value === null ? '\u2013' : `${Math.round(value * 100)}%`)
export const formatCount = (value: number | null) => (value === null ? '\u2013' : value.toFixed(1))
