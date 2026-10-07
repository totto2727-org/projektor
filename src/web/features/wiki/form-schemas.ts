import { Schema } from "effect";
import { UploadFileSchema } from "../../attachments";

const title = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300));
const content = Schema.String.check(Schema.isMaxLength(500000));
export const EditFields = Schema.Struct({
	title,
	content,
	baseRevisionId: Schema.optional(Schema.NullOr(Schema.String)),
});
export const CreateFields = Schema.Struct({
	title,
	slug: Schema.String.check(Schema.isMaxLength(200), Schema.isPattern(/^[a-z0-9-]*$/)),
	content,
	parentId: Schema.NullOr(Schema.String),
	templateSlug: Schema.String.check(Schema.isMaxLength(200)),
});
export const FilterFields = Schema.Struct({
	type: Schema.String.check(Schema.isMaxLength(50)),
	status: Schema.Literals(["", "draft", "current", "stale", "deprecated"]),
	tags: Schema.String.check(Schema.isMaxLength(2549)),
});
export const SearchFields = Schema.Struct({ query: Schema.String.check(Schema.isMaxLength(2000)) });
export const MoveFields = Schema.Struct({ parentId: Schema.String });
export const AttachmentFields = Schema.Struct({
	file: Schema.NullOr(UploadFileSchema).check(
		Schema.makeFilter((file) => file !== null || "Choose a file."),
	),
});
