import { Schema } from "effect";

const NonEmpty = Schema.String.check(Schema.isMinLength(1));
export const SelectorFields = {
	workspaceSlug: Schema.optional(NonEmpty),
	projectId: Schema.optional(NonEmpty),
};
export const IssueIdentitySchema = Schema.Struct({ ...SelectorFields, issueId: NonEmpty });
export const IssuePatchSchema = Schema.Struct({
	title: Schema.optional(NonEmpty),
	body: Schema.optional(Schema.String),
	statusId: Schema.optional(NonEmpty),
	priority: Schema.optional(Schema.String),
	typeId: Schema.optional(Schema.NullOr(NonEmpty)),
	assigneeId: Schema.optional(Schema.NullOr(NonEmpty)),
	parentId: Schema.optional(Schema.NullOr(NonEmpty)),
	customFields: Schema.optional(Schema.Struct({ story_points: Schema.NullOr(Schema.String) })),
});
export const CreateIssueSchema = Schema.Struct({
	...SelectorFields,
	projectId: NonEmpty,
	title: Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(500)),
	body: Schema.optional(Schema.String.check(Schema.isMaxLength(50000))),
	priority: Schema.optional(Schema.Literals(["urgent", "high", "medium", "low", "none"])),
	statusId: Schema.optional(NonEmpty),
	typeId: Schema.optional(NonEmpty),
});
export const IssuePageInputSchema = Schema.Struct({
	...SelectorFields,
	statusIds: Schema.optional(Schema.String),
	priorities: Schema.optional(Schema.String),
	typeId: Schema.optional(Schema.String),
	parentId: Schema.optional(Schema.String),
	noParent: Schema.optional(Schema.String),
	excludeTypeIds: Schema.optional(Schema.String),
	sprintId: Schema.optional(Schema.String),
	completedAfter: Schema.optional(Schema.String),
	completedBefore: Schema.optional(Schema.String),
	updatedAfter: Schema.optional(Schema.String),
	updatedBefore: Schema.optional(Schema.String),
	cursor: Schema.optional(Schema.String),
	limit: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
	includeRollups: Schema.optional(Schema.Boolean),
});
export const SearchResultsSchema = Schema.Array(
	Schema.Struct({
		id: Schema.String,
		number: Schema.Number,
		title: Schema.String,
		status: Schema.String,
		priority: Schema.String,
		project_id: Schema.NullOr(Schema.String),
		project_key: Schema.NullOr(Schema.String),
		project_name: Schema.NullOr(Schema.String),
	})
);
export const WikiSearchResultsSchema = Schema.Array(
	Schema.Struct({
		id: Schema.String,
		title: Schema.String,
		slug: Schema.String,
		project_id: Schema.NullOr(Schema.String),
	})
);
export const OkSchema = Schema.Struct({ ok: Schema.Boolean });
export const CreatedSchema = Schema.Struct({ id: Schema.String });
