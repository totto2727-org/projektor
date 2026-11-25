import { Schema, String } from 'effect'

import {
  canonicalUtcDayMilliseconds,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
  utcMidnightMilliseconds,
} from '#contracts/time.ts'
import { MAX_METRICS_DAYS } from '#contracts/web-limits.ts'

const MAX_SPRINT_NAME_LENGTH = 100
const MAX_SPRINT_GOAL_LENGTH = 280
const MIN_MOVE_ISSUE_COUNT = 1
const MAX_MOVE_ISSUE_COUNT = 500
const MAX_HEATMAP_PREFIX_LENGTH = 2000
const EMPTY_DATE_OFFSET_MINUTES = 0
const CALENDAR_MONTH_INDEX_OFFSET = 1

export const SprintListModeSchema = Schema.Literals(['all', 'planned', 'active', 'completed'])
export type SprintListMode = typeof SprintListModeSchema.Type

const required = (label: string, maximum = 200): Schema.String =>
  Schema.String.check(
    Schema.isMaxLength(maximum),
    Schema.makeFilter((value) => String.isNonEmpty(value.trim()) || `${label} is required.`),
  )
export const PlanningScopeFields = {
  workspaceSlug: required('Workspace'),
  projectId: required('Project'),
}
const date = Schema.String.check(
  Schema.makeFilter((value) => Number.isFinite(canonicalUtcDayMilliseconds(value)) || 'Enter a valid date.'),
)
const optionalDate = Schema.Union([Schema.Literal(''), date])
export const SprintDraftFields = {
  name: required('Name', MAX_SPRINT_NAME_LENGTH),
  goal: Schema.String.check(Schema.isMaxLength(MAX_SPRINT_GOAL_LENGTH)),
  start: optionalDate,
  end: optionalDate,
}
export const SprintFormSchema = Schema.Struct({
  ...PlanningScopeFields,
  ...SprintDraftFields,
}).check(
  Schema.makeFilter(
    (value) =>
      !value.start ||
      !value.end ||
      value.start <= value.end || { path: ['end'], issue: 'End date must not precede start date.' },
  ),
)
export type SprintFormValues = typeof SprintFormSchema.Type
const OffsetSchema = Schema.Int.check(Schema.isBetween({ minimum: -840, maximum: 840 }))
export const CreateSprintInputSchema = Schema.Struct({
  ...PlanningScopeFields,
  ...SprintDraftFields,
  startOffset: OffsetSchema,
  endOffset: OffsetSchema,
}).check(
  Schema.makeFilter(
    (value) =>
      !value.start ||
      !value.end ||
      value.start <= value.end || { path: ['end'], issue: 'End date must not precede start date.' },
  ),
)
export const EditSprintInputSchema = Schema.Struct({
  ...CreateSprintInputSchema.fields,
  sprintId: required('Sprint'),
}).check(
  Schema.makeFilter(
    (value) =>
      !value.start ||
      !value.end ||
      value.start <= value.end || { path: ['end'], issue: 'End date must not precede start date.' },
  ),
)
export const SprintIdentitySchema = Schema.Struct({
  ...PlanningScopeFields,
  sprintId: required('Sprint'),
})
export const SprintStatusInputSchema = Schema.Struct({
  ...SprintIdentitySchema.fields,
  status: Schema.Literals(['planned', 'active', 'completed']),
})
export const MoveSprintIssuesSchema = Schema.Struct({
  ...PlanningScopeFields,
  sprintId: required('Source sprint'),
  targetId: required('Destination sprint'),
  issueIds: Schema.Array(required('Issue'))
    .pipe(Schema.mutable)
    .check(Schema.isMinLength(MIN_MOVE_ISSUE_COUNT), Schema.isMaxLength(MAX_MOVE_ISSUE_COUNT)),
}).check(
  Schema.makeFilter(
    (value) =>
      value.sprintId !== value.targetId || {
        path: ['targetId'],
        issue: 'Choose a different destination sprint.',
      },
  ),
)
export const MetricsWindowSchema = Schema.Struct({
  ...PlanningScopeFields,
  since: date,
  until: date,
  granularity: Schema.Literals(['day', 'week']),
  heatmapMode: Schema.Literals(['claims', 'contention']),
  prefix: Schema.String.check(Schema.isMaxLength(MAX_HEATMAP_PREFIX_LENGTH)),
}).check(
  Schema.makeFilter(
    (value) =>
      value.since <= value.until || {
        path: ['until'],
        issue: 'To date must not precede From date.',
      },
  ),
  Schema.makeFilter(
    (value) =>
      (utcMidnightMilliseconds(value.until) - utcMidnightMilliseconds(value.since)) / MILLISECONDS_PER_DAY <
        MAX_METRICS_DAYS || {
        path: ['until'],
        issue: `Choose a range of at most ${MAX_METRICS_DAYS} days.`,
      },
  ),
)

/** Calendar input offset is semantic data, preserving original local-midnight timestamps. */
export const calendarOffset = function calendarOffset(value: string): number {
  if (!value) {
    return EMPTY_DATE_OFFSET_MINUTES
  }
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - CALENDAR_MONTH_INDEX_OFFSET, day).getTimezoneOffset()
}
export const calendarTimestamp = function calendarTimestamp(value: string, offset: number): number | null {
  return value ? utcMidnightMilliseconds(value) / MILLISECONDS_PER_SECOND + offset * SECONDS_PER_MINUTE : null
}
