import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import type { RequestApi } from "../../server/api-client";
import { ApiError, responseError, ScopeError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
import { dateEpochEnd, dateEpochStart, rangeFromUrl } from "./helpers";
import { MetricsWindowSchema, SprintListModeSchema } from "./input-schemas";
import { HeatmapSchema, IssuePageSchema, MetricsSchema, SprintsSchema } from "./schemas";
import type { SprintIssue } from "./types";
import { MetricsDashboard, SprintManager } from "./widgets";

/** Fully page scoped issue DTOs on the server, including completed velocity history. */
export function loadSprintIssues(api: RequestApi, projectId: string, workspaceSlug: string) {
	return Effect.gen(function* () {
		const issues: SprintIssue[] = [];
		const cursors = new Set<string>();
		let cursor: string | null = null;
		do {
			const query = new URLSearchParams({ project: projectId, limit: "100" });
			if (cursor) query.set("cursor", cursor);
			const page = yield* api
				.execute(api.get(`/api/issues?${query}`, { workspaceSlug }))
				.pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(IssuePageSchema)),
					Effect.mapError(responseError),
					Effect.scoped
				);
			issues.push(...page.items);
			cursor = page.nextCursor;
			if (cursor && cursors.has(cursor))
				return yield* Effect.fail(new ApiError("schema", 502, "Repeated issue pagination cursor"));
			if (cursor) cursors.add(cursor);
		} while (cursor);
		return issues;
	});
}
export function renderSprints(api: RequestApi, scope: RequestScope, url: URL) {
	return Effect.gen(function* () {
		if (scope.selection.kind !== "project")
			return <p className="text-text-muted">Select a project to view its sprints.</p>;
		const { project, workspace } = scope.selection;
		const mode = yield* Schema.decodeUnknownEffect(SprintListModeSchema)(
			url.searchParams.get("status") ?? "all"
		).pipe(Effect.mapError(() => new ScopeError(400, "Invalid sprint status view.")));
		const [sprints, issues] = yield* Effect.all(
			[
				api
					.execute(
						api.get(`/api/sprints?projectId=${encodeURIComponent(project.id)}`, {
							workspaceSlug: workspace.slug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(SprintsSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					),
				loadSprintIssues(api, project.id, workspace.slug),
			],
			{ concurrency: 2 }
		);
		return (
			<SprintManager
				key={`${workspace.slug}:${project.id}`}
				project={project}
				projectId={project.id}
				workspaceSlug={workspace.slug}
				initialSprints={
					mode === "all" ? sprints.items : sprints.items.filter((sprint) => sprint.status === mode)
				}
				allSprints={sprints.items}
				mode={mode}
				initialIssues={issues}
			/>
		);
	});
}
export function renderMetrics(api: RequestApi, scope: RequestScope, url: URL) {
	return Effect.gen(function* () {
		if (scope.selection.kind !== "project")
			return <p className="text-text-muted">Select a project to view metrics.</p>;
		const { project, workspace } = scope.selection;
		const fallback = rangeFromUrl(new URL(url.pathname, url.origin));
		const window = yield* Schema.decodeUnknownEffect(MetricsWindowSchema)({
			projectId: project.id,
			workspaceSlug: workspace.slug,
			since: url.searchParams.get("since") ?? fallback.since,
			until: url.searchParams.get("until") ?? fallback.until,
			granularity: url.searchParams.get("granularity") ?? fallback.granularity,
			heatmapMode: url.searchParams.get("heatmapMode") ?? "claims",
			prefix: url.searchParams.get("prefix") ?? "",
		}).pipe(
			Effect.mapError(() => new ScopeError(400, "Invalid metrics date range or chart options."))
		);
		const range = { since: window.since, until: window.until, granularity: window.granularity };
		const mode = window.heatmapMode;
		const params = new URLSearchParams({
			since: String(dateEpochStart(range.since)),
			until: String(dateEpochEnd(range.until)),
			granularity: range.granularity,
		});
		const heatmapParams = new URLSearchParams({
			since: params.get("since") ?? "",
			until: params.get("until") ?? "",
			mode,
		});
		const prefix = window.prefix;
		if (prefix) heatmapParams.set("prefix", prefix);
		const [metrics, heatmap] = yield* Effect.all(
			[
				api
					.execute(
						api.get(`/api/projects/${encodeURIComponent(project.id)}/flow-metrics?${params}`, {
							workspaceSlug: workspace.slug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(MetricsSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					),
				api
					.execute(
						api.get(
							`/api/projects/${encodeURIComponent(project.id)}/code-heatmap?${heatmapParams}`,
							{ workspaceSlug: workspace.slug }
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(HeatmapSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					)
					.pipe(
						Effect.map((data) => ({ data, error: null })),
						Effect.catch(() =>
							Effect.succeed({
								data: null,
								error: "Failed to load code heatmap. Try applying the range again.",
							})
						)
					),
			],
			{ concurrency: 2 }
		);
		// Canonical links carry the selected project/workspace and the effective default range.
		const canonical = new URL(url);
		canonical.searchParams.set("projectId", project.id);
		canonical.searchParams.set("workspace", workspace.slug);
		canonical.searchParams.set("since", range.since);
		canonical.searchParams.set("until", range.until);
		canonical.searchParams.set("granularity", range.granularity);
		return (
			<MetricsDashboard
				key={`${workspace.slug}:${project.id}:${range.since}:${range.until}:${range.granularity}:${mode}:${prefix}`}
				projectId={project.id}
				workspaceSlug={workspace.slug}
				initialMetrics={metrics}
				initialUrl={canonical.toString()}
				initialRange={range}
				initialHeatmap={heatmap.data}
				heatmapMode={mode}
				heatmapError={heatmap.error}
			/>
		);
	});
}
