'use server'

import { Predicate, Effect, Schema } from 'effect'

import { HTTP_NOT_FOUND } from '#contracts/http-status.ts'
import { EFFRONT } from '@/effront.ts'
import { readDataIssue, readSprint } from '@/features/issues/data.ts'
import { RequestServices } from '@/request.ts'
import { runBrowserCommand as runCommand } from '@/server/browser-command.ts'
import { dataError, requireDataProject, requireDataWorkspace } from '@/server/data-context.ts'
import { ScopeError } from '@/server/errors.ts'
import { resolveFunctionContext } from '@/server/function-context.ts'
import { checkSameOriginMutation } from '@/server/mutation.ts'
import type { RequestScope } from '@/server/request-context.ts'

import { sprintCommands } from './data.ts'
import {
  CreateSprintInputSchema,
  calendarTimestamp,
  EditSprintInputSchema,
  MoveSprintIssuesSchema,
  SprintIdentitySchema,
  SprintStatusInputSchema,
} from './input-schemas.ts'
const sprintInProject = function sprintInProject(
  scope: RequestScope,
  workspaceId: string,
  projectId: string,
  sprintId: string,
) {
  return Effect.gen(function* () {
    yield* Effect.try({
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
      try: () => {
        requireDataWorkspace(scope, workspaceId)
        requireDataProject(scope, projectId, workspaceId)
      },
    })
    const sprint = yield* readSprint(workspaceId, sprintId)
    if (!sprint || sprint.projectId !== projectId) {
      return yield* new ScopeError(HTTP_NOT_FOUND, 'Sprint not found in the selected project.')
    }
    return sprint
  })
}

export const createSprint = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(Schema.toCodecStringTree(CreateSprintInputSchema))] as const,
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireProject: true })
        if (context.scope.selection.kind !== 'project') {
          return yield* new ScopeError(HTTP_NOT_FOUND, 'Select an accessible project.')
        }
        const { project } = context.scope.selection
        const startDate = calendarTimestamp(input.start, input.startOffset)
        const endDate = calendarTimestamp(input.end, input.endOffset)
        const value = yield* runCommand(context, (ctx) =>
          sprintCommands.createSprint(ctx, {
            projectId: project.id,
            name: input.name.trim(),
            ...(input.goal.trim() ? { goal: input.goal.trim() } : {}),
            ...(Predicate.isNullish(startDate) ? {} : { startDate }),
            ...(Predicate.isNullish(endDate) ? {} : { endDate }),
          }),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const editSprint = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(Schema.toCodecStringTree(EditSprintInputSchema))] as const,
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireProject: true })
        if (context.scope.selection.kind !== 'project') {
          return yield* new ScopeError(HTTP_NOT_FOUND, 'Select an accessible project.')
        }
        const { project, workspace } = context.scope.selection
        yield* sprintInProject(context.scope, workspace.id, project.id, input.sprintId)
        const value = yield* runCommand(context, (ctx) =>
          sprintCommands.updateSprint(ctx, input.sprintId, {
            name: input.name.trim(),
            goal: input.goal.trim() || null,
            startDate: calendarTimestamp(input.start, input.startOffset),
            endDate: calendarTimestamp(input.end, input.endOffset),
          }),
        ).pipe(Effect.map(() => ({ ok: true as const })))
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const setSprintStatus = EFFRONT.ServerFn.make({
  input: SprintStatusInputSchema,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireProject: true })
        if (context.scope.selection.kind !== 'project') {
          return yield* new ScopeError(HTTP_NOT_FOUND, 'Select an accessible project.')
        }
        const { project, workspace } = context.scope.selection
        yield* sprintInProject(context.scope, workspace.id, project.id, input.sprintId)
        const value = yield* runCommand(context, (ctx) =>
          sprintCommands.updateSprint(ctx, input.sprintId, { status: input.status }),
        ).pipe(Effect.map(() => ({ ok: true as const })))
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const archiveSprint = EFFRONT.ServerFn.make({
  input: SprintIdentitySchema,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireProject: true })
        if (context.scope.selection.kind !== 'project') {
          return yield* new ScopeError(HTTP_NOT_FOUND, 'Select an accessible project.')
        }
        const { project, workspace } = context.scope.selection
        yield* sprintInProject(context.scope, workspace.id, project.id, input.sprintId)
        const value = yield* runCommand(context, (ctx) => sprintCommands.deleteSprint(ctx, input.sprintId)).pipe(
          Effect.map(() => ({ ok: true as const })),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const moveSprintIssues = EFFRONT.ServerFn.make({
  input: MoveSprintIssuesSchema,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireProject: true })
        if (context.scope.selection.kind !== 'project') {
          return yield* new ScopeError(HTTP_NOT_FOUND, 'Select an accessible project.')
        }
        const { project, workspace } = context.scope.selection
        const [source, target] = yield* Effect.all(
          [
            sprintInProject(context.scope, workspace.id, project.id, input.sprintId),
            sprintInProject(context.scope, workspace.id, project.id, input.targetId),
          ],
          { concurrency: 2 },
        )
        if (source.projectId !== project.id || target.projectId !== project.id || target.status === 'completed') {
          return yield* new ScopeError(HTTP_NOT_FOUND, 'Choose an available sprint in the selected project.')
        }
        const issues = yield* Effect.all(
          input.issueIds.map((id) => readDataIssue(context.scope, workspace.id, id, project.id)),
          { concurrency: 4 },
        )
        if (issues.some((issue) => !issue || issue.project_id !== project.id || issue.sprint_id !== source.id)) {
          return yield* new ScopeError(HTTP_NOT_FOUND, 'An issue is no longer in the selected sprint.')
        }
        const value = yield* runCommand(context, (ctx) =>
          sprintCommands.moveIssuesToSprint(ctx, { sprintId: target.id, issueIds: [...new Set(input.issueIds)] }),
        ).pipe(Effect.map(({ count }) => ({ ok: true as const, count })))
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
