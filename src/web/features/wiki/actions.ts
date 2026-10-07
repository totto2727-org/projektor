"use server";

import type { D1Database } from "@cloudflare/workers-types";
import * as wikiData from "#services/wiki";
import { listProjects } from "#services/projects";
import { and, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/http";
import { EFFRONT } from "../../effront";
import { RequestServices } from "../../request";
import { checkSameOriginMutation } from "../../server/api-client";
import { ApiError, responseError, ScopeError } from "../../server/errors";
import {
	authorizeDataEntity,
	dataError,
	requireDataDatabase,
	requireDataWorkspace,
	visibleProjectPredicate,
} from "../../server/data-context";
import type { RequestScope } from "../../server/request-context";
import { FunctionSelectorSchema, resolveFunctionContext } from "../../server/function-context";
import { EditFields } from "./form-schemas";
import { Created, Deleted, Draft, Ok, Page, Restored, SavedDraft, Verified } from "./schemas";

const identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Reference = Schema.Struct({ ...FunctionSelectorSchema.fields, slug: identifier });
const RevisionReference = Schema.Struct({ ...Reference.fields, revisionId: identifier });
const Create = Schema.Struct({
	...FunctionSelectorSchema.fields,
	title: EditFields.fields.title,
	slug: Schema.String.check(
		Schema.isMinLength(1),
		Schema.isMaxLength(200),
		Schema.isPattern(/^[a-z0-9-]+$/),
	),
	content: Schema.optional(EditFields.fields.content),
	parentId: Schema.optional(Schema.NullOr(Schema.String)),
	templateSlug: Schema.optional(identifier),
}).check(
	Schema.makeFilter(
		(value) =>
			!(value.content !== undefined && value.templateSlug !== undefined) ||
			"Choose template or content, not both.",
	),
);

/** A semantic wiki read boundary, not a request-path dispatcher. */
function readAuthorizedWikiPage(database: D1Database, scope: RequestScope, ref: string) {
	return Effect.gen(function* () {
		const { db, workspace } = yield* Effect.try({
			try: () => ({ db: requireDataDatabase(database), workspace: requireDataWorkspace(scope) }),
			catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
		});
		const page = yield* wikiData
			.findWikiPage(db, workspace.id, ref)
			.pipe(Effect.mapError(dataError));
		if (!page) return yield* new ApiError("http", 404, "Wiki page not found.");
		if (
			page.project_id !== null &&
			!scope.projects.some(
				(project) => project.id === page.project_id && project.workspace_id === workspace.id,
			)
		) {
			// Navigation catalogs omit archived projects. Reading an existing page
			// still follows the API's workspace/grant policy, without widening that catalog.
			const visibility = yield* Effect.try({
				try: () =>
					and(
						sql`projects.id = ${page.project_id}`,
						visibleProjectPredicate(scope, workspace.id, sql`projects.id`),
					),
				catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
			});
			const projects = yield* listProjects(db, workspace.id, {
				includeArchived: true,
				visibility,
			}).pipe(Effect.mapError(dataError));
			if (projects.length === 0)
				return yield* new ScopeError(404, "Selected project is not accessible.");
		} else {
			yield* Effect.try({
				try: () =>
					authorizeDataEntity(scope, workspace.id, { ...page, projectId: page.project_id }),
				catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
			});
		}
		return { db, workspace, page };
	});
}

function pageFreshness(page: {
	verified_at: number | null;
	verify_interval: number | null;
	status: string | null;
}) {
	const now = Math.floor(Date.now() / 1000);
	const due =
		page.verified_at !== null && page.verify_interval !== null
			? page.verified_at + page.verify_interval * 86400
			: null;
	if (page.status === null && page.verify_interval === null) return null;
	if (page.status === "stale" || page.status === "deprecated")
		return { state: "stale" as const, staleSince: due !== null && due <= now ? due : null };
	if (page.verify_interval !== null && page.verified_at === null)
		return { state: "unverified" as const, staleSince: null };
	return due !== null && due <= now
		? { state: "stale" as const, staleSince: due }
		: { state: "fresh" as const, staleSince: null };
}

export const getWikiPage = EFFRONT.ServerFn.make({
	input: Reference,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const { db, workspace, page } = yield* readAuthorizedWikiPage(
				services.db,
				ctx.scope,
				input.slug,
			);
			const value = yield* Schema.decodeUnknownEffect(Page)({
				...page,
				revisionId: yield* wikiData
					.getLatestWikiRevisionId(db, workspace.id, page.id)
					.pipe(Effect.mapError(dataError)),
				freshness: pageFreshness(page),
			}).pipe(Effect.mapError(dataError));
			return { ok: true, value } as const;
		}).pipe(
			Effect.catchTags({
				ApiError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				ScopeError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
			}),
		),
});

export const getWikiRevisionDiff = EFFRONT.ServerFn.make({
	input: RevisionReference,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const { db, workspace, page } = yield* readAuthorizedWikiPage(
				services.db,
				ctx.scope,
				input.slug,
			);
			const revision = yield* wikiData
				.getWikiRevision(db, workspace.id, page.id, input.revisionId)
				.pipe(Effect.mapError(dataError));
			if (!revision) return yield* new ApiError("http", 404, "Revision not found.");
			const value = { diff: wikiData.buildUnifiedDiff(revision.content, page.content) };
			return { ok: true, value } as const;
		}).pipe(
			Effect.catchTags({
				ApiError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				ScopeError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
			}),
		),
});

export const getWikiDraft = EFFRONT.ServerFn.make({
	input: Reference,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const { db, workspace, page } = yield* readAuthorizedWikiPage(
				services.db,
				ctx.scope,
				input.slug,
			);
			const value = yield* wikiData
				.getWikiDraft(db, workspace.id, page.id, ctx.scope.user.id)
				.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Draft)), Effect.mapError(dataError));
			return { ok: true, value } as const;
		}).pipe(
			Effect.catchTags({
				ApiError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				ScopeError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
			}),
		),
});

export const createWikiPage = EFFRONT.ServerFn.make({
	input: Create,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send("/api/wiki", {
							method: "POST",
							workspaceSlug: ctx.workspaceSlug,
							json: {
								title: input.title,
								slug: input.slug,
								...(input.templateSlug
									? { templateSlug: input.templateSlug }
									: { content: input.content ?? "" }),
								...(input.parentId ? { parentId: input.parentId } : {}),
								...(ctx.projectId ? { projectId: ctx.projectId } : {}),
							},
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Created)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

export const duplicateWikiPage = EFFRONT.ServerFn.make({
	input: Reference,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const { page } = yield* readAuthorizedWikiPage(services.db, ctx.scope, input.slug);
				const value = yield* ctx.api
					.execute(
						ctx.api.send("/api/wiki", {
							method: "POST",
							workspaceSlug: ctx.workspaceSlug,
							json: {
								title: `${page.title} (copy)`,
								slug: `${page.slug}-copy-${crypto.randomUUID().slice(0, 8)}`,
								content: page.content,
								...(page.parent_id ? { parentId: page.parent_id } : {}),
								...(page.project_id ? { projectId: page.project_id } : {}),
							},
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Created)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

export const saveWikiPage = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...Reference.fields, ...EditFields.fields }),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/wiki/${encodeURIComponent(input.slug)}`, {
							method: "PUT",
							workspaceSlug: ctx.workspaceSlug,
							json: {
								title: input.title,
								content: input.content,
								...(input.baseRevisionId !== undefined
									? { baseRevisionId: input.baseRevisionId }
									: {}),
							},
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				yield* ctx.api
					.execute(
						ctx.api.send(`/api/wiki/${encodeURIComponent(input.slug)}/draft`, {
							method: "DELETE",
							workspaceSlug: ctx.workspaceSlug,
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped,
						Effect.catchTag("ApiError", () => Effect.succeed(null)),
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

export const saveWikiDraft = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...Reference.fields, ...EditFields.fields }),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/wiki/${encodeURIComponent(input.slug)}/draft`, {
							method: "PUT",
							workspaceSlug: ctx.workspaceSlug,
							json: {
								title: input.title,
								content: input.content,
								baseRevisionId: input.baseRevisionId ?? null,
							},
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(SavedDraft)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

export const discardWikiDraft = EFFRONT.ServerFn.make({
	input: Reference,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/wiki/${encodeURIComponent(input.slug)}/draft`, {
							method: "DELETE",
							workspaceSlug: ctx.workspaceSlug,
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

export const moveWikiPage = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...Reference.fields, parentId: Schema.NullOr(Schema.String) }),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/wiki/${encodeURIComponent(input.slug)}`, {
							method: "PUT",
							workspaceSlug: ctx.workspaceSlug,
							json: { parentId: input.parentId },
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

export const verifyWikiPage = EFFRONT.ServerFn.make({
	input: Reference,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/wiki/${encodeURIComponent(input.slug)}/verify`, {
							method: "POST",
							workspaceSlug: ctx.workspaceSlug,
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Verified)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

export const trashWikiPage = EFFRONT.ServerFn.make({
	input: Reference,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/wiki/${encodeURIComponent(input.slug)}?cascade=true`, {
							method: "DELETE",
							workspaceSlug: ctx.workspaceSlug,
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Deleted)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

export const restoreTrashedWikiPage = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...FunctionSelectorSchema.fields, pageId: identifier }),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/wiki/trash/${encodeURIComponent(input.pageId)}/undelete`, {
							method: "POST",
							workspaceSlug: ctx.workspaceSlug,
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Restored)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

export const restoreWikiRevision = EFFRONT.ServerFn.make({
	input: Schema.Struct({
		...RevisionReference.fields,
		baseRevisionId: Schema.NullOr(Schema.String),
	}),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const { db, workspace, page } = yield* readAuthorizedWikiPage(
					services.db,
					ctx.scope,
					input.slug,
				);
				const revision = yield* wikiData
					.getWikiRevision(db, workspace.id, page.id, input.revisionId)
					.pipe(Effect.mapError(dataError));
				if (!revision) return yield* new ApiError("http", 404, "Revision not found.");
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/wiki/${encodeURIComponent(input.slug)}`, {
							method: "PUT",
							workspaceSlug: ctx.workspaceSlug,
							json: {
								content: revision.content,
								baseRevisionId: input.baseRevisionId,
								summary: `Restored from revision dated ${new Date(revision.created_at * 1000).toISOString()}`,
							},
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

export const deleteWikiAttachment = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...FunctionSelectorSchema.fields, attachmentId: identifier }),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/files/${encodeURIComponent(input.attachmentId)}`, {
							method: "DELETE",
							workspaceSlug: ctx.workspaceSlug,
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
