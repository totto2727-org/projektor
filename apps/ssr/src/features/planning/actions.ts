"use server";

import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import { EFFRONT } from "../../effront";
import { RequestServices } from "../../request";
import { checkSameOriginMutation } from "../../server/api-client";
import { responseError, ScopeError } from "../../server/errors";
import { resolveFunctionContext } from "../../server/function-context";
import {
	CreateSprintInputSchema,
	calendarTimestamp,
	EditSprintInputSchema,
	MoveSprintIssuesSchema,
	SprintIdentitySchema,
	SprintStatusInputSchema,
} from "./input-schemas";
import { SprintSchema } from "./schemas";

const CreatedSchema = Schema.Struct({ id: Schema.String });
const OkSchema = Schema.Struct({ ok: Schema.Literal(true) });
const MovedSchema = Schema.Struct({ ok: Schema.Literal(true), count: Schema.Finite });
const IssueIdentitySchema = Schema.Struct({
	id: Schema.String,
	project_id: Schema.String,
	sprint_id: Schema.NullOr(Schema.String),
});

export const createSprint = EFFRONT.ServerFn.make({
	input: [
		Schema.Unknown,
		Schema.fromFormData(Schema.toCodecStringTree(CreateSprintInputSchema)),
	] as const,
	handler: (_previous, input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireProject: true });
				if (context.scope.selection.kind !== "project")
					return yield* new ScopeError(404, "Select an accessible project.");
				const { project, workspace } = context.scope.selection;
				const startDate = calendarTimestamp(input.start, input.startOffset);
				const endDate = calendarTimestamp(input.end, input.endOffset);
				const value = yield* context.api
					.execute(
						context.api.send("/api/sprints", {
							method: "POST",
							workspaceSlug: workspace.slug,
							json: {
								projectId: project.id,
								name: input.name.trim(),
								...(input.goal.trim() ? { goal: input.goal.trim() } : {}),
								...(startDate === null ? {} : { startDate }),
								...(endDate === null ? {} : { endDate }),
							},
						})
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
export const editSprint = EFFRONT.ServerFn.make({
	input: [
		Schema.Unknown,
		Schema.fromFormData(Schema.toCodecStringTree(EditSprintInputSchema)),
	] as const,
	handler: (_previous, input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireProject: true });
				if (context.scope.selection.kind !== "project")
					return yield* new ScopeError(404, "Select an accessible project.");
				const { project, workspace } = context.scope.selection;
				const path = `/api/sprints/${encodeURIComponent(input.sprintId)}`;
				const sprint = yield* context.api
					.execute(
						context.api.get(path, {
							workspaceSlug: workspace.slug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(SprintSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				if (sprint.projectId !== project.id)
					return yield* new ScopeError(404, "Sprint not found in the selected project.");
				const value = yield* context.api
					.execute(
						context.api.send(path, {
							method: "PATCH",
							workspaceSlug: workspace.slug,
							json: {
								name: input.name.trim(),
								goal: input.goal.trim() || null,
								startDate: calendarTimestamp(input.start, input.startOffset),
								endDate: calendarTimestamp(input.end, input.endOffset),
							},
						})
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
export const setSprintStatus = EFFRONT.ServerFn.make({
	input: SprintStatusInputSchema,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireProject: true });
				if (context.scope.selection.kind !== "project")
					return yield* new ScopeError(404, "Select an accessible project.");
				const { project, workspace } = context.scope.selection;
				const path = `/api/sprints/${encodeURIComponent(input.sprintId)}`;
				const sprint = yield* context.api
					.execute(
						context.api.get(path, {
							workspaceSlug: workspace.slug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(SprintSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				if (sprint.projectId !== project.id)
					return yield* new ScopeError(404, "Sprint not found in the selected project.");
				const value = yield* context.api
					.execute(
						context.api.send(path, {
							method: "PATCH",
							workspaceSlug: workspace.slug,
							json: { status: input.status },
						})
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
export const archiveSprint = EFFRONT.ServerFn.make({
	input: SprintIdentitySchema,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireProject: true });
				if (context.scope.selection.kind !== "project")
					return yield* new ScopeError(404, "Select an accessible project.");
				const { project, workspace } = context.scope.selection;
				const path = `/api/sprints/${encodeURIComponent(input.sprintId)}`;
				const sprint = yield* context.api
					.execute(
						context.api.get(path, {
							workspaceSlug: workspace.slug,
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(SprintSchema)),
						Effect.mapError(responseError),
						Effect.scoped
					);
				if (sprint.projectId !== project.id)
					return yield* new ScopeError(404, "Sprint not found in the selected project.");
				const value = yield* context.api
					.execute(
						context.api.send(path, {
							method: "DELETE",
							workspaceSlug: workspace.slug,
						})
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
export const moveSprintIssues = EFFRONT.ServerFn.make({
	input: MoveSprintIssuesSchema,
	handler: (input) =>
		Effect.gen(function* () {
			const services = yield* RequestServices;
			return yield* Effect.gen(function* () {
				yield* checkSameOriginMutation(services.request);
				const context = yield* resolveFunctionContext(input, { requireProject: true });
				if (context.scope.selection.kind !== "project")
					return yield* new ScopeError(404, "Select an accessible project.");
				const { project, workspace } = context.scope.selection;
				const [source, target] = yield* Effect.all(
					[
						context.api
							.execute(
								context.api.get(`/api/sprints/${encodeURIComponent(input.sprintId)}`, {
									workspaceSlug: workspace.slug,
								})
							)
							.pipe(
								Effect.flatMap(HttpClientResponse.schemaBodyJson(SprintSchema)),
								Effect.mapError(responseError),
								Effect.scoped
							),
						context.api
							.execute(
								context.api.get(`/api/sprints/${encodeURIComponent(input.targetId)}`, {
									workspaceSlug: workspace.slug,
								})
							)
							.pipe(
								Effect.flatMap(HttpClientResponse.schemaBodyJson(SprintSchema)),
								Effect.mapError(responseError),
								Effect.scoped
							),
					],
					{ concurrency: 2 }
				);
				if (
					source.projectId !== project.id ||
					target.projectId !== project.id ||
					target.status === "completed"
				)
					return yield* new ScopeError(404, "Choose an available sprint in the selected project.");
				const issues = yield* Effect.all(
					input.issueIds.map((id) =>
						context.api
							.execute(
								context.api.get(`/api/issues/${encodeURIComponent(id)}`, {
									workspaceSlug: workspace.slug,
								})
							)
							.pipe(
								Effect.flatMap(HttpClientResponse.schemaBodyJson(IssueIdentitySchema)),
								Effect.mapError(responseError),
								Effect.scoped
							)
					),
					{ concurrency: 4 }
				);
				if (
					issues.some((issue) => issue.project_id !== project.id || issue.sprint_id !== source.id)
				)
					return yield* new ScopeError(404, "An issue is no longer in the selected sprint.");
				const value = yield* context.api
					.execute(
						context.api.send(`/api/sprints/${encodeURIComponent(target.id)}/move-issues`, {
							method: "POST",
							workspaceSlug: workspace.slug,
							json: { issueIds: [...new Set(input.issueIds)] },
						})
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(MovedSchema)),
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
