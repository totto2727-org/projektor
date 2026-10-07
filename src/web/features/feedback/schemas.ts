import { Schema } from "effect";

const nullable = Schema.NullOr(Schema.String);
export const Source = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	description: nullable,
	isActive: Schema.Boolean,
	allowedOrigins: Schema.NullOr(Schema.mutable(Schema.Array(Schema.String))),
	tokenPreview: Schema.String,
	createdAt: Schema.Number,
	revokedAt: Schema.NullOr(Schema.Number),
});
export const SourceLookup = Schema.Struct({ projectId: Schema.String });
export const Feedback = Schema.Struct({
	id: Schema.String,
	sourceId: Schema.String,
	sourceName: nullable,
	rating: Schema.NullOr(Schema.Number),
	ratingScale: nullable,
	body: nullable,
	submitterLabel: nullable,
	sourceUrl: nullable,
	appVersion: nullable,
	status: Schema.String,
	linkedIssueId: nullable,
	createdAt: Schema.Number,
});
export const Summary = Schema.Struct({
	sourceId: Schema.String,
	sourceName: Schema.optional(nullable),
	totalCount: Schema.Number,
	versions: Schema.mutable(
		Schema.Array(
			Schema.Struct({
				appVersion: nullable,
				totalCount: Schema.Number,
				withCommentCount: Schema.Number,
				thumbsUpPct: Schema.NullOr(Schema.Number),
				avgFiveStar: Schema.NullOr(Schema.Number),
				lastSeenAt: Schema.Number,
			}),
		),
	),
});
export const Sources = Schema.mutable(Schema.Array(Source));
export const Rows = Schema.mutable(Schema.Array(Feedback));
export const Summaries = Schema.mutable(Schema.Array(Summary));
export const SourceFields = Schema.Struct({
	name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
	description: Schema.String.check(Schema.isMaxLength(500)),
	origins: Schema.String.check(
		Schema.makeFilter((raw) => {
			const origins = raw
				.split(/[\n,]/)
				.map((value) => value.trim())
				.filter(Boolean);
			return (
				(origins.length <= 50 && origins.every((origin) => origin.length <= 2000)) ||
				"Enter at most 50 origins, each at most 2000 characters."
			);
		}),
	),
});
export const StatusFields = Schema.Struct({
	status: Schema.Literals(["", "new", "reviewed", "actioned"]),
});
export const Ok = Schema.Struct({ ok: Schema.Literal(true) });
export const Converted = Schema.Struct({
	id: Schema.String,
	number: Schema.optional(Schema.Number),
});
export const CreatedSource = Schema.Struct({ id: Schema.String, token: Schema.String });
