'use server'

import { Effect, Schema } from 'effect'

import * as feedbackCommands from '#commands/feedback'
import * as sourceCommands from '#commands/feedback-sources'

import { EFFRONT } from '../../effront'
import { RequestServices } from '../../request'
import { runCommand } from '../../server/command-context'
import { FunctionSelectorSchema, resolveFunctionContext } from '../../server/function-context'
import { checkSameOriginMutation } from '../../server/mutation'
import { SourceFields } from './schemas'

const identifier = Schema.String.check(Schema.isMinLength(1))
const SourceReference = Schema.Struct({
  ...FunctionSelectorSchema.fields,
  projectId: identifier,
  sourceId: identifier,
})
const FeedbackReference = Schema.Struct({
  ...FunctionSelectorSchema.fields,
  projectId: identifier,
  feedbackId: identifier,
})
const Bulk = Schema.Struct({
  ...FunctionSelectorSchema.fields,
  projectId: identifier,
  feedbackIds: Schema.mutable(Schema.Array(identifier)).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
})

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
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const origins = input.origins
          .split(/[\n,]/)
          .map((value) => value.trim())
          .filter(Boolean)
        const value = yield* runCommand(ctx, (command) =>
          sourceCommands.createFeedbackSource(command, {
            projectId: ctx.projectId,
            name: input.name.trim(),
            ...(input.description.trim() ? { description: input.description.trim() } : {}),
            ...(origins.length ? { allowedOrigins: origins } : {}),
          }),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const setFeedbackSourceActive = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...SourceReference.fields, active: Schema.Boolean }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          sourceCommands.updateFeedbackSource(command, {
            projectId: ctx.projectId,
            sourceId: input.sourceId,
            isActive: input.active,
          }),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const rotateFeedbackSourceToken = EFFRONT.ServerFn.make({
  input: SourceReference,
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
          ApiError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const revokeFeedbackSource = EFFRONT.ServerFn.make({
  input: SourceReference,
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
          ApiError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const markFeedbackReviewed = EFFRONT.ServerFn.make({
  input: FeedbackReference,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          feedbackCommands.updateFeedbackStatus(command, {
            projectId: ctx.projectId,
            feedbackId: input.feedbackId,
            status: 'reviewed',
          }),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const convertFeedbackToIssue = EFFRONT.ServerFn.make({
  input: FeedbackReference,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          feedbackCommands.convertFeedbackToIssue(command, { projectId: ctx.projectId, feedbackId: input.feedbackId }),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const markSelectedFeedbackReviewed = EFFRONT.ServerFn.make({
  input: Bulk,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          feedbackCommands.bulkMarkReviewed(command, { projectId: ctx.projectId, feedbackIds: input.feedbackIds }),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const convertSelectedFeedbackToIssue = EFFRONT.ServerFn.make({
  input: Bulk,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireProject: true })
        const value = yield* runCommand(ctx, (command) =>
          feedbackCommands.bulkConvertToIssue(command, { projectId: ctx.projectId, feedbackIds: input.feedbackIds }),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
