import { Schema } from "effect";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const ProjectKey = Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9]{0,9}$/));
const ProjectName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100));
const ProjectDescription = Schema.String.check(Schema.isMaxLength(500));

/** Shared by the New project form and its typed ServerFn input. */
export const CreateProjectInputSchema = Schema.Struct({
	workspaceSlug: NonEmptyString,
	name: ProjectName,
	key: ProjectKey,
	description: ProjectDescription,
});
export type CreateProjectInput = typeof CreateProjectInputSchema.Type;

/** Shared by the description editor and its typed ServerFn input. */
export const UpdateDescriptionInputSchema = Schema.Struct({
	workspaceSlug: NonEmptyString,
	projectId: NonEmptyString,
	description: ProjectDescription,
});
export type UpdateDescriptionInput = typeof UpdateDescriptionInputSchema.Type;

export const ArchiveProjectInputSchema = Schema.Struct({
	workspaceSlug: NonEmptyString,
	projectId: NonEmptyString,
	archived: Schema.Boolean,
});
export type ArchiveProjectInput = typeof ArchiveProjectInputSchema.Type;

export const CreatedProjectSchema = Schema.Struct({
	id: NonEmptyString,
	name: Schema.String,
	key: NonEmptyString,
	slug: NonEmptyString,
});
export type CreatedProject = typeof CreatedProjectSchema.Type;

export const ProjectMutationResultSchema = Schema.Struct({ ok: Schema.Boolean });

export const ProjectSummarySchema = Schema.Struct({
	id: NonEmptyString,
	name: Schema.String,
	key: NonEmptyString,
	slug: Schema.NullOr(Schema.String),
	description: Schema.NullOr(Schema.String),
	workspace_id: NonEmptyString,
	workspace_name: Schema.String,
	workspace_slug: NonEmptyString,
	open_issue_count: Schema.Number,
	backlog_issue_count: Schema.Number,
	archived_at: Schema.NullOr(Schema.Number),
	created_at: Schema.Number,
	updated_at: Schema.Number,
});
export type ProjectSummary = typeof ProjectSummarySchema.Type;
export const ProjectSummariesSchema = Schema.Array(ProjectSummarySchema);

export const ProjectSchema = Schema.Struct({
	id: NonEmptyString,
	name: Schema.String,
	key: NonEmptyString,
	slug: Schema.NullOr(Schema.String),
	description: Schema.NullOr(Schema.String),
	archivedAt: Schema.NullOr(Schema.Number),
	workspaceId: NonEmptyString,
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
});
export type Project = typeof ProjectSchema.Type;

export const RecentIssueSchema = Schema.Struct({
	id: NonEmptyString,
	number: Schema.Number,
	title: Schema.String,
	project_key: Schema.NullOr(Schema.String),
	status_name: Schema.NullOr(Schema.String),
	status_key: Schema.NullOr(Schema.String),
	status_category: Schema.NullOr(Schema.String),
	updated_at: Schema.Number,
});
export type RecentIssue = typeof RecentIssueSchema.Type;

export const RecentIssuesResponseSchema = Schema.Struct({ items: Schema.Array(RecentIssueSchema) });
export const RecentWikiPageSchema = Schema.Struct({
	id: NonEmptyString,
	slug: NonEmptyString,
	title: Schema.String,
	updated_at: Schema.Number,
});
export type RecentWikiPage = typeof RecentWikiPageSchema.Type;

export const ThroughputPointSchema = Schema.Struct({
	bucketStart: Schema.String,
	count: Schema.Number,
});
export const CfdPointSchema = Schema.Struct({
	bucketStart: Schema.String,
	backlogTodo: Schema.Number,
	inProgress: Schema.Number,
	inReview: Schema.Number,
	done: Schema.Number,
});
export const FlowMetricsSchema = Schema.Struct({
	throughputOverTime: Schema.Array(ThroughputPointSchema),
	cfdOverTime: Schema.Array(CfdPointSchema),
});
export type FlowMetrics = typeof FlowMetricsSchema.Type;

export const RecentWikiPagesSchema = Schema.Array(RecentWikiPageSchema);
