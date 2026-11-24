import { z } from 'zod'

import { REVIEW_STATUSES } from '#contracts/review-targets.ts'

export const EntityTypeSchema = z.enum(['issue', 'wiki_page'])

export const ListAttachmentsSchema = z.object({
  entityType: EntityTypeSchema,
  entityId: z.string().nonempty(),
})

export const CreateLinkAttachmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('wiki_ref'),
    entityType: EntityTypeSchema,
    entityId: z.string().nonempty(),
    wikiPageId: z.string().nonempty(),
  }),
  z.object({
    kind: z.literal('url'),
    entityType: EntityTypeSchema,
    entityId: z.string().nonempty(),
    url: z.url(),
    label: z.string().trim().max(200).optional(),
  }),
])

export const RecordFileUploadSchema = z.object({
  entityType: EntityTypeSchema,
  entityId: z.string().nonempty(),
  filename: z.string().nonempty(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  r2Key: z.string().nonempty(),
})

export const GetAttachmentSchema = z.object({ id: z.string().nonempty() })

export const DeleteAttachmentSchema = z.object({ id: z.string().nonempty() })

export const SetAttachmentReviewStatusSchema = z.object({
  issueId: z.string().nonempty(),
  attachmentId: z.string().nonempty(),
  status: z.enum(REVIEW_STATUSES).nullable(),
})
