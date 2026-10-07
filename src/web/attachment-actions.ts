'use server'

import { Effect, Schema } from 'effect'
import { HttpClientResponse } from 'effect/http'

import {
  type UploadAttachmentInput,
  UploadAttachmentInputSchema,
  type UploadedAttachment,
  UploadedAttachmentSchema,
} from './attachments'
import { EFFRONT } from './effront'
import type { ActionResult } from './function-result'
import { RequestServices } from './request'
import { checkSameOriginMutation, responseError } from './server'
import { resolveFunctionContext } from './server/function-context'

/** Native form action. Effront owns decoding, request limits and page refresh. */
export const uploadAttachment = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(UploadAttachmentInputSchema)] as const,
  handler: (_previous: unknown, input: UploadAttachmentInput) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.scoped(
        Effect.gen(function* () {
          yield* checkSameOriginMutation(services.request)
          const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
          const body = new FormData()
          body.set('file', input.file)
          body.set('entityType', input.entityType)
          body.set('entityId', input.entityId)
          const response = yield* context.api.execute(
            context.api.raw('/api/files', {
              method: 'POST',
              workspaceSlug: context.workspaceSlug,
              body,
            }),
          )
          return yield* HttpClientResponse.schemaBodyJson(UploadedAttachmentSchema)(response).pipe(
            Effect.mapError(responseError),
          )
        }),
      ).pipe(
        Effect.map((value): ActionResult<UploadedAttachment> => ({ ok: true, value })),
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed<ActionResult<UploadedAttachment>>({
              ok: false,
              status: error.status,
              message: error.message,
            }),
          ScopeError: (error) =>
            Effect.succeed<ActionResult<UploadedAttachment>>({
              ok: false,
              status: error.status,
              message: error.message,
            }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

/** Inline editor insertion needs the returned ID without discarding its draft/cursor. */
export const uploadInlineImage = EFFRONT.ServerFn.make({
  input: UploadAttachmentInputSchema,
  handler: (input: UploadAttachmentInput) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.scoped(
        Effect.gen(function* () {
          yield* checkSameOriginMutation(services.request)
          const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
          const body = new FormData()
          body.set('file', input.file)
          body.set('entityType', input.entityType)
          body.set('entityId', input.entityId)
          const response = yield* context.api.execute(
            context.api.raw('/api/files', {
              method: 'POST',
              workspaceSlug: context.workspaceSlug,
              body,
            }),
          )
          return yield* HttpClientResponse.schemaBodyJson(UploadedAttachmentSchema)(response).pipe(
            Effect.mapError(responseError),
          )
        }),
      ).pipe(
        Effect.map((value): ActionResult<UploadedAttachment> => ({ ok: true, value })),
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed<ActionResult<UploadedAttachment>>({
              ok: false,
              status: error.status,
              message: error.message,
            }),
          ScopeError: (error) =>
            Effect.succeed<ActionResult<UploadedAttachment>>({
              ok: false,
              status: error.status,
              message: error.message,
            }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
