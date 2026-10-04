import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import type React from "react";
import { loadBrand } from "../../brand";
import type { RequestApi } from "../../server/api-client";
import { ApiError, responseError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
import {
	Attachment,
	Draft,
	ListItem,
	Page,
	Revision,
	SearchResult,
	StalePage,
	Template,
	Tree,
} from "./schemas";
import { WikiPageClient, type WikiSeed } from "./WikiPageClient";

/** Original full Wiki tree. All primary data and lookups belong to this request Effect. */
export function renderWiki(
	api: RequestApi,
	scope: RequestScope,
	url: URL,
	params: Readonly<Record<string, string | undefined>> = {}
): Effect.Effect<React.ReactElement, ApiError> {
	return Effect.gen(function* () {
		const workspace =
			scope.selection.kind === "project" || scope.selection.kind === "workspace"
				? scope.selection.workspace
				: scope.workspaces.length === 1
					? scope.workspaces[0]
					: null;
		if (!workspace)
			return (
				<section className="p-6 bg-surface border border-border rounded-lg">
					<h1>Choose a workspace</h1>
					<p className="text-text-muted">Select a workspace before opening the wiki.</p>
				</section>
			);
		const workspaceSlug = workspace.slug;
		const ref = params.slug ?? url.searchParams.get("slug") ?? url.searchParams.get("id") ?? "";
		const projectId =
			scope.selection.kind === "project" && url.searchParams.get("scope") !== "workspace"
				? scope.selection.project.id
				: "";
		const mode =
			/\/wiki\/new\/?$/.test(url.pathname) || url.searchParams.get("createTitle")
				? "create"
				: /\/edit\/?$/.test(url.pathname)
					? "edit"
					: "read";
		const filterType = url.searchParams.get("type") ?? "";
		const filterStatus = url.searchParams.get("status") ?? "";
		const filterTags = url.searchParams.get("tags") ?? "";
		const searchQuery = url.searchParams.get("q") ?? "";
		const scoped = new URLSearchParams();
		if (projectId) {
			scoped.set("projectId", projectId);
			scoped.set("includeWorkspacePages", "1");
		}
		const browse = new URLSearchParams(scoped);
		if (filterType) browse.set("type", filterType);
		if (filterStatus) browse.set("status", filterStatus);
		if (filterTags) browse.set("tags", filterTags);
		const search = new URLSearchParams(browse);
		if (searchQuery) search.set("q", searchQuery);
		const page = ref
			? yield* api.execute(api.get(`/api/wiki/${encodeURIComponent(ref)}`, { workspaceSlug })).pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Page)),
					Effect.mapError(responseError),
					Effect.scoped,
					Effect.catchIf(
						(cause) => cause.status === 404,
						() => Effect.succeed(null)
					)
				)
			: null;
		// The API checks access. A URL project hint never authorizes an entity.
		if (
			page?.project_id &&
			!scope.projects.some(
				(project) => project.id === page.project_id && project.workspace_slug === workspaceSlug
			)
		)
			return yield* Effect.fail(new ApiError("http", 404, "Wiki page not found."));
		const data = yield* Effect.all(
			{
				brand: loadBrand(api, scope),
				tree: api
					.execute(api.get(`/api/wiki/tree?${scoped}`, { workspaceSlug }))
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Tree)),
						Effect.mapError(responseError),
						Effect.scoped
					),
				templates: api
					.execute(api.get("/api/wiki/templates", { workspaceSlug }))
					.pipe(
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(Schema.mutable(Schema.Array(Template)))
						),
						Effect.mapError(responseError),
						Effect.scoped
					),
				stalePages: api
					.execute(api.get(`/api/wiki/stale-pages?${scoped}`, { workspaceSlug }))
					.pipe(
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(Schema.mutable(Schema.Array(StalePage)))
						),
						Effect.mapError(responseError),
						Effect.scoped
					),
				filteredPages:
					filterType || filterStatus || filterTags
						? api
								.execute(api.get(`/api/wiki?${browse}`, { workspaceSlug }))
								.pipe(
									Effect.flatMap(
										HttpClientResponse.schemaBodyJson(Schema.mutable(Schema.Array(ListItem)))
									),
									Effect.mapError(responseError),
									Effect.scoped
								)
						: Effect.succeed([]),
				searchResults: searchQuery
					? api
							.execute(api.get(`/api/wiki/search?${search}`, { workspaceSlug }))
							.pipe(
								Effect.flatMap(
									HttpClientResponse.schemaBodyJson(Schema.mutable(Schema.Array(SearchResult)))
								),
								Effect.mapError(responseError),
								Effect.scoped
							)
					: Effect.succeed([]),
				revisions: page
					? api
							.execute(
								api.get(`/api/wiki/${encodeURIComponent(page.slug)}/revisions`, { workspaceSlug })
							)
							.pipe(
								Effect.flatMap(
									HttpClientResponse.schemaBodyJson(Schema.mutable(Schema.Array(Revision)))
								),
								Effect.mapError(responseError),
								Effect.scoped
							)
					: Effect.succeed([]),
				attachments: page
					? api
							.execute(
								api.get(
									`/api/files?${new URLSearchParams({ entityType: "wiki_page", entityId: page.id })}`,
									{ workspaceSlug }
								)
							)
							.pipe(
								Effect.flatMap(
									HttpClientResponse.schemaBodyJson(Schema.mutable(Schema.Array(Attachment)))
								),
								Effect.mapError(responseError),
								Effect.scoped
							)
					: Effect.succeed([]),
				// A failed optional draft read disables autosave, rather than replacing an unseen draft.
				draftResult:
					page && scope.user.email !== "public-viewer@projektor.local"
						? api
								.execute(
									api.get(`/api/wiki/${encodeURIComponent(page.slug)}/draft`, { workspaceSlug })
								)
								.pipe(
									Effect.flatMap(HttpClientResponse.schemaBodyJson(Draft)),
									Effect.mapError(responseError),
									Effect.scoped,
									Effect.map((draft) => ({ draft, status: "ready" as const })),
									Effect.catch(() => Effect.succeed({ draft: null, status: "failed" as const }))
								)
						: Effect.succeed({ draft: null, status: "ready" as const }),
			},
			{ concurrency: 4 }
		);
		const initial: WikiSeed = {
			page,
			tree: data.tree,
			templates: data.templates,
			stalePages: data.stalePages,
			filteredPages: data.filteredPages,
			searchResults: data.searchResults,
			revisions: data.revisions,
			attachments: data.attachments,
			draft: data.draftResult.draft,
			draftStatus: data.draftResult.status,
			projects: scope.projects
				.filter((project) => project.workspace_slug === workspaceSlug)
				.map((project) => ({
					id: project.id,
					key: project.key,
					name: project.name,
					workspace_slug: project.workspace_slug,
				})),
			workspaceSlug,
			projectId,
			slug: ref,
			filterType,
			filterStatus,
			filterTags,
			searchQuery,
			createTitle: url.searchParams.get("createTitle") ?? "",
			mode,
			publicViewer: scope.user.email === "public-viewer@projektor.local",
			brandName: data.brand.name,
		};
		return <WikiPageClient initial={initial} />;
	});
}
