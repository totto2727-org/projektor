import { Predicate } from 'effect'
import { z } from 'zod'

import {
  MAX_BULK_FEEDBACK_COUNT,
  MAX_SOURCE_NAME_LENGTH,
  MAX_SOURCE_DESCRIPTION_LENGTH,
  MAX_ALLOWED_ORIGIN_LENGTH,
  MAX_ALLOWED_ORIGIN_COUNT,
} from '#contracts/feedback-limits.ts'

import { objectInOrder } from './common.ts'

const MAX_BODY_LENGTH = 10_000
const MAX_SUBMITTER_LABEL_LENGTH = 200
const MAX_SOURCE_URL_LENGTH = 2000
const MAX_APP_VERSION_LENGTH = 100

const THUMBS_DOWN = -1
const THUMBS_UP = 1
const MIN_STAR_RATING = 1
const MAX_STAR_RATING = 5

const RatingScaleEnum = z.enum(['thumbs', 'five_star'])
const FeedbackStatusEnum = z.enum(['new', 'reviewed', 'actioned'])

export const SubmitFeedbackSchema = objectInOrder([
  ['rating', z.number().int().optional()],
  ['ratingScale', RatingScaleEnum.optional()],
  ['body', z.string().nonempty().max(MAX_BODY_LENGTH).optional()],
  ['submitterLabel', z.string().max(MAX_SUBMITTER_LABEL_LENGTH).optional()],
  ['sourceUrl', z.string().max(MAX_SOURCE_URL_LENGTH).optional()],
  ['appVersion', z.string().max(MAX_APP_VERSION_LENGTH).optional()],
])
  .refine((input) => Predicate.isNotNullish(input.rating) || Predicate.isNotNullish(input.body), {
    message: 'At least one of rating or body must be provided',
  })
  .refine((input) => Predicate.isNullish(input.rating) === Predicate.isNullish(input.ratingScale), {
    message: 'ratingScale is required when rating is present, and forbidden otherwise',
  })
  .refine(
    (input) => {
      if (Predicate.isNullish(input.rating) || Predicate.isNullish(input.ratingScale)) {
        return true
      }
      if (input.ratingScale === 'thumbs') {
        return input.rating === THUMBS_DOWN || input.rating === THUMBS_UP
      }
      return input.rating >= MIN_STAR_RATING && input.rating <= MAX_STAR_RATING
    },
    { message: 'rating must be -1 or 1 for thumbs, or an integer 1-5 for five_star' },
  )

export const CreateFeedbackSourceSchema = objectInOrder([
  ['projectId', z.string().nonempty('projectId is required')],
  ['name', z.string().nonempty().max(MAX_SOURCE_NAME_LENGTH)],
  ['description', z.string().max(MAX_SOURCE_DESCRIPTION_LENGTH).optional()],
  ['allowedOrigins', z.array(z.string().max(MAX_ALLOWED_ORIGIN_LENGTH)).max(MAX_ALLOWED_ORIGIN_COUNT).optional()],
])

export const ListFeedbackSourcesSchema = z.object({
  projectId: z.string().nonempty('projectId is required'),
})

export const GetFeedbackSourceSchema = z.object({
  sourceId: z.string().nonempty('sourceId is required'),
})

export const UpdateFeedbackSourceSchema = objectInOrder([
  ['sourceId', z.string()],
  /*
   * Optional: REST routes always pass the URL path's projectId (scoping the
   * lookup to that project); MCP tools omit it and stay workspace-scoped.
   */
  ['projectId', z.string().nonempty().optional()],
  ['name', z.string().nonempty().max(MAX_SOURCE_NAME_LENGTH).optional()],
  ['description', z.string().max(MAX_SOURCE_DESCRIPTION_LENGTH).nullable().optional()],
  ['isActive', z.boolean().optional()],
]).refine(
  (input) =>
    Predicate.isNotNullish(input.name) || input.description !== undefined || Predicate.isNotNullish(input.isActive),
  {
    message: 'At least one of name, description, or isActive must be provided',
  },
)

export const RotateFeedbackSourceSchema = objectInOrder([
  ['sourceId', z.string()],
  ['projectId', z.string().nonempty().optional()],
])
export const RevokeFeedbackSourceSchema = objectInOrder([
  ['sourceId', z.string()],
  ['projectId', z.string().nonempty().optional()],
])

export const ListFeedbackSchema = objectInOrder([
  ['projectId', z.string().nonempty('projectId is required')],
  ['status', FeedbackStatusEnum.optional()],
  ['sourceId', z.string().optional()],
])

export const UpdateFeedbackSchema = objectInOrder([
  /*
   * Optional: REST routes always pass the URL path's projectId (scoping the
   * lookup to that project); MCP tools omit it and resolve it from the feedback row.
   */
  ['projectId', z.string().nonempty().optional()],
  ['feedbackId', z.string()],
  ['status', FeedbackStatusEnum],
])

export const ConvertFeedbackSchema = objectInOrder([
  ['projectId', z.string().nonempty().optional()],
  ['feedbackId', z.string()],
])

export const BulkFeedbackIdsSchema = objectInOrder([
  ['projectId', z.string().nonempty('projectId is required')],
  [
    'feedbackIds',
    z.array(z.string().nonempty()).nonempty('At least one feedbackId is required').max(MAX_BULK_FEEDBACK_COUNT),
  ],
])
