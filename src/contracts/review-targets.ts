import { Schema } from 'effect'

import { structInOrder } from './ordered-schema.ts'

export const REVIEW_STATUSES = ['fixing', 'in_review', 'changes_requested', 'done'] as const
export const ReviewStatusSchema = Schema.Literals(REVIEW_STATUSES)
export type ReviewStatus = typeof ReviewStatusSchema.Type

export const REVIEW_FILTERS = ['active', 'in_review', 'fixing', 'changes_requested'] as const
export const ReviewFilterSchema = Schema.Literals(REVIEW_FILTERS)
export type ReviewFilter = typeof ReviewFilterSchema.Type

export const ReviewTargetSchema = structInOrder([
  ['id', Schema.String],
  ['kind', Schema.Literals(['file', 'url'])],
  ['filename', Schema.String],
  ['url', Schema.NullOr(Schema.String)],
  ['status', ReviewStatusSchema],
])
export type ReviewTarget = typeof ReviewTargetSchema.Type
