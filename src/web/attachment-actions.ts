'use server'

import { Effect, Schema } from 'effect'

import { storageQuotaBytes, uploadStoredAttachment } from '#commands/files'

import { type UploadAttachmentInput, UploadAttachmentInputSchema, type UploadedAttachment } from './attachments'
import { EFFRONT } from './effront'
import type { ActionResult } from './function-result'
import { RequestServices } from './request'
import { runCommand } from './server/command-context'
import { ApiError } from './server/errors'
import { resolveFunctionContext } from './server/function-context'
import { checkSameOriginMutation } from './server/mutation'

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
          // Preserve the Web transport's effective 10 MiB limit, not the API's larger cap.
          if (input.file.size > 10 * 1024 * 1024)
            return yield* new ApiError('request', 413, 'File too large (max 10 MB)')
          return yield* runCommand(context, (ctx) =>
            uploadStoredAttachment(ctx, input, storageQuotaBytes(services.env)),
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
          // Preserve the Web transport's effective 10 MiB limit, not the API's larger cap.
          if (input.file.size > 10 * 1024 * 1024)
            return yield* new ApiError('request', 413, 'File too large (max 10 MB)')
          return yield* runCommand(context, (ctx) =>
            uploadStoredAttachment(ctx, input, storageQuotaBytes(services.env)),
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
