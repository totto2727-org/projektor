import { Schema } from 'effect'

import { BYTES_PER_MEBIBYTE, MAX_UPLOAD_SIZE } from '#contracts/file-limits.ts'

const MIN_UPLOAD_SIZE = 1
const MAX_SERVER_FUNCTION_UPLOAD_MEBIBYTES = 10
export const MAX_SERVER_FUNCTION_UPLOAD_BYTES = MAX_SERVER_FUNCTION_UPLOAD_MEBIBYTES * BYTES_PER_MEBIBYTE

/** Backend file policy. Effront's total request-body limit still applies first. */
export const UploadFileSchema = Schema.File.check(Schema.isMinSize(MIN_UPLOAD_SIZE), Schema.isMaxSize(MAX_UPLOAD_SIZE))
export const UploadAttachmentInputSchema = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  entityType: Schema.Literals(['issue', 'wiki_page']),
  entityId: Schema.NonEmptyString,
  file: UploadFileSchema,
})
export type UploadAttachmentInput = typeof UploadAttachmentInputSchema.Type

export const UploadedAttachmentSchema = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  contentType: Schema.String,
  size: Schema.Number,
})
export type UploadedAttachment = typeof UploadedAttachmentSchema.Type
