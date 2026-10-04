import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import type { ReactElement } from "react";
import type { RequestApi } from "../../server/api-client";
import { ApiError, responseError, ScopeError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
import { buildFilterQueryParams } from "./legacy/IssueList-helpers";
import { issueListQuery } from "./query";
import {
	AttachmentsSchema,
	CommentsSchema,
	type IssuePage,
	IssuePageSchema,
	IssueSchema,
	LinksSchema,
	MembersSchema,
	normalizeAttachments,
	normalizeComments,
	normalizeIssue,
	normalizeIssuePage,
	normalizeLinks,
	normalizeMembers,
	normalizeStatuses,
	normalizeTaskTypes,
	StatusesSchema,
	TaskTypesSchema,
} from "./types";
import { type EpicsInitialData, EpicsPage } from "./views/EpicsPage";
import { type IssueDetailInitialData, IssueDetailPage } from "./views/IssueDetailPage";
import { type IssuesInitialData, IssuesPage } from "./views/IssuesPage";
import { type MyIssuesInitialData, MyIssuesPage, type ScopedIssue } from "./views/MyIssuesPage";
export interface IssuesLoaderData {
	readonly workspaceSlug: string;
	readonly initialData: IssuesInitialData;
}
interface IssueLoaderData {
	readonly scope: RequestScope;
	readonly workspaceSlug: string;
	readonly initialData: IssueDetailInitialData;
}
interface EpicsLoaderData {
	readonly workspaceSlug: string;
	readonly initialData: EpicsInitialData;
}
const CONCURRENCY = 4;
const SprintSchema = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	status: Schema.Literals(["planned", "active", "completed"]),
	startDate: Schema.NullOr(Schema.Number),
	endDate: Schema.NullOr(Schema.Number),
	goal: Schema.NullOr(Schema.String),
	projectId: Schema.String,
});
const SprintsSchema = Schema.Struct({ items: Schema.Array(SprintSchema) });
const SearchSchema = Schema.Array(
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
function workspaceSelection(scope: RequestScope) {
	return scope.selection.kind === "project" || scope.selection.kind === "workspace"
		? scope.selection.workspace
		: null;
}
function selectedProject(scope: RequestScope) {
	return scope.selection.kind === "project" ? scope.selection.project : null;
}
export function filteredIssueQuery(
	url: URL,
	projects: RequestScope["projects"],
	taskTypes: readonly { id: string; key: string }[],
	project: ReturnType<typeof selectedProject>
): URLSearchParams {
	const p = url.searchParams;
	const query = buildFilterQueryParams(
		{
			filterStatuses: (p.get("status") ?? "").split(",").filter(Boolean),
			filterPriorities: (p.get("priority") ?? "").split(",").filter(Boolean),
			filterProject: project?.key ?? "",
			filterType: p.get("type") ?? "",
			filterEpicId: p.get("epic") ?? "",
			filterSprintId: p.get("sprintId") ?? "",
			hideEpics: p.get("hideEpics") === "1",
			filterDateField:
				p.get("dateField") === "completed"
					? "completed"
					: p.get("dateField") === "updated"
						? "updated"
						: "",
			filterDateFrom: p.get("dateFrom") ?? "",
			filterDateTo: p.get("dateTo") ?? "",
		},
		projects,
		[...taskTypes]
	);
	for (const key of ["cursor", "limit", "assignee", "parentId", "noParent", "typeId"])
		if (p.has(key)) query.set(key, p.get(key) ?? "");
	if (!query.has("limit")) query.set("limit", "30");
	return query;
}
/** Sequential cursor paging stays in the request Effect scope and interruption channel. */
function allPages(
	api: RequestApi,
	workspaceSlug: string,
	query: URLSearchParams
): Effect.Effect<IssuePage, ApiError> {
	return Effect.gen(function* () {
		const page = normalizeIssuePage(
			yield* api
				.execute(api.get(`/api/issues?${query}`, { workspaceSlug }))
				.pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(IssuePageSchema)),
					Effect.mapError(responseError),
					Effect.scoped
				)
		);
		const items = [...page.items];
		let cursor = page.nextCursor;
		const seen = new Set<string>();
		while (cursor != null) {
			if (seen.has(String(cursor)))
				return yield* Effect.fail(
					new ApiError("schema", 502, "The API returned a repeated issue cursor.")
				);
			seen.add(String(cursor));
			const qs = new URLSearchParams(query);
			qs.set("cursor", String(cursor));
			const next = normalizeIssuePage(
				yield* api
					.execute(api.get(`/api/issues?${qs}`, { workspaceSlug }))
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(IssuePageSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					)
			);
			items.push(...next.items);
			cursor = next.nextCursor;
		}
		return {
			...page,
			items: items.map((entry) => ({ ...entry, workspaceSlug })),
			nextCursor: cursor,
		};
	});
}
function lookups(api: RequestApi, workspaceSlug: string) {
	return Effect.all(
		{
			statuses: api
				.execute(api.get("/api/task-statuses", { workspaceSlug }))
				.pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(StatusesSchema)),
					Effect.mapError(responseError),
					Effect.scoped
				)
				.pipe(Effect.map(normalizeStatuses)),
			taskTypes: api
				.execute(api.get("/api/task-types", { workspaceSlug }))
				.pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(TaskTypesSchema)),
					Effect.mapError(responseError),
					Effect.scoped
				)
				.pipe(Effect.map(normalizeTaskTypes)),
		},
		{ concurrency: CONCURRENCY }
	);
}
/** Workspace-wide Issues remains valid without selecting a project. */
export function loadIssues(
	api: RequestApi,
	scope: RequestScope,
	url: URL
): Effect.Effect<IssuesLoaderData | null, ApiError> {
	return Effect.gen(function* () {
		const workspace = workspaceSelection(scope);
		if (!workspace) return null;
		const workspaceSlug = workspace.slug,
			project = selectedProject(scope),
			projects = scope.projects.filter((entry) => entry.workspace_id === workspace.id);
		const { statuses, taskTypes } = yield* lookups(api, workspaceSlug);
		const query = filteredIssueQuery(url, projects, taskTypes, project),
			epicType = taskTypes.find((entry) => entry.key === "epic");
		const view =
			url.searchParams.get("view") === "board"
				? "board"
				: url.searchParams.get("view") === "backlog"
					? "backlog"
					: "list";
		if (view !== "list") {
			query.set("limit", "100");
			query.delete("cursor");
		}
		const epicQuery = new URLSearchParams({ typeId: epicType?.id ?? "", limit: "100" });
		if (project) epicQuery.set("project", project.id);
		const sprintId = url.searchParams.get("sprintId"),
			q = url.searchParams.get("q") ?? "";
		const { page, epics, sprints, sprintDetail, search } = yield* Effect.all(
			{
				page:
					view === "list"
						? api
								.execute(api.get(`/api/issues?${query}`, { workspaceSlug }))
								.pipe(
									Effect.flatMap(HttpClientResponse.schemaBodyJson(IssuePageSchema)),
									Effect.mapError(responseError),
									Effect.scoped
								)
								.pipe(Effect.map(normalizeIssuePage))
						: allPages(api, workspaceSlug, query),
				epics: epicType
					? allPages(api, workspaceSlug, epicQuery)
					: Effect.succeed({ items: [] } as IssuePage),
				sprints: project
					? api
							.execute(
								api.get(`/api/sprints?projectId=${encodeURIComponent(project.id)}&limit=100`, {
									workspaceSlug,
								})
							)
							.pipe(
								Effect.flatMap(HttpClientResponse.schemaBodyJson(SprintsSchema)),
								Effect.mapError(responseError),
								Effect.scoped
							)
					: Effect.succeed({ items: [] }),
				sprintDetail: sprintId
					? api
							.execute(api.get(`/api/sprints/${encodeURIComponent(sprintId)}`, { workspaceSlug }))
							.pipe(
								Effect.flatMap(HttpClientResponse.schemaBodyJson(SprintSchema)),
								Effect.mapError(responseError),
								Effect.scoped
							)
					: Effect.succeed(null),
				search: q
					? api
							.execute(
								api.get(
									`/api/issues/search?${new URLSearchParams({ q, ...(project ? { projectId: project.id } : {}) })}`,
									{ workspaceSlug }
								)
							)
							.pipe(
								Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchSchema)),
								Effect.mapError(responseError),
								Effect.scoped
							)
					: Effect.succeed(null),
			},
			{ concurrency: CONCURRENCY }
		);
		return {
			workspaceSlug,
			initialData: {
				currentUserId: scope.user.id,
				view,
				page: { ...page, items: page.items.map((entry) => ({ ...entry, workspaceSlug })) },
				statuses,
				taskTypes,
				project,
				projects,
				epics: epics.items,
				sprints: sprints.items.map((entry) => ({ ...entry })),
				sprintDetail,
				search: {
					query: q,
					results: search?.map((entry) => ({ ...entry, workspaceSlug })) ?? null,
				},
			},
		};
	});
}
export function renderIssues(
	api: RequestApi,
	scope: RequestScope,
	url: URL
): Effect.Effect<ReactElement, ApiError> {
	return Effect.gen(function* () {
		const data = yield* loadIssues(api, scope, url);
		return (
			<IssuesPage
				scope={scope}
				route={{ pathname: url.pathname, search: url.search }}
				{...(data ?? { workspaceSlug: "", initialData: null })}
			/>
		);
	});
}
type IssueRouteParams = Readonly<Record<string, string | undefined>>;

function issueIdentifier(url: URL, scope: RequestScope, params: IssueRouteParams): string | null {
	const id = url.searchParams.get("id");
	if (id) return id;
	if (!params.issueNumber || !params.projectSlug) return null;
	const project = selectedProject(scope);
	if (
		!project ||
		(params.projectSlug !== project.slug &&
			params.projectSlug.toLowerCase() !== project.key.toLowerCase())
	)
		return null;
	const number = Number(params.issueNumber);
	if (!/^\d+$/.test(params.issueNumber) || !Number.isSafeInteger(number) || number < 1)
		throw new ScopeError(400, "The issue reference is not valid.");
	// HttpRouter already decoded route parameters. titleSlug is cosmetic, never entity identity.
	return `${project.key}-${number}`;
}
export function loadIssue(
	api: RequestApi,
	scope: RequestScope,
	url: URL,
	params: IssueRouteParams = {}
): Effect.Effect<IssueLoaderData | null, ApiError | ScopeError> {
	return Effect.gen(function* () {
		const identifier = yield* Effect.try({
			try: () => issueIdentifier(url, scope, params),
			catch: () => new ScopeError(400, "The issue reference is not valid."),
		});
		if (!identifier) return null;
		const hint = url.searchParams.get("workspace");
		const workspace = hint
			? scope.workspaces.find((entry) => entry.slug === hint)
			: (workspaceSelection(scope) ?? (scope.workspaces.length === 1 ? scope.workspaces[0] : null));
		if (!workspace) return null;
		const workspaceSlug = workspace.slug;
		// Entity identity is first checked under authorized membership, then matched to the catalog.
		const issue = normalizeIssue(
			yield* api
				.execute(
					api.get(`/api/issues/${encodeURIComponent(identifier)}`, {
						workspaceSlug,
					})
				)
				.pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(IssueSchema)),
					Effect.mapError(responseError),
					Effect.scoped
				)
		);
		const project = scope.projects.find(
			(entry) => entry.id === issue.project_id && entry.workspace_id === workspace.id
		);
		if (!project) return null;
		const detailScope: RequestScope = {
			...scope,
			selection: { kind: "project", workspace, project },
		};
		const { comments, links, attachments, metadata, members, parent, children } = yield* Effect.all(
			{
				comments: api
					.execute(
						api.get(`/api/issues/${encodeURIComponent(issue.id)}/comments`, {
							workspaceSlug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(CommentsSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					)
					.pipe(Effect.map(normalizeComments)),
				links: api
					.execute(api.get(`/api/issues/${encodeURIComponent(issue.id)}/links`, { workspaceSlug }))
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(LinksSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					)
					.pipe(Effect.map(normalizeLinks)),
				attachments: api
					.execute(
						api.get(`/api/files?entityType=issue&entityId=${encodeURIComponent(issue.id)}`, {
							workspaceSlug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(AttachmentsSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					)
					.pipe(Effect.map(normalizeAttachments)),
				metadata: lookups(api, workspaceSlug),
				members: api
					.execute(
						api.get(`/api/workspaces/${encodeURIComponent(workspaceSlug)}`, {
							workspaceSlug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(MembersSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					)
					.pipe(Effect.map(normalizeMembers)),
				parent: issue.parent_id
					? api
							.execute(
								api.get(`/api/issues/${encodeURIComponent(issue.parent_id)}`, {
									workspaceSlug,
								})
							)
							.pipe(
								Effect.flatMap(HttpClientResponse.schemaBodyJson(IssueSchema)),
								Effect.mapError(responseError),
								Effect.scoped
							)
							.pipe(Effect.map(normalizeIssue))
					: Effect.succeed(null),
				children:
					issue.type_key === "epic"
						? allPages(
								api,
								workspaceSlug,
								new URLSearchParams({ parentId: issue.id, limit: "100" })
							)
						: Effect.succeed({ items: [] } as IssuePage),
			},
			{ concurrency: CONCURRENCY }
		);
		return {
			scope: detailScope,
			workspaceSlug,
			initialData: {
				issue: { ...issue, workspaceSlug },
				comments,
				links,
				attachments,
				...metadata,
				members: members.members,
				parent: parent ? { ...parent, workspaceSlug } : null,
				children: children.items,
				currentUserId: scope.user.id,
			},
		};
	});
}
export function renderIssue(
	api: RequestApi,
	scope: RequestScope,
	url: URL,
	params: IssueRouteParams = {}
): Effect.Effect<ReactElement, ApiError | ScopeError> {
	return Effect.gen(function* () {
		const data = yield* loadIssue(api, scope, url, params);
		return (
			<IssueDetailPage
				scope={data?.scope ?? scope}
				{...(data ?? { workspaceSlug: "", initialData: null })}
			/>
		);
	});
}
export function loadMyIssues(
	api: RequestApi,
	scope: RequestScope,
	url: URL
): Effect.Effect<MyIssuesInitialData, ApiError> {
	return Effect.gen(function* () {
		const memberships = scope.workspaces;
		const pages = yield* Effect.forEach(
			memberships,
			(workspace) =>
				allPages(
					api,
					workspace.slug,
					new URLSearchParams(issueListQuery(url, { assignee: "me", limit: "100" }))
				).pipe(Effect.map((page) => ({ workspace, page }))),
			{ concurrency: CONCURRENCY }
		);
		const issues: ScopedIssue[] = pages.flatMap(({ workspace, page }) =>
			page.items.map((issue) => ({ ...issue, workspaceSlug: workspace.slug }))
		);
		return { issues, memberships };
	});
}
export function renderMyIssues(
	api: RequestApi,
	scope: RequestScope,
	url: URL
): Effect.Effect<ReactElement, ApiError> {
	return Effect.gen(function* () {
		const initialData = yield* loadMyIssues(api, scope, url);
		return <MyIssuesPage scope={scope} initialData={initialData} />;
	});
}
export function loadEpics(
	api: RequestApi,
	scope: RequestScope,
	url: URL
): Effect.Effect<EpicsLoaderData | null, ApiError> {
	return Effect.gen(function* () {
		const workspace = workspaceSelection(scope),
			project = selectedProject(scope);
		if (!workspace || !project) return null;
		const workspaceSlug = workspace.slug;
		const { statuses, taskTypes } = yield* lookups(api, workspaceSlug),
			epic = taskTypes.find((entry) => entry.key === "epic");
		const qs = filteredIssueQuery(url, scope.projects, taskTypes, project);
		qs.set("includeRollups", "1");
		qs.set("limit", "100");
		if (epic) qs.set("typeId", epic.id);
		const page = epic ? yield* allPages(api, workspaceSlug, qs) : ({ items: [] } as IssuePage);
		return {
			workspaceSlug,
			initialData: {
				page,
				statuses,
				taskTypes,
				project,
				projects: scope.projects.filter((entry) => entry.workspace_id === workspace.id),
				search: url.search,
			},
		};
	});
}
export function renderEpics(
	api: RequestApi,
	scope: RequestScope,
	url: URL
): Effect.Effect<ReactElement, ApiError> {
	return Effect.gen(function* () {
		const data = yield* loadEpics(api, scope, url);
		return <EpicsPage scope={scope} {...(data ?? { workspaceSlug: "", initialData: null })} />;
	});
}
