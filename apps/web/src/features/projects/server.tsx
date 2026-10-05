import { getFlowMetrics } from "@projektor/data-services/flow-metrics";
import { listIssues } from "@projektor/data-services/issues";
import { findProjectById, listProjectSummaries } from "@projektor/data-services/projects";
import { listWikiPages } from "@projektor/data-services/wiki";
import { sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { ReactNode } from "react";
import { RequestServices } from "../../request";
import { type RequestApi, type RequestScope } from "../../server";
import {
	dataError,
	projectSummaryVisibility,
	requireAuthenticatedDataSession,
	requireDataProject,
	requireDataWorkspace,
	visibleProjectPredicate,
} from "../../server/data-context";
import { type ApiError, ScopeError } from "../../server/errors";
import { HelpPage } from "../help/HelpPage";
import { ProjectLanding } from "./ProjectLanding";
import { ProjectList } from "./ProjectList";
import {
	FlowMetricsSchema,
	ProjectSchema,
	ProjectSummariesSchema,
	RecentIssuesResponseSchema,
	RecentWikiPagesSchema,
} from "./schemas";

function sortByRecency<T extends { updated_at: number }>(items: readonly T[], limit: number): T[] {
	return [...items].sort((left, right) => right.updated_at - left.updated_at).slice(0, limit);
}
function sixWeekRange(now = new Date()): { since: number; until: number } {
	const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 35);
	const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	return {
		since: Math.floor(monday.getTime() / 1000),
		until: Math.floor(midnight / 1000) + 86_399,
	};
}

export function renderProjects(
	_api: RequestApi,
	scope: RequestScope,
	url: URL,
): Effect.Effect<ReactNode, ApiError | ScopeError, RequestServices> {
	return Effect.gen(function* () {
		const services = yield* RequestServices;
		yield* Effect.try({
			try: () => requireAuthenticatedDataSession(scope),
			catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
		});
		const showArchived = url.searchParams.get("includeArchived") === "true";
		const projects = showArchived
			? yield* listProjectSummaries(
					services.db,
					scope.user.id,
					projectSummaryVisibility(scope.user.id),
					true,
				).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(ProjectSummariesSchema)),
					Effect.mapError(dataError),
				)
			: scope.projects;
		return (
			<ProjectList
				initialProjects={projects}
				memberships={scope.workspaces}
				showArchived={showArchived}
			/>
		);
	});
}

export function renderOverview(
	_api: RequestApi,
	scope: RequestScope,
	_url: URL,
): Effect.Effect<ReactNode, ApiError | ScopeError, RequestServices> {
	if (scope.selection.kind !== "project")
		return Effect.succeed(<p className="text-text-muted">No project specified.</p>);
	const { project: selected, workspace } = scope.selection;
	return Effect.gen(function* () {
		const services = yield* RequestServices;
		yield* Effect.try({
			try: () => {
				requireDataWorkspace(scope, workspace.id);
				requireDataProject(scope, selected.id, workspace.id);
			},
			catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
		});
		const row = yield* findProjectById(services.db, workspace.id, selected.id).pipe(
			Effect.mapError(dataError),
		);
		if (!row) return yield* new ScopeError(404, "Selected project is not accessible.");
		// The shared Drizzle model is explicitly projected into the page's existing DTO.
		const project = yield* Schema.decodeUnknownEffect(ProjectSchema)({
			id: row.id,
			name: row.name,
			key: row.key,
			slug: row.slug,
			description: row.description,
			archivedAt: row.archivedAt,
			workspaceId: row.workspaceId,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}).pipe(Effect.mapError(dataError));
		const { since, until } = sixWeekRange();
		const [issues, wiki, flow] = yield* Effect.all(
			[
				listIssues(
					services.db,
					workspace.id,
					{ projectId: project.id, limit: 30 },
					visibleProjectPredicate(scope, workspace.id, sql`issues.project_id`),
				).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(RecentIssuesResponseSchema)),
					Effect.mapError(dataError),
				),
				listWikiPages(services.db, workspace.id, {
					projectId: project.id,
					visibility: visibleProjectPredicate(scope, workspace.id, sql`wiki_pages.project_id`),
				}).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(RecentWikiPagesSchema)),
					Effect.mapError(dataError),
				),
				getFlowMetrics(services.db, workspace.id, {
					projectId: project.id,
					since,
					until,
					granularity: "week",
				}).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(FlowMetricsSchema)),
					Effect.mapError(dataError),
				),
			],
			{ concurrency: 3 },
		);
		return (
			<ProjectLanding
				initialProject={project}
				initialIssues={sortByRecency(issues.items, 5)}
				initialWiki={sortByRecency(wiki, 5)}
				initialFlow={flow}
				workspaceSlug={workspace.slug}
				canEdit={
					workspace.role === "owner" || workspace.role === "admin" || workspace.role === "member"
				}
			/>
		);
	});
}

export function renderHelp(
	_api: RequestApi,
	_scope: RequestScope | null,
	_url: URL,
): Effect.Effect<ReactNode, never> {
	return Effect.succeed(<HelpPage />);
}
