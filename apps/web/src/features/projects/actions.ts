"use server";

import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import { EFFRONT } from "../../effront";
import type { ActionResult } from "../../function-result";
import { RequestServices } from "../../request";
import { checkSameOriginMutation, responseError } from "../../server";
import { resolveFunctionContext } from "../../server/function-context";
import {
	type ArchiveProjectInput,
	ArchiveProjectInputSchema,
	type CreatedProject,
	CreatedProjectSchema,
	type CreateProjectInput,
	CreateProjectInputSchema,
	ProjectMutationResultSchema,
	type UpdateDescriptionInput,
	UpdateDescriptionInputSchema,
} from "./schemas";

/** Creates a project for an explicitly selected, server-authorized workspace. */
export const createProject = EFFRONT.ServerFn.make({
	input: [Schema.Unknown, Schema.fromFormData(CreateProjectInputSchema)] as const,
	handler: (_previous: unknown, input: CreateProjectInput) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireWorkspace: true });
				return yield* context.api
					.execute(
						context.api.send("/api/projects", {
							method: "POST",
							workspaceSlug: context.workspaceSlug,
							json: {
								name: input.name.trim(),
								key: input.key.trim().toUpperCase(),
								description: input.description.trim(),
							},
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(CreatedProjectSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
			}).pipe(
				Effect.map((value): ActionResult<CreatedProject> => ({ ok: true, value })),
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed<ActionResult<CreatedProject>>({
							ok: false,
							status: error.status,
							message: error.message,
						}),
					ScopeError: (error) =>
						Effect.succeed<ActionResult<CreatedProject>>({
							ok: false,
							status: error.status,
							message: error.message,
						}),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

/** Updates the description for an explicitly selected, server-authorized project. */
export const updateDescription = EFFRONT.ServerFn.make({
	input: [Schema.Unknown, Schema.fromFormData(UpdateDescriptionInputSchema)] as const,
	handler: (_previous: unknown, input: UpdateDescriptionInput) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, {
					requireWorkspace: true,
					requireProject: true,
				});
				return yield* context.api
					.execute(
						context.api.send(
							`/api/projects/${encodeURIComponent(context.projectId ?? input.projectId)}`,
							{
								method: "PATCH",
								workspaceSlug: context.workspaceSlug,
								json: { description: input.description.trim() },
							},
						),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(ProjectMutationResultSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
			}).pipe(
				Effect.map((value): ActionResult<{ readonly ok: boolean }> => ({ ok: true, value })),
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed<ActionResult<{ readonly ok: boolean }>>({
							ok: false,
							status: error.status,
							message: error.message,
						}),
					ScopeError: (error) =>
						Effect.succeed<ActionResult<{ readonly ok: boolean }>>({
							ok: false,
							status: error.status,
							message: error.message,
						}),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

/** Archives or restores an explicitly selected, server-authorized project. */
export const archiveProject = EFFRONT.ServerFn.make({
	input: ArchiveProjectInputSchema,
	handler: (input: ArchiveProjectInput) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, {
					requireWorkspace: true,
					requireProject: true,
				});
				return yield* context.api
					.execute(
						context.api.send(
							`/api/projects/${encodeURIComponent(context.projectId ?? input.projectId)}`,
							{
								method: "PATCH",
								workspaceSlug: context.workspaceSlug,
								json: { archived: input.archived },
							},
						),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(ProjectMutationResultSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
			}).pipe(
				Effect.map((value): ActionResult<{ readonly ok: boolean }> => ({ ok: true, value })),
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed<ActionResult<{ readonly ok: boolean }>>({
							ok: false,
							status: error.status,
							message: error.message,
						}),
					ScopeError: (error) =>
						Effect.succeed<ActionResult<{ readonly ok: boolean }>>({
							ok: false,
							status: error.status,
							message: error.message,
						}),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});

export type { CreatedProject };
