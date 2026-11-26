import { Schema } from 'effect'

import { structInOrder } from '#contracts/ordered-schema.ts'

const nullableText = Schema.NullOr(Schema.String)
const nullableNumber = Schema.NullOr(Schema.Finite)
const array = <S extends Schema.Constraint>(schema: S): Schema.mutable<Schema.$Array<S>> =>
  Schema.Array(schema).pipe(Schema.mutable)

/** These are the actual API wire shapes, not the frontend's mutation DTOs. */
export const SprintSchema = structInOrder([
  ['id', Schema.String],
  ['name', Schema.String],
  ['goal', nullableText],
  ['status', Schema.Literals(['planned', 'active', 'completed'])],
  ['startDate', nullableNumber],
  ['endDate', nullableNumber],
  ['projectId', Schema.String],
  ['createdAt', Schema.Finite],
])
export const SprintsSchema = Schema.Struct({ items: array(SprintSchema) })

const IssueCustomFieldsSchema = array(Schema.Struct({ key: Schema.String, value: Schema.String }))
export const IssuePageSchema = structInOrder([
  ['nextCursor', nullableText],
  [
    'items',
    array(
      structInOrder([
        ['id', Schema.String],
        ['title', Schema.String],
        ['number', Schema.Finite],
        ['status_category', nullableText],
        ['project_key', nullableText],
        ['sprint_id', nullableText],
        ['customFields', IssueCustomFieldsSchema],
      ]),
    ),
  ],
])
const DistributionSchema = structInOrder([
  ['count', Schema.Finite],
  ['avg', nullableNumber],
  ['p50', nullableNumber],
  ['p90', nullableNumber],
])

const AgingWipStatusSchema = Schema.Literals(['in_progress', 'in_review'])
export const MetricsSchema = structInOrder([
  ['leadTime', DistributionSchema],
  ['cycleTime', DistributionSchema],
  ['reviewLatency', DistributionSchema],
  ['humanInterventions', DistributionSchema],
  ['autonomyRatio', DistributionSchema],
  ['timeInProgress', DistributionSchema],
  ['flowEfficiency', DistributionSchema],
  [
    'wipOverTime',
    array(
      structInOrder([
        ['date', Schema.String],
        ['count', Schema.Finite],
      ]),
    ),
  ],
  ['throughputOverTime', array(Schema.Struct({ bucketStart: Schema.String, count: Schema.Finite }))],
  [
    'bugShareOverTime',
    array(
      structInOrder([
        ['bucketStart', Schema.String],
        ['total', Schema.Finite],
        ['bugCount', Schema.Finite],
        ['bugSharePercent', nullableNumber],
      ]),
    ),
  ],
  ['bugTypeTracked', Schema.Boolean],
  ['reviewLatencyOverTime', array(Schema.Struct({ bucketStart: Schema.String, p50: nullableNumber }))],
  [
    'cfdOverTime',
    array(
      structInOrder([
        ['bucketStart', Schema.String],
        ['backlogTodo', Schema.Finite],
        ['inProgress', Schema.Finite],
        ['inReview', Schema.Finite],
        ['done', Schema.Finite],
      ]),
    ),
  ],
  [
    'arrivalVsCompletionOverTime',
    array(
      structInOrder([
        ['bucketStart', Schema.String],
        ['created', Schema.Finite],
        ['completed', Schema.Finite],
        ['net', Schema.Finite],
      ]),
    ),
  ],
  [
    'agingWip',
    array(
      structInOrder([
        ['id', Schema.String],
        ['status', AgingWipStatusSchema],
        ['ageSeconds', Schema.Finite],
      ]),
    ),
  ],
  [
    'factoryHealth',
    structInOrder([
      ['leaseExpiries', Schema.Finite],
      ['abandonedClaims', Schema.Finite],
      ['gateRejections', Schema.Finite],
      ['wipCapPressure', Schema.Finite],
    ]),
  ],
])

const HeatmapEntrySchema = structInOrder([
  ['path', Schema.String],
  ['segment', Schema.String],
  ['isLeaf', Schema.Boolean],
  ['distinctIssueCount', Schema.optionalKey(Schema.Finite)],
  ['claimCount', Schema.optionalKey(Schema.Finite)],
  ['distinctRejectedIssueCount', Schema.optionalKey(Schema.Finite)],
  ['conflictCount', Schema.optionalKey(Schema.Finite)],
])
export const HeatmapSchema = structInOrder([
  ['prefix', Schema.String],
  ['totalDistinctIssues', Schema.Finite],
  ['entries', array(HeatmapEntrySchema)],
])
