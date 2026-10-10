'use server'

import { Effect, Schema } from 'effect'

import * as sprintCommands from '#commands/sprints'
import { getIssue } from '#services/issues'
import { findSprintById } from '#services/sprints'

import { EFFRONT } from '../../effront'
import { RequestServices } from '../../request'
import { runCommand } from '../../server/command-context'
import { dataError, requireDataProject, requireDataWorkspace } from '../../server/data-context'
import { ScopeError } from '../../server/errors'
import { resolveFunctionContext } from '../../server/function-context'
import { checkSameOriginMutation } from '../../server/mutation'
import type { RequestScope } from '../../server/request-context'
import {
  CreateSprintInputSchema,
  calendarTimestamp,
  EditSprintInputSchema,
  MoveSprintIssuesSchema,
  SprintIdentitySchema,
  SprintStatusInputSchema,
} from './input-schemas'
function sprintInProject(
  db: Parameters<typeof findSprintById>[0],
  scope: RequestScope,
  workspaceId: string,
  projectId: string,
  sprintId: string,
) {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => {
        requireDataWorkspace(scope, workspaceId)
        requireDataProject(scope, projectId, workspaceId)
      },
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
    })
    const sprint = yield* findSprintById(db, workspaceId, sprintId).pipe(Effect.mapError(dataError))
    if (!sprint || sprint.projectId !== projectId)
      return yield* new ScopeError(404, 'Sprint not found in the selected project.')
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
        if (context.scope.selection.kind !== 'project')
          return yield* new ScopeError(404, 'Select an accessible project.')
        const { project } = context.scope.selection
        const startDate = calendarTimestamp(input.start, input.startOffset)
        const endDate = calendarTimestamp(input.end, input.endOffset)
        const value = yield* runCommand(context, (ctx) =>
          sprintCommands.createSprint(ctx, {
            projectId: project.id,
            name: input.name.trim(),
            ...(input.goal.trim() ? { goal: input.goal.trim() } : {}),
            ...(startDate === null ? {} : { startDate }),
            ...(endDate === null ? {} : { endDate }),
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
        if (context.scope.selection.kind !== 'project')
          return yield* new ScopeError(404, 'Select an accessible project.')
        const { project, workspace } = context.scope.selection
        yield* sprintInProject(services.db, context.scope, workspace.id, project.id, input.sprintId)
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
        if (context.scope.selection.kind !== 'project')
          return yield* new ScopeError(404, 'Select an accessible project.')
        const { project, workspace } = context.scope.selection
        yield* sprintInProject(services.db, context.scope, workspace.id, project.id, input.sprintId)
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
        if (context.scope.selection.kind !== 'project')
          return yield* new ScopeError(404, 'Select an accessible project.')
        const { project, workspace } = context.scope.selection
        yield* sprintInProject(services.db, context.scope, workspace.id, project.id, input.sprintId)
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
        if (context.scope.selection.kind !== 'project')
          return yield* new ScopeError(404, 'Select an accessible project.')
        const { project, workspace } = context.scope.selection
        const [source, target] = yield* Effect.all(
          [
            sprintInProject(services.db, context.scope, workspace.id, project.id, input.sprintId),
            sprintInProject(services.db, context.scope, workspace.id, project.id, input.targetId),
          ],
          { concurrency: 2 },
        )
        if (source.projectId !== project.id || target.projectId !== project.id || target.status === 'completed')
          return yield* new ScopeError(404, 'Choose an available sprint in the selected project.')
        const issues = yield* Effect.all(
          input.issueIds.map((id) => getIssue(services.db, workspace.id, { id }).pipe(Effect.mapError(dataError))),
          { concurrency: 4 },
        )
        if (issues.some((issue) => !issue || issue.project_id !== project.id || issue.sprint_id !== source.id))
          return yield* new ScopeError(404, 'An issue is no longer in the selected sprint.')
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
