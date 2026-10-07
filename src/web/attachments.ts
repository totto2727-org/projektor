import { Schema } from "effect";

/** Backend file policy. Effront's total request-body limit still applies first. */
export const UploadFileSchema = Schema.File.check(
	Schema.isMinSize(1),
	Schema.isMaxSize(50 * 1024 * 1024),
);
export const UploadAttachmentInputSchema = Schema.Struct({
	workspaceSlug: Schema.NonEmptyString,
	entityType: Schema.Literals(["issue", "wiki_page"]),
	entityId: Schema.NonEmptyString,
	file: UploadFileSchema,
});
export type UploadAttachmentInput = typeof UploadAttachmentInputSchema.Type;

export const UploadedAttachmentSchema = Schema.Struct({
	id: Schema.String,
	filename: Schema.String,
	contentType: Schema.String,
	size: Schema.Number,
});
export type UploadedAttachment = typeof UploadedAttachmentSchema.Type;
