import { Effect } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import type React from "react";
import type { RequestApi } from "../../server/api-client";
import { type ApiError, responseError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
import { FeedbackDetailClient } from "./FeedbackDetailClient";
import { FeedbackGridClient } from "./FeedbackGridClient";

import { Rows, SourceLookup, Sources, Summaries } from "./schemas";

function NeedProject() {
	return (
		<section className="p-6 bg-surface border border-border rounded-lg">
			<h1 className="m-0">Choose a project</h1>
			<p className="text-text-muted">Feedback sources are managed within a project.</p>
		</section>
	);
}
function NotFound() {
	return (
		<section className="p-6 text-center text-text-muted bg-surface rounded-lg border border-border">
			Feedback source not found.
		</section>
	);
}

/** Grid requires a resolved project. Source and version summary schemas are request-owned. */
export function renderFeedback(
	api: RequestApi,
	scope: RequestScope,
	_url: URL
): Effect.Effect<React.ReactElement, ApiError> {
	return Effect.gen(function* () {
		if (scope.selection.kind !== "project") return <NeedProject />;
		const { project, workspace } = scope.selection;
		const { sources, summaries } = yield* Effect.all(
			{
				sources: api
					.execute(
						api.get(`/api/projects/${project.id}/feedback-sources`, {
							workspaceSlug: workspace.slug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Sources)),
						Effect.mapError(responseError),
						Effect.scoped
					),
				summaries: api
					.execute(
						api.get(`/api/projects/${project.id}/feedback/summary`, {
							workspaceSlug: workspace.slug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Summaries)),
						Effect.mapError(responseError),
						Effect.scoped
					),
			},
			{ concurrency: 2 }
		);
		return (
			<FeedbackGridClient
				key={`${workspace.slug}:${project.id}`}
				initialSources={sources}
				initialSummaries={summaries}
				projectId={project.id}
				workspaceSlug={workspace.slug}
			/>
		);
	});
}

/** Resolve an entity through authorized memberships, then derive its real project. */
export function renderFeedbackDetail(
	api: RequestApi,
	scope: RequestScope,
	url: URL,
	params: Readonly<Record<string, string | undefined>> = {}
): Effect.Effect<React.ReactElement, ApiError> {
	return Effect.gen(function* () {
		const sourceId =
			params.sourceId ?? url.searchParams.get("sourceId") ?? url.searchParams.get("id");
		if (!sourceId) return <NotFound />;
		const chosen =
			scope.selection.kind === "workspace" || scope.selection.kind === "project"
				? scope.selection.workspace
				: null;
		const candidates = chosen ? [chosen] : scope.workspaces;
		let entity: { projectId: string; workspaceSlug: string } | null = null;
		for (const workspace of candidates) {
			const source = yield* api
				.execute(
					api.get(`/api/feedback-sources/${encodeURIComponent(sourceId)}`, {
						workspaceSlug: workspace.slug,
					})
				)
				.pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(SourceLookup)),
					Effect.mapError(responseError),
					Effect.scoped,
					Effect.catchIf(
						(cause) => [403, 404].includes(cause.status),
						() => Effect.succeed(null)
					)
				);
			if (!source) continue;
			if (
				!scope.projects.some(
					(project) => project.id === source.projectId && project.workspace_slug === workspace.slug
				)
			)
				return <NotFound />;
			entity = { projectId: source.projectId, workspaceSlug: workspace.slug };
			break;
		}
		if (!entity) return <NotFound />;
		const { projectId, workspaceSlug } = entity;
		const filters = new URLSearchParams({ sourceId });
		const initialStatus = url.searchParams.get("status") ?? "";
		if (initialStatus) filters.set("status", initialStatus);
		const { sources, rows, summaries } = yield* Effect.all(
			{
				sources: api
					.execute(api.get(`/api/projects/${projectId}/feedback-sources`, { workspaceSlug }))
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Sources)),
						Effect.mapError(responseError),
						Effect.scoped
					),
				rows: api
					.execute(api.get(`/api/projects/${projectId}/feedback?${filters}`, { workspaceSlug }))
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Rows)),
						Effect.mapError(responseError),
						Effect.scoped
					),
				summaries: api
					.execute(
						api.get(`/api/projects/${projectId}/feedback/summary`, {
							workspaceSlug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Summaries)),
						Effect.mapError(responseError),
						Effect.scoped
					),
			},
			{ concurrency: 3 }
		);
		const source = sources.find((item) => item.id === sourceId);
		if (!source) return <NotFound />;
		const tab = url.searchParams.get("tab");
		const initialTab = tab === "summary" || tab === "settings" ? tab : "items";
		return (
			<FeedbackDetailClient
				key={`${workspaceSlug}:${sourceId}`}
				initialSource={source}
				initialSources={sources}
				initialRows={rows}
				initialSummary={summaries.find((item) => item.sourceId === sourceId) ?? null}
				initialStatus={initialStatus}
				initialTab={initialTab}
				projectId={projectId}
				workspaceSlug={workspaceSlug}
			/>
		);
	});
}
