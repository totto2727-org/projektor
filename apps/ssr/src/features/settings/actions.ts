"use server";

import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import { EFFRONT } from "../../effront";
import { RequestServices } from "../../request";
import { checkSameOriginMutation } from "../../server/api-client";
import { responseError, ScopeError } from "../../server/errors";
import { resolveFunctionContext } from "../../server/function-context";
import {
	ConnectorIdentitySchema,
	CreateGroupInputSchema,
	CreateTokenInputSchema,
	GroupDescriptionInputSchema,
	GroupGrantInputSchema,
	GroupIdentitySchema,
	GroupMemberInputSchema,
	GroupProjectIdentitySchema,
	NewTokenSchema,
	RenameGroupInputSchema,
	TokenIdentitySchema,
} from "./input-schemas";

const CreatedSchema = Schema.Struct({ id: Schema.String });
const OkSchema = Schema.Struct({ ok: Schema.Literal(true) });
const GrantProjectSchema = Schema.Struct({ id: Schema.String, workspaceId: Schema.String });

export const createGroup = EFFRONT.ServerFn.make({
	input: [Schema.Unknown, Schema.fromFormData(CreateGroupInputSchema)] as const,
	handler: (_previous, input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireWorkspace: true });
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/groups`,
							{
								method: "POST",
								workspaceSlug: context.workspaceSlug,
								json: { name: input.name.trim() },
							}
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(CreatedSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
export const renameGroup = EFFRONT.ServerFn.make({
	input: [Schema.Unknown, Schema.fromFormData(RenameGroupInputSchema)] as const,
	handler: (_previous, input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireWorkspace: true });
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/groups/${encodeURIComponent(input.groupId)}`,
							{
								method: "PATCH",
								workspaceSlug: context.workspaceSlug,
								json: { name: input.name.trim() },
							}
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
export const describeGroup = EFFRONT.ServerFn.make({
	input: [Schema.Unknown, Schema.fromFormData(GroupDescriptionInputSchema)] as const,
	handler: (_previous, input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireWorkspace: true });
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/groups/${encodeURIComponent(input.groupId)}`,
							{
								method: "PATCH",
								workspaceSlug: context.workspaceSlug,
								json: { description: input.description.trim() || null },
							}
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
export const deleteGroup = EFFRONT.ServerFn.make({
	input: GroupIdentitySchema,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireWorkspace: true });
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/groups/${encodeURIComponent(input.groupId)}`,
							{ method: "DELETE", workspaceSlug: context.workspaceSlug }
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
export const addGroupMember = EFFRONT.ServerFn.make({
	input: [Schema.Unknown, Schema.fromFormData(GroupMemberInputSchema)] as const,
	handler: (_previous, input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireWorkspace: true });
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/groups/${encodeURIComponent(input.groupId)}/members`,
							{
								method: "POST",
								workspaceSlug: context.workspaceSlug,
								json: { userId: input.userId },
							}
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
export const removeGroupMember = EFFRONT.ServerFn.make({
	input: GroupMemberInputSchema,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireWorkspace: true });
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/groups/${encodeURIComponent(input.groupId)}/members/${encodeURIComponent(input.userId)}`,
							{ method: "DELETE", workspaceSlug: context.workspaceSlug }
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
export const setGroupGrant = EFFRONT.ServerFn.make({
	input: GroupGrantInputSchema,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(
					{ workspaceSlug: input.workspaceSlug },
					{ requireWorkspace: true }
				);
				// The grant's target is not a page selector. Direct GET also includes archived projects.
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const project = yield* context.api
					.execute(
						context.api.get(`/api/projects/${encodeURIComponent(input.projectId)}`, {
							workspaceSlug: context.workspaceSlug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(GrantProjectSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				if (
					context.scope.selection.kind !== "workspace" ||
					project.workspaceId !== context.scope.selection.workspace.id
				)
					return yield* new ScopeError(404, "Project not found in the selected workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/groups/${encodeURIComponent(input.groupId)}/grants`,
							{
								method: "PUT",
								workspaceSlug: context.workspaceSlug,
								json: { projectId: input.projectId, role: input.role },
							}
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
/** Native add-grant form. Inline role changes still use the rich setGroupGrant control. */
export const createGroupGrant = EFFRONT.ServerFn.make({
	input: [Schema.Unknown, Schema.fromFormData(GroupGrantInputSchema)] as const,
	handler: (_previous, input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(
					{ workspaceSlug: input.workspaceSlug },
					{ requireWorkspace: true }
				);
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const project = yield* context.api
					.execute(
						context.api.get(`/api/projects/${encodeURIComponent(input.projectId)}`, {
							workspaceSlug: context.workspaceSlug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(GrantProjectSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				if (
					context.scope.selection.kind !== "workspace" ||
					project.workspaceId !== context.scope.selection.workspace.id
				)
					return yield* new ScopeError(404, "Project not found in the selected workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/groups/${encodeURIComponent(input.groupId)}/grants`,
							{
								method: "PUT",
								workspaceSlug: context.workspaceSlug,
								json: { projectId: input.projectId, role: input.role },
							}
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
export const removeGroupGrant = EFFRONT.ServerFn.make({
	input: GroupProjectIdentitySchema,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(
					{ workspaceSlug: input.workspaceSlug },
					{ requireWorkspace: true }
				);
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const project = yield* context.api
					.execute(
						context.api.get(`/api/projects/${encodeURIComponent(input.projectId)}`, {
							workspaceSlug: context.workspaceSlug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(GrantProjectSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				if (
					context.scope.selection.kind !== "workspace" ||
					project.workspaceId !== context.scope.selection.workspace.id
				)
					return yield* new ScopeError(404, "Project not found in the selected workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/groups/${encodeURIComponent(input.groupId)}/grants/${encodeURIComponent(input.projectId)}`,
							{ method: "DELETE", workspaceSlug: context.workspaceSlug }
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
export const createToken = EFFRONT.ServerFn.make({
	input: [Schema.Unknown, Schema.fromFormData(CreateTokenInputSchema)] as const,
	handler: (_previous, input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireWorkspace: true });
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/tokens`,
							{
								method: "POST",
								workspaceSlug: context.workspaceSlug,
								json: {
									name: input.name.trim(),
									scopes: input.scope === "read" ? ["read"] : ["read", "write"],
									...(input.expiry ? { expiresInDays: Number(input.expiry) } : {}),
								},
							}
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(NewTokenSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
export const revokeToken = EFFRONT.ServerFn.make({
	input: TokenIdentitySchema,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireWorkspace: true });
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/tokens/${encodeURIComponent(input.tokenId)}`,
							{ method: "DELETE", workspaceSlug: context.workspaceSlug }
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
export const disconnectConnector = EFFRONT.ServerFn.make({
	input: ConnectorIdentitySchema,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireWorkspace: true });
				if (!context.workspaceSlug)
					return yield* new ScopeError(403, "Select an accessible workspace.");
				const value = yield* context.api
					.execute(
						context.api.send(
							`/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/connectors/${encodeURIComponent(input.connectorId)}`,
							{ method: "DELETE", workspaceSlug: context.workspaceSlug }
						)
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate)
			);
		}),
});
