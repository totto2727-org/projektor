'use server'

import { Effect, Schema } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { EFFRONT } from '@/effront.ts'
import { actionFailure } from '@/function-result.ts'
import { RequestServices } from '@/request.ts'
import { runBrowserCommand as runCommand } from '@/server/browser-command.ts'
import { FunctionSelectorSchema, resolveFunctionContext } from '@/server/function-context.ts'
import { checkSameOriginMutation } from '@/server/mutation.ts'

import { feedbackCommands, sourceCommands } from './data.ts'
import { BulkFeedbackIds, FeedbackIdentifier, SourceFields } from './schemas.ts'

const SourceReference = Schema.Struct({
  ...FunctionSelectorSchema.fields,
  projectId: FeedbackIdentifier,
  sourceId: FeedbackIdentifier,
})
const FeedbackReference = Schema.Struct({
  ...FunctionSelectorSchema.fields,
  ...fieldsInOrder([
    ['projectId', FeedbackIdentifier],
    ['feedbackId', FeedbackIdentifier],
  ]),
})
const Bulk = Schema.Struct({
  ...FunctionSelectorSchema.fields,
  ...fieldsInOrder([
    ['projectId', FeedbackIdentifier],
    ['feedbackIds', BulkFeedbackIds],
  ]),
})

export const createFeedbackSource = EFFRONT.ServerFn.make({
  handler: (_previousState, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const origins = input.origins
          .split(/[\n,]/u)
          .map((value) => value.trim())
          .filter(Boolean)
        const value = yield* runCommand(ctx, (command) =>
          sourceCommands.createFeedbackSource(command, {
            ...fieldsInOrder([
              ['projectId', ctx.projectId],
              ['name', input.name.trim()],
            ]),
            ...(input.description.trim() ? { description: input.description.trim() } : {}),
            ...(origins.length ? { allowedOrigins: origins } : {}),
          }),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  // Previous React action state is transport protocol, not domain data.
  input: [
    Schema.Unknown,
    Schema.fromFormData(
      Schema.Struct({
        ...FunctionSelectorSchema.fields,
        projectId: FeedbackIdentifier,
        ...SourceFields.fields,
      }),
    ),
  ] as const,
})

export const setFeedbackSourceActive = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          sourceCommands.updateFeedbackSource(
            command,
            fieldsInOrder([
              ['projectId', ctx.projectId],
              ['sourceId', input.sourceId],
              ['isActive', input.active],
            ]),
          ),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({ ...SourceReference.fields, active: Schema.Boolean }),
})

export const rotateFeedbackSourceToken = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          sourceCommands.rotateFeedbackSourceToken(command, { projectId: ctx.projectId, sourceId: input.sourceId }),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: SourceReference,
})

export const revokeFeedbackSource = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          sourceCommands.revokeFeedbackSource(command, { projectId: ctx.projectId, sourceId: input.sourceId }),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: SourceReference,
})

export const markFeedbackReviewed = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          feedbackCommands.updateFeedbackStatus(
            command,
            fieldsInOrder([
              ['projectId', ctx.projectId],
              ['feedbackId', input.feedbackId],
              ['status', 'reviewed'],
            ]),
          ),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: FeedbackReference,
})

export const convertFeedbackToIssue = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          feedbackCommands.convertFeedbackToIssue(
            command,
            fieldsInOrder([
              ['projectId', ctx.projectId],
              ['feedbackId', input.feedbackId],
            ]),
          ),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: FeedbackReference,
})

export const markSelectedFeedbackReviewed = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          feedbackCommands.bulkMarkReviewed(
            command,
            fieldsInOrder([
              ['projectId', ctx.projectId],
              ['feedbackIds', input.feedbackIds],
            ]),
          ),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Bulk,
})

export const convertSelectedFeedbackToIssue = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          feedbackCommands.bulkConvertToIssue(
            command,
            fieldsInOrder([
              ['projectId', ctx.projectId],
              ['feedbackIds', input.feedbackIds],
            ]),
          ),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Bulk,
})
