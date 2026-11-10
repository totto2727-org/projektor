'use server'

import { Effect, Schema } from 'effect'

import * as projectCommands from '#commands/projects'

import { EFFRONT } from '../../effront'
import type { ActionResult } from '../../function-result'
import { RequestServices } from '../../request'
import { runCommand } from '../../server/command-context'
import { resolveFunctionContext } from '../../server/function-context'
import { checkSameOriginMutation } from '../../server/mutation'
import {
  type ArchiveProjectInput,
  ArchiveProjectInputSchema,
  type CreatedProject,
  type CreateProjectInput,
  CreateProjectInputSchema,
  type UpdateDescriptionInput,
  UpdateDescriptionInputSchema,
} from './schemas'

/** Creates a project for an explicitly selected, server-authorized workspace. */
export const createProject = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(CreateProjectInputSchema)] as const,
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
      )
    }),
})

/** Updates the description for an explicitly selected, server-authorized project. */
export const updateDescription = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(UpdateDescriptionInputSchema)] as const,
  handler: (_previous: unknown, input: UpdateDescriptionInput) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, {
          requireWorkspace: true,
          requireProject: true,
        })
        return yield* runCommand(context, (ctx) =>
          projectCommands.updateProject(ctx, context.projectId ?? input.projectId, {
            description: input.description.trim(),
          }),
        )
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
      )
    }),
})

/** Archives or restores an explicitly selected, server-authorized project. */
export const archiveProject = EFFRONT.ServerFn.make({
  input: ArchiveProjectInputSchema,
  handler: (input: ArchiveProjectInput) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, {
          requireWorkspace: true,
          requireProject: true,
        })
        return yield* runCommand(context, (ctx) =>
          projectCommands.updateProject(ctx, context.projectId ?? input.projectId, { archived: input.archived }),
        )
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
      )
    }),
})

export type { CreatedProject }
