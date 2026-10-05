"use server";
import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import { EFFRONT } from "../../effront";
import { RequestServices } from "../../request";
import { checkSameOriginMutation } from "../../server/api-client";
import { responseError, ScopeError } from "../../server/errors";
import { type FunctionContext, resolveFunctionContext } from "../../server/function-context";
import {
	readDataAttachments,
	readDataComments,
	readDataIssue,
	readDataIssuePage,
	readDataLinks,
	searchDataIssues,
	searchDataWikiAttachments,
} from "./data";
import { requireDataWorkspace } from "../../server/data-context";
import {
	CreatedSchema,
	CreateIssueSchema,
	IssueIdentitySchema,
	IssuePageInputSchema,
	IssuePatchSchema,
	OkSchema,
	SelectorFields,
} from "./action-schemas";
import { AttachmentsSchema, IssueSchema } from "./types";

/** Entity references are resolved under the authorized membership, then checked against the authorized catalog. */
function authorizedIssue(context: FunctionContext, issueId: string) {
	return Effect.gen(function* () {
		const issue = yield* context.api
			.execute(
				context.api.get(`/api/issues/${encodeURIComponent(issueId)}`, {
					workspaceSlug: context.workspaceSlug,
				}),
			)
			.pipe(
				Effect.flatMap(HttpClientResponse.schemaBodyJson(IssueSchema)),
				Effect.mapError(responseError),
				Effect.scoped,
			);
		const project = context.scope.projects.find(
			(entry) => entry.id === issue.project_id && entry.workspace_slug === context.workspaceSlug,
		);
		if (!project || (context.projectId && project.id !== context.projectId))
			return yield* new ScopeError(404, "Issue not found in an accessible project.");
		return issue;
	});
}

function dataWorkspaceId(context: FunctionContext) {
	return Effect.try({
		try: () =>
			requireDataWorkspace(
				context.scope,
				context.scope.workspaces.find((workspace) => workspace.slug === context.workspaceSlug)?.id,
			).id,
		catch: () => new ScopeError(403, "Selected workspace is not accessible."),
	});
}

export const createIssue = EFFRONT.ServerFn.make({
	input: [Schema.Unknown, Schema.fromFormData(CreateIssueSchema)],
	handler: (_previous, input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, {
					requireWorkspace: true,
					requireProject: true,
				});
				const body = {
					projectId: ctx.projectId ?? input.projectId,
					title: input.title.trim(),
					...(input.body ? { body: input.body } : {}),
					...(input.priority ? { priority: input.priority } : {}),
					...(input.statusId ? { statusId: input.statusId } : {}),
					...(input.typeId ? { typeId: input.typeId } : {}),
				};
				const value = yield* ctx.api
					.execute(
						ctx.api.send("/api/issues", {
							workspaceSlug: ctx.workspaceSlug,
							method: "POST",
							json: body,
						}),
					)
					.pipe(
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(
								Schema.Struct({ id: Schema.String, number: Schema.Number }),
							),
						),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
export const updateIssue = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...IssueIdentitySchema.fields, patch: IssuePatchSchema }),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				yield* authorizedIssue(ctx, input.issueId);
				if (input.patch.parentId) yield* authorizedIssue(ctx, input.patch.parentId);
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/issues/${encodeURIComponent(input.issueId)}`, {
							workspaceSlug: ctx.workspaceSlug,
							method: "PATCH",
							json: input.patch,
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
export const readIssue = EFFRONT.ServerFn.make({
	input: IssueIdentitySchema,
	handler: (input) =>
		Effect.gen(function* () {
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			return {
				ok: true as const,
				value: {
					...(yield* readDataIssue(
						ctx.scope,
						yield* dataWorkspaceId(ctx),
						input.issueId,
						ctx.projectId,
					)),
					workspaceSlug: ctx.workspaceSlug,
				},
			};
		}).pipe(
			Effect.catchTags({
				ApiError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				ScopeError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
			}),
		),
});
export const readIssuePage = EFFRONT.ServerFn.make({
	input: IssuePageInputSchema,
	handler: (input) =>
		Effect.gen(function* () {
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const params = new URLSearchParams();
			if (ctx.projectId) params.set("project", ctx.projectId);
			for (const name of [
				"statusIds",
				"priorities",
				"typeId",
				"parentId",
				"noParent",
				"excludeTypeIds",
				"sprintId",
				"completedAfter",
				"completedBefore",
				"updatedAfter",
				"updatedBefore",
				"cursor",
			] as const)
				if (input[name]) params.set(name, input[name]);
			params.set("limit", String(input.limit ?? 30));
			if (input.includeRollups) params.set("includeRollups", "1");
			const value = yield* readDataIssuePage(ctx.scope, yield* dataWorkspaceId(ctx), params);
			return { ok: true as const, value };
		}).pipe(
			Effect.catchTags({
				ApiError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				ScopeError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
			}),
		),
});
export const searchIssues = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...SelectorFields, query: Schema.String }),
	handler: (input) =>
		Effect.gen(function* () {
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const value = yield* searchDataIssues(
				ctx.scope,
				yield* dataWorkspaceId(ctx),
				input.query,
				ctx.projectId ?? undefined,
			);
			return { ok: true as const, value: [...value] };
		}).pipe(
			Effect.catchTags({
				ApiError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				ScopeError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
			}),
		),
});
export const readComments = EFFRONT.ServerFn.make({
	input: IssueIdentitySchema,
	handler: (input) =>
		Effect.gen(function* () {
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const value = yield* readDataComments(
				ctx.scope,
				yield* dataWorkspaceId(ctx),
				input.issueId,
				ctx.projectId,
			);
			return { ok: true as const, value };
		}).pipe(
			Effect.catchTags({
				ApiError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				ScopeError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
			}),
		),
});
export const addComment = EFFRONT.ServerFn.make({
	input: Schema.Struct({
		...IssueIdentitySchema.fields,
		body: Schema.String.check(Schema.isMinLength(1)),
	}),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				yield* authorizedIssue(ctx, input.issueId);
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/issues/${encodeURIComponent(input.issueId)}/comments`, {
							workspaceSlug: ctx.workspaceSlug,
							method: "POST",
							json: { body: input.body },
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(CreatedSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
export const editComment = EFFRONT.ServerFn.make({
	input: Schema.Struct({
		...IssueIdentitySchema.fields,
		commentId: Schema.String,
		body: Schema.String.check(Schema.isMinLength(1)),
	}),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				yield* authorizedIssue(ctx, input.issueId);
				const value = yield* ctx.api
					.execute(
						ctx.api.send(
							`/api/issues/${encodeURIComponent(input.issueId)}/comments/${encodeURIComponent(input.commentId)}`,
							{ workspaceSlug: ctx.workspaceSlug, method: "PATCH", json: { body: input.body } },
						),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
export const deleteComment = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...IssueIdentitySchema.fields, commentId: Schema.String }),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				yield* authorizedIssue(ctx, input.issueId);
				const value = yield* ctx.api
					.execute(
						ctx.api.send(
							`/api/issues/${encodeURIComponent(input.issueId)}/comments/${encodeURIComponent(input.commentId)}`,
							{ workspaceSlug: ctx.workspaceSlug, method: "DELETE" },
						),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
export const readLinks = EFFRONT.ServerFn.make({
	input: IssueIdentitySchema,
	handler: (input) =>
		Effect.gen(function* () {
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const value = yield* readDataLinks(
				ctx.scope,
				yield* dataWorkspaceId(ctx),
				input.issueId,
				ctx.projectId,
			);
			return { ok: true as const, value };
		}).pipe(
			Effect.catchTags({
				ApiError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				ScopeError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
			}),
		),
});
export const addIssueLink = EFFRONT.ServerFn.make({
	input: Schema.Struct({
		...IssueIdentitySchema.fields,
		targetIssueId: Schema.String,
		type: Schema.Literals(["blocks", "blocked_by", "relates_to", "duplicates"]),
	}),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				yield* authorizedIssue(ctx, input.issueId);
				yield* authorizedIssue(ctx, input.targetIssueId);
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/issues/${encodeURIComponent(input.issueId)}/links`, {
							workspaceSlug: ctx.workspaceSlug,
							method: "POST",
							json: { targetIssueId: input.targetIssueId, type: input.type },
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(CreatedSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
export const deleteIssueLink = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...IssueIdentitySchema.fields, linkId: Schema.String }),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				yield* authorizedIssue(ctx, input.issueId);
				const value = yield* ctx.api
					.execute(
						ctx.api.send(
							`/api/issues/${encodeURIComponent(input.issueId)}/links/${encodeURIComponent(input.linkId)}`,
							{ workspaceSlug: ctx.workspaceSlug, method: "DELETE" },
						),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
export const shareIssue = EFFRONT.ServerFn.make({
	input: IssueIdentitySchema,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				yield* authorizedIssue(ctx, input.issueId);
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/issues/${encodeURIComponent(input.issueId)}/share`, {
							workspaceSlug: ctx.workspaceSlug,
							method: "POST",
						}),
					)
					.pipe(
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(
								Schema.Struct({ token: Schema.String, url: Schema.String }),
							),
						),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
export const readAttachments = EFFRONT.ServerFn.make({
	input: IssueIdentitySchema,
	handler: (input) =>
		Effect.gen(function* () {
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const value = yield* readDataAttachments(
				ctx.scope,
				yield* dataWorkspaceId(ctx),
				input.issueId,
				ctx.projectId,
			);
			return { ok: true as const, value };
		}).pipe(
			Effect.catchTags({
				ApiError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				ScopeError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
			}),
		),
});
export const addAttachmentLink = EFFRONT.ServerFn.make({
	input: Schema.Struct({
		...IssueIdentitySchema.fields,
		link: Schema.Union([
			Schema.Struct({ kind: Schema.Literal("wiki_ref"), wikiPageId: Schema.String }),
			Schema.Struct({
				kind: Schema.Literal("url"),
				url: Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/i)),
				label: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
			}),
		]),
	}),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				yield* authorizedIssue(ctx, input.issueId);
				const value = yield* ctx.api
					.execute(
						ctx.api.send("/api/files/links", {
							workspaceSlug: ctx.workspaceSlug,
							method: "POST",
							json: { ...input.link, entityType: "issue", entityId: input.issueId },
						}),
					)
					.pipe(
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(
								Schema.Struct({ id: Schema.String, kind: Schema.Literals(["wiki_ref", "url"]) }),
							),
						),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
export const deleteAttachment = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...IssueIdentitySchema.fields, attachmentId: Schema.String }),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				yield* authorizedIssue(ctx, input.issueId);
				const attachments = yield* ctx.api
					.execute(
						ctx.api.get(
							`/api/files?${new URLSearchParams({ entityType: "issue", entityId: input.issueId })}`,
							{ workspaceSlug: ctx.workspaceSlug },
						),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(AttachmentsSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				if (!attachments.some((entry) => entry.id === input.attachmentId))
					return yield* new ScopeError(404, "Attachment not found on this issue.");
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/files/${encodeURIComponent(input.attachmentId)}`, {
							workspaceSlug: ctx.workspaceSlug,
							method: "DELETE",
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
export const searchWikiAttachments = EFFRONT.ServerFn.make({
	input: Schema.Struct({ ...SelectorFields, query: Schema.String }),
	handler: (input) =>
		Effect.gen(function* () {
			const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
			const value = yield* searchDataWikiAttachments(
				ctx.scope,
				yield* dataWorkspaceId(ctx),
				input.query,
			);
			return { ok: true as const, value: [...value] };
		}).pipe(
			Effect.catchTags({
				ApiError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				ScopeError: (error) =>
					Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
			}),
		),
});
export const updateSprint = EFFRONT.ServerFn.make({
	input: Schema.Struct({
		...SelectorFields,
		sprintId: Schema.String,
		patch: Schema.Struct({
			name: Schema.String.check(Schema.isMinLength(1)),
			goal: Schema.NullOr(Schema.String),
			status: Schema.Literals(["planned", "active", "completed"]),
			startDate: Schema.NullOr(Schema.Number),
			endDate: Schema.NullOr(Schema.Number),
		}),
	}),
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true });
				const value = yield* ctx.api
					.execute(
						ctx.api.send(`/api/sprints/${encodeURIComponent(input.sprintId)}`, {
							workspaceSlug: ctx.workspaceSlug,
							method: "PATCH",
							json: input.patch,
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(OkSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					);
				return { ok: true as const, value };
			}).pipe(
				Effect.catchTags({
					ApiError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
					ScopeError: (error) =>
						Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
				}),
				Effect.ensuring(services.invalidate),
			);
		}),
});
