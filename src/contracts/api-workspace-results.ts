import { Schema } from 'effect'

import { BooleanSchema, CreatedIssue, Id, NN, NS, NumberSchema, Ok, StringSchema, array } from './api-result-codecs.ts'
import { fieldsInOrder } from './ordered-fields.ts'
import { extendStructInOrder, structInOrder } from './ordered-schema.ts'

const Feedback = structInOrder([
  ['id', StringSchema],
  ['sourceId', StringSchema],
  ['sourceName', NS],
  ['rating', NN],
  ['ratingScale', NS],
  ['body', NS],
  ['submitterLabel', NS],
  ['sourceUrl', NS],
  ['appVersion', NS],
  ['status', StringSchema],
  ['linkedIssueId', NS],
  ['createdAt', NumberSchema],
])

const FeedbackSourceFields = fieldsInOrder([
  ['id', StringSchema],
  ['name', StringSchema],
  ['description', NS],
  ['isActive', BooleanSchema],
  ['allowedOrigins', Schema.NullOr(array(StringSchema))],
  ['tokenPreview', StringSchema],
  ['createdAt', NumberSchema],
  ['revokedAt', NN],
])

const FeedbackSource = Schema.Struct(FeedbackSourceFields)

const FeedbackVersionSummary = structInOrder([
  ['appVersion', NS],
  ['totalCount', NumberSchema],
  ['withCommentCount', NumberSchema],
  ['thumbsUpPct', NN],
  ['avgFiveStar', NN],
  ['lastSeenAt', NumberSchema],
])

const FeedbackSummary = array(
  Schema.Struct({
    sourceId: StringSchema,
    sourceName: NS,
    totalCount: NumberSchema,
    versions: array(FeedbackVersionSummary),
  }),
)

const Activity = structInOrder([
  ['type', StringSchema],
  ['actor', NS],
  ['entity_type', StringSchema],
  ['entity_id', StringSchema],
  ['entity_ref', StringSchema],
  ['summary', StringSchema],
  ['created_at', NumberSchema],
])

export const Brand = structInOrder([
  ['displayName', NS],
  ['accent', NS],
  ['onAccent', NS],
  ['fontFamily', NS],
  ['fontUrl', NS],
  ['logoUrl', NS],
])

const Distribution = structInOrder([
  ['count', NumberSchema],
  ['avg', NN],
  ['p50', NN],
  ['p90', NN],
])

const HeatmapEntryFields = fieldsInOrder([
  ['path', StringSchema],
  ['segment', StringSchema],
  ['isLeaf', BooleanSchema],
])

const ClaimHeatmapEntry = extendStructInOrder(HeatmapEntryFields, [
  ['distinctIssueCount', NumberSchema],
  ['claimCount', NumberSchema],
])

const ContentionHeatmapEntry = extendStructInOrder(HeatmapEntryFields, [
  ['distinctRejectedIssueCount', NumberSchema],
  ['conflictCount', NumberSchema],
])

const Heatmap = Schema.Union([
  structInOrder([
    ['prefix', StringSchema],
    ['mode', Schema.Literal('claims')],
    ['totalDistinctIssues', NumberSchema],
    ['entries', array(ClaimHeatmapEntry)],
  ]),
  structInOrder([
    ['prefix', StringSchema],
    ['mode', Schema.Literal('contention')],
    ['totalDistinctIssues', NumberSchema],
    ['entries', array(ContentionHeatmapEntry)],
  ]),
])

const Project = structInOrder([
  ['id', StringSchema],
  ['workspaceId', StringSchema],
  ['name', StringSchema],
  ['key', StringSchema],
  ['description', NS],
  ['createdAt', NumberSchema],
  ['updatedAt', NumberSchema],
  ['agentWipLimit', NN],
  ['slug', NS],
  ['archivedAt', NN],
])

const ProjectSummary = structInOrder([
  ['id', StringSchema],
  ['name', StringSchema],
  ['key', StringSchema],
  ['slug', NS],
  ['description', NS],
  ['workspace_id', StringSchema],
  ['workspace_name', StringSchema],
  ['workspace_slug', StringSchema],
  ['open_issue_count', NumberSchema],
  ['backlog_issue_count', NumberSchema],
  ['archived_at', NN],
  ['created_at', NumberSchema],
  ['updated_at', NumberSchema],
])

export const TaskType = structInOrder([
  ['id', StringSchema],
  ['workspace_id', StringSchema],
  ['key', StringSchema],
  ['name', StringSchema],
  ['color', NS],
  ['icon', NS],
  ['position', NumberSchema],
  ['is_default', NumberSchema],
])

export const TaskStatus = structInOrder([
  ['id', StringSchema],
  ['workspace_id', StringSchema],
  ['key', StringSchema],
  ['name', StringSchema],
  ['color', NS],
  ['position', NumberSchema],
  ['is_default', NumberSchema],
  ['is_review_step', NumberSchema],
  ['category', Schema.Literals(['todo', 'in_progress', 'done', 'cancelled'])],
])

const AgingWipStatus = Schema.Literals(['in_progress', 'in_review'])

const FlowMetrics = structInOrder([
  ['leadTime', Distribution],
  ['leadTimeExcluded', NumberSchema],
  ['cycleTime', Distribution],
  [
    'wipOverTime',
    array(
      structInOrder([
        ['date', StringSchema],
        ['count', NumberSchema],
      ]),
    ),
  ],
  ['throughputOverTime', array(Schema.Struct({ bucketStart: StringSchema, count: NumberSchema }))],
  [
    'bugShareOverTime',
    array(
      structInOrder([
        ['bucketStart', StringSchema],
        ['total', NumberSchema],
        ['bugCount', NumberSchema],
        ['bugSharePercent', NN],
      ]),
    ),
  ],
  ['bugTypeTracked', BooleanSchema],
  ['reviewLatency', Distribution],
  ['reviewLatencyOverTime', array(Schema.Struct({ bucketStart: StringSchema, p50: NN }))],
  ['humanInterventions', Distribution],
  ['autonomyRatio', Distribution],
  [
    'cfdOverTime',
    array(
      structInOrder([
        ['bucketStart', StringSchema],
        ['backlogTodo', NumberSchema],
        ['inProgress', NumberSchema],
        ['inReview', NumberSchema],
        ['done', NumberSchema],
      ]),
    ),
  ],
  ['timeInProgress', Distribution],
  [
    'arrivalVsCompletionOverTime',
    array(
      structInOrder([
        ['bucketStart', StringSchema],
        ['created', NumberSchema],
        ['completed', NumberSchema],
        ['net', NumberSchema],
      ]),
    ),
  ],
  ['flowEfficiency', Distribution],
  [
    'agingWip',
    array(
      structInOrder([
        ['id', StringSchema],
        ['status', AgingWipStatus],
        ['ageSeconds', NumberSchema],
      ]),
    ),
  ],
  [
    'factoryHealth',
    structInOrder([
      ['leaseExpiries', NumberSchema],
      ['abandonedClaims', NumberSchema],
      ['gateRejections', NumberSchema],
      ['wipCapPressure', NumberSchema],
    ]),
  ],
])

export const workspaceResults = [
  ['apiListFeedback', array(Feedback)],
  ['apiUpdateFeedbackStatus', Ok],
  ['apiConvertFeedbackToIssue', CreatedIssue],
  ['apiBulkMarkReviewed', Schema.Struct({ updated: NumberSchema })],
  [
    'apiBulkConvertToIssue',
    structInOrder([
      ['id', StringSchema],
      ['number', Schema.optional(NumberSchema)],
      ['convertedCount', NumberSchema],
    ]),
  ],
  ['apiGetFeedbackSummary', FeedbackSummary],
  ['apiCreateFeedbackSource', Schema.Struct({ id: StringSchema, token: StringSchema })],
  ['apiListFeedbackSources', array(FeedbackSource)],
  ['apiGetFeedbackSource', Schema.Struct({ ...FeedbackSourceFields, projectId: StringSchema })],
  ['apiUpdateFeedbackSource', Ok],
  ['apiRotateFeedbackSourceToken', Schema.Struct({ token: StringSchema })],
  ['apiRevokeFeedbackSource', Ok],
  ['apiGetCodeHeatmap', Heatmap],
  ['apiGetFlowMetrics', FlowMetrics],
  ['apiListProjectActivity', array(Activity)],
  [
    'apiComposePlaybook',
    structInOrder([
      ['name', StringSchema],
      ['variant', StringSchema],
      ['directive', StringSchema],
    ]),
  ],
  ['apiListProjects', array(ProjectSummary)],
  ['apiListProjectsInWorkspace', array(Project)],
  ['apiGetProject', Project],
  ['apiGetProjectBySlug', Project],
  [
    'apiCreateProject',
    structInOrder([
      ['id', StringSchema],
      ['name', StringSchema],
      ['key', StringSchema],
      ['slug', StringSchema],
    ]),
  ],
  ['apiUpdateProject', Ok],
  ['apiDeleteProject', Ok],
  ['apiCreateLink', Id],
] as const
