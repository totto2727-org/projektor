import { Effect } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import type { ReactNode } from "react";
import { type RequestApi, type RequestScope, responseError } from "../../server";
import type { ApiError } from "../../server/errors";
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
	api: RequestApi,
	scope: RequestScope,
	url: URL
): Effect.Effect<ReactNode, ApiError> {
	return Effect.gen(function* () {
		const showArchived = url.searchParams.get("includeArchived") === "true";
		const projects = showArchived
			? yield* api
					.execute(api.get("/api/projects?includeArchived=true"))
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(ProjectSummariesSchema)),
						Effect.mapError(responseError),
						Effect.scoped
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
	api: RequestApi,
	scope: RequestScope,
	_url: URL
): Effect.Effect<ReactNode, ApiError> {
	if (scope.selection.kind !== "project")
		return Effect.succeed(<p className="text-text-muted">No project specified.</p>);
	const { project: selected, workspace } = scope.selection;
	return Effect.gen(function* () {
		const project = yield* api
			.execute(
				api.get(`/api/projects/${encodeURIComponent(selected.id)}`, {
					workspaceSlug: workspace.slug,
				})
			)
			.pipe(
				Effect.flatMap(HttpClientResponse.schemaBodyJson(ProjectSchema)),
				Effect.mapError(responseError),
				Effect.scoped
			);
		const { since, until } = sixWeekRange();
		const [issues, wiki, flow] = yield* Effect.all(
			[
				api
					.execute(
						api.get(`/api/issues?project=${encodeURIComponent(project.id)}`, {
							workspaceSlug: workspace.slug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(RecentIssuesResponseSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					),
				api
					.execute(
						api.get(`/api/wiki?projectId=${encodeURIComponent(project.id)}`, {
							workspaceSlug: workspace.slug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(RecentWikiPagesSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					),
				api
					.execute(
						api.get(
							`/api/projects/${encodeURIComponent(project.id)}/flow-metrics?${new URLSearchParams({ since: String(since), until: String(until), granularity: "week" })}`,
							{ workspaceSlug: workspace.slug }
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(FlowMetricsSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					),
			],
			{ concurrency: 3 }
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
	_url: URL
): Effect.Effect<ReactNode, never> {
	return Effect.succeed(<HelpPage />);
}
