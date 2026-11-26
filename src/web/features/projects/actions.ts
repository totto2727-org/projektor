'use server'

import { Effect, Schema } from 'effect'

import { EFFRONT } from '@/effront.ts'
import type { ActionResult } from '@/function-result.ts'
import { actionFailure } from '@/function-result.ts'
import { RequestServices } from '@/request.ts'
import { runBrowserCommand as runCommand } from '@/server/browser-command.ts'
import { resolveFunctionContext } from '@/server/function-context.ts'
import { checkSameOriginMutation } from '@/server/mutation.ts'

import * as projectCommands from './commands.ts'
import { ArchiveProjectInputSchema, CreateProjectInputSchema, UpdateDescriptionInputSchema } from './schemas.ts'
import type { ArchiveProjectInput, CreatedProject, CreateProjectInput, UpdateDescriptionInput } from './schemas.ts'

type ProjectUpdateResult = ActionResult<Readonly<{ ok: boolean }>>

/** Creates a project for an explicitly selected, server-authorized workspace. */
export const createProject = EFFRONT.ServerFn.make({
  handler: (_previous: unknown, input: CreateProjectInput) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        return yield* runCommand(context, (ctx) =>
          projectCommands.createProject(ctx, {
            name: input.name.trim(),
            key: input.key.trim().toUpperCase(),
            description: input.description.trim(),
          }),
        )
      }).pipe(
        Effect.map((value): ActionResult<CreatedProject> => ({ ok: true, value })),
        Effect.catchTags({
          ApiError: (error) => Effect.succeed<ActionResult<CreatedProject>>(actionFailure(error.status, error.message)),
          ScopeError: (error) =>
            Effect.succeed<ActionResult<CreatedProject>>(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: [Schema.Unknown, Schema.fromFormData(CreateProjectInputSchema)] as const,
})

/** Updates the description for an explicitly selected, server-authorized project. */
export const updateDescription = EFFRONT.ServerFn.make({
  handler: (_previous: unknown, input: UpdateDescriptionInput) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, {
          requireProject: true,
          requireWorkspace: true,
        })
        return yield* runCommand(context, (ctx) =>
          projectCommands.updateProject(ctx, context.projectId ?? input.projectId, {
            description: input.description.trim(),
          }),
        )
      }).pipe(
        Effect.map((value): ProjectUpdateResult => ({ ok: true, value })),
        Effect.catchTags({
          ApiError: (error) => Effect.succeed<ProjectUpdateResult>(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed<ProjectUpdateResult>(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: [Schema.Unknown, Schema.fromFormData(UpdateDescriptionInputSchema)] as const,
})

/** Archives or restores an explicitly selected, server-authorized project. */
export const archiveProject = EFFRONT.ServerFn.make({
  handler: (input: ArchiveProjectInput) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, {
          requireProject: true,
          requireWorkspace: true,
        })
        return yield* runCommand(context, (ctx) =>
          projectCommands.updateProject(ctx, context.projectId ?? input.projectId, { archived: input.archived }),
        )
      }).pipe(
        Effect.map((value): ProjectUpdateResult => ({ ok: true, value })),
        Effect.catchTags({
          ApiError: (error) => Effect.succeed<ProjectUpdateResult>(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed<ProjectUpdateResult>(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: ArchiveProjectInputSchema,
})

export type { CreatedProject } from './schemas.ts'
