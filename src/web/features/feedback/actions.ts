"use server";

import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/http";
import { EFFRONT } from "../../effront";
import { RequestServices } from "../../request";
import { checkSameOriginMutation } from "../../server/api-client";
import { responseError } from "../../server/errors";
import { FunctionSelectorSchema, resolveFunctionContext } from "../../server/function-context";
import { Converted, CreatedSource, Ok, SourceFields } from "./schemas";

const identifier = Schema.String.check(Schema.isMinLength(1));
const SourceReference = Schema.Struct({
	...FunctionSelectorSchema.fields,
	projectId: identifier,
	sourceId: identifier,
});
const FeedbackReference = Schema.Struct({
	...FunctionSelectorSchema.fields,
	projectId: identifier,
	feedbackId: identifier,
});
const Bulk = Schema.Struct({
	...FunctionSelectorSchema.fields,
	projectId: identifier,
	feedbackIds: Schema.mutable(Schema.Array(identifier)).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(500),
	),
});

export const createFeedbackSource = EFFRONT.ServerFn.make({
	// Previous React action state is transport protocol, not domain data.
	input: [
		Schema.Unknown,
		Schema.fromFormData(
			Schema.Struct({
				...FunctionSelectorSchema.fields,
				projectId: identifier,
				...SourceFields.fields,
			}),
		),
	] as const,
	handler: (_previousState, input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireProject: true });
				const origins = input.origins
					.split(/[\n,]/)
					.map((value) => value.trim())
					.filter(Boolean);
				const value = yield* ctx.api
					.execute(
						ctx.api.send(
							`/api/projects/${encodeURIComponent(ctx.projectId ?? "")}/feedback-sources`,
							{
								method: "POST",
								workspaceSlug: ctx.workspaceSlug,
								json: {
									name: input.name.trim(),
									...(input.description.trim() ? { description: input.description.trim() } : {}),
									...(origins.length ? { allowedOrigins: origins } : {}),
								},
							},
						),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(CreatedSource)),
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

export const setFeedbackSourceActive = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...SourceReference.fields, active: Schema.Boolean }),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireProject: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(
							`/api/projects/${encodeURIComponent(ctx.projectId ?? "")}/feedback-sources/${encodeURIComponent(input.sourceId)}`,
							{
								method: "PATCH",
								workspaceSlug: ctx.workspaceSlug,
								json: { isActive: input.active },
							},
						),
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

export const rotateFeedbackSourceToken = EFFRONT.ServerFn.make({
	input: SourceReference,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireProject: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(
							`/api/projects/${encodeURIComponent(ctx.projectId ?? "")}/feedback-sources/${encodeURIComponent(input.sourceId)}/rotate`,
							{ method: "POST", workspaceSlug: ctx.workspaceSlug },
						),
					)
					.pipe(
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(Schema.Struct({ token: Schema.String })),
						),
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

export const revokeFeedbackSource = EFFRONT.ServerFn.make({
	input: SourceReference,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireProject: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(
							`/api/projects/${encodeURIComponent(ctx.projectId ?? "")}/feedback-sources/${encodeURIComponent(input.sourceId)}`,
							{ method: "DELETE", workspaceSlug: ctx.workspaceSlug },
						),
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

export const markFeedbackReviewed = EFFRONT.ServerFn.make({
	input: FeedbackReference,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireProject: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(
							`/api/projects/${encodeURIComponent(ctx.projectId ?? "")}/feedback/${encodeURIComponent(input.feedbackId)}`,
							{ method: "PATCH", workspaceSlug: ctx.workspaceSlug, json: { status: "reviewed" } },
						),
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

export const convertFeedbackToIssue = EFFRONT.ServerFn.make({
	input: FeedbackReference,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireProject: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(
							`/api/projects/${encodeURIComponent(ctx.projectId ?? "")}/feedback/${encodeURIComponent(input.feedbackId)}/convert-to-issue`,
							{ method: "POST", workspaceSlug: ctx.workspaceSlug },
						),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(Converted)),
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

export const markSelectedFeedbackReviewed = EFFRONT.ServerFn.make({
	input: Bulk,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireProject: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(
							`/api/projects/${encodeURIComponent(ctx.projectId ?? "")}/feedback/bulk-mark-reviewed`,
							{
								method: "POST",
								workspaceSlug: ctx.workspaceSlug,
								json: { feedbackIds: input.feedbackIds },
							},
						),
					)
					.pipe(
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(Schema.Struct({ updated: Schema.Number })),
						),
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

export const convertSelectedFeedbackToIssue = EFFRONT.ServerFn.make({
	input: Bulk,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireProject: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(
							`/api/projects/${encodeURIComponent(ctx.projectId ?? "")}/feedback/bulk-convert-to-issue`,
							{
								method: "POST",
								workspaceSlug: ctx.workspaceSlug,
								json: { feedbackIds: input.feedbackIds },
							},
						),
					)
					.pipe(
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(
								Schema.Struct({ ...Converted.fields, convertedCount: Schema.Number }),
							),
						),
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
