"use server";

import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import { EFFRONT } from "../../effront";
import { RequestServices } from "../../request";
import { checkSameOriginMutation } from "../../server/api-client";
import { responseError } from "../../server/errors";
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
		Schema.isPattern(/^[a-z0-9-]+$/)
	),
	content: Schema.optional(EditFields.fields.content),
	parentId: Schema.optional(Schema.NullOr(Schema.String)),
	templateSlug: Schema.optional(identifier),
}).check(
	Schema.makeFilter(
		(value) =>
			!(value.content !== undefined && value.templateSlug !== undefined) ||
			"Choose template or content, not both."
	)
);

export const getWikiPage = EFFRONT.ServerFn.make({
	input: Reference,
	handler: (input) =>
		Effect.gen(function* () {
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const value = yield* ctx.api
				.execute(
					ctx.api.get(`/api/wiki/${encodeURIComponent(input.slug)}`, {
						workspaceSlug: ctx.workspaceSlug,
					})
				)
				.pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Page)),
					Effect.mapError(responseError),
					Effect.scoped
				);
			return { ok: true, value } as const;
		}).pipe(
			Effect.catchTags({
				ApiError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				ScopeError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
			})
		),
});

export const getWikiRevisionDiff = EFFRONT.ServerFn.make({
	input: RevisionReference,
	handler: (input) =>
		Effect.gen(function* () {
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const value = yield* ctx.api
				.execute(
					ctx.api.get(
						`/api/wiki/${encodeURIComponent(input.slug)}/revisions/${encodeURIComponent(input.revisionId)}/diff?against=current`,
						{ workspaceSlug: ctx.workspaceSlug }
					)
				)
				.pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ diff: Schema.String }))),
					Effect.mapError(responseError),
					Effect.scoped
				);
			return { ok: true, value } as const;
		}).pipe(
			Effect.catchTags({
				ApiError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				ScopeError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
			})
		),
});

export const getWikiDraft = EFFRONT.ServerFn.make({
	input: Reference,
	handler: (input) =>
		Effect.gen(function* () {
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const value = yield* ctx.api
				.execute(
					ctx.api.get(`/api/wiki/${encodeURIComponent(input.slug)}/draft`, {
						workspaceSlug: ctx.workspaceSlug,
					})
				)
				.pipe(
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Draft)),
					Effect.mapError(responseError),
					Effect.scoped
				);
			return { ok: true, value } as const;
		}).pipe(
			Effect.catchTags({
				ApiError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				ScopeError: (e) =>
					Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
			})
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
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Created)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate)
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
				const page = yield* ctx.api
					.execute(
						ctx.api.get(`/api/wiki/${encodeURIComponent(input.slug)}`, {
							workspaceSlug: ctx.workspaceSlug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Page)),
						Effect.mapError(responseError),
						Effect.scoped
					);
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
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Created)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate)
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
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				yield* ctx.api
					.execute(
						ctx.api.send(`/api/wiki/${encodeURIComponent(input.slug)}/draft`, {
							method: "DELETE",
							workspaceSlug: ctx.workspaceSlug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped,
						Effect.catchTag("ApiError", () => Effect.succeed(null))
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate)
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
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(SavedDraft)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate)
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
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate)
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
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate)
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
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Verified)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate)
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
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Deleted)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate)
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
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Restored)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate)
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
				const revision = yield* ctx.api
					.execute(
						ctx.api.get(
							`/api/wiki/${encodeURIComponent(input.slug)}/revisions/${encodeURIComponent(input.revisionId)}`,
							{ workspaceSlug: ctx.workspaceSlug }
						)
					)
					.pipe(
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(
								Schema.Struct({ content: Schema.String, created_at: Schema.Number })
							)
						),
						Effect.mapError(responseError),
						Effect.scoped
					);
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
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate)
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
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Ok)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true, value } as const;
			}).pipe(
				Effect.catchTags({
					ApiError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
					ScopeError: (e) =>
						Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
