import { Schema } from 'effect'

import {
  MAX_SOURCE_NAME_LENGTH,
  MAX_SOURCE_DESCRIPTION_LENGTH,
  MAX_ALLOWED_ORIGIN_LENGTH,
  MAX_ALLOWED_ORIGIN_COUNT,
} from '#contracts/feedback-limits.ts'
import { structInOrder } from '#contracts/ordered-schema.ts'

const MIN_SOURCE_NAME_LENGTH = 1

const nullable = Schema.NullOr(Schema.String)

const AllowedOriginsSchema = Schema.NullOr(Schema.mutable(Schema.Array(Schema.String)))
export const Source = structInOrder([
  ['id', Schema.String],
  ['name', Schema.String],
  ['description', nullable],
  ['isActive', Schema.Boolean],
  ['allowedOrigins', AllowedOriginsSchema],
  ['tokenPreview', Schema.String],
  ['createdAt', Schema.Number],
  ['revokedAt', Schema.NullOr(Schema.Number)],
])
export const SourceLookup = Schema.Struct({ projectId: Schema.String })
export const Feedback = structInOrder([
  ['id', Schema.String],
  ['sourceId', Schema.String],
  ['sourceName', nullable],
  ['rating', Schema.NullOr(Schema.Number)],
  ['ratingScale', nullable],
  ['body', nullable],
  ['submitterLabel', nullable],
  ['sourceUrl', nullable],
  ['appVersion', nullable],
  ['status', Schema.String],
  ['linkedIssueId', nullable],
  ['createdAt', Schema.Number],
])

const FeedbackVersionSummarySchema = structInOrder([
  ['appVersion', nullable],
  ['totalCount', Schema.Number],
  ['withCommentCount', Schema.Number],
  ['thumbsUpPct', Schema.NullOr(Schema.Number)],
  ['avgFiveStar', Schema.NullOr(Schema.Number)],
  ['lastSeenAt', Schema.Number],
])
export const Summary = Schema.Struct({
  sourceId: Schema.String,
  sourceName: Schema.optional(nullable),
  totalCount: Schema.Number,
  versions: Schema.mutable(Schema.Array(FeedbackVersionSummarySchema)),
})
export const Sources = Schema.mutable(Schema.Array(Source))
export const Rows = Schema.mutable(Schema.Array(Feedback))
export const Summaries = Schema.mutable(Schema.Array(Summary))
export const SourceFields = structInOrder([
  ['name', Schema.String.check(Schema.isMinLength(MIN_SOURCE_NAME_LENGTH), Schema.isMaxLength(MAX_SOURCE_NAME_LENGTH))],
  ['description', Schema.String.check(Schema.isMaxLength(MAX_SOURCE_DESCRIPTION_LENGTH))],
  [
    'origins',
    Schema.String.check(
      Schema.makeFilter((raw) => {
        const origins = raw
          .split(/[\n,]/u)
          .map((value) => value.trim())
          .filter(Boolean)
        return (
          (origins.length <= MAX_ALLOWED_ORIGIN_COUNT &&
            origins.every((origin) => origin.length <= MAX_ALLOWED_ORIGIN_LENGTH)) ||
          'Enter at most 50 origins, each at most 2000 characters.'
        )
      }),
    ),
  ],
])
export const StatusFields = Schema.Struct({
  status: Schema.Literals(['', 'new', 'reviewed', 'actioned']),
})
export const Ok = Schema.Struct({ ok: Schema.Literal(true) })
export const Converted = Schema.Struct({
  id: Schema.String,
  number: Schema.optional(Schema.Number),
})
export const CreatedSource = Schema.Struct({ id: Schema.String, token: Schema.String })
export const FeedbackIndexSchema = Schema.Struct({ sources: Sources, summaries: Summaries })
export const FeedbackDetailSchema = Schema.NullOr(
  structInOrder([
    ['source', Source],
    ['sources', Sources],
    ['rows', Rows],
    ['summary', Schema.NullOr(Summary)],
    ['status', StatusFields.fields.status],
    ['projectId', Schema.String],
    ['workspaceSlug', Schema.String],
  ]),
)
