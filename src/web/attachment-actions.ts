'use server'

import { Effect, Schema } from 'effect'

import { RateLimitResult, rateLimitTestPolicy } from '../contracts/request-rate-limit'
import {
  type UploadAttachmentInput,
  UploadAttachmentInputSchema,
  UploadedAttachmentSchema,
  type UploadedAttachment,
} from './attachments'
import { coreResult } from './core'
import { transferCoreBinary } from './core-binary'
import { EFFRONT } from './effront'
import type { ActionResult } from './function-result'
import { RequestServices } from './request'
import { ApiError } from './server/errors'
import { resolveFunctionContext } from './server/function-context'
import { checkSameOriginMutation } from './server/mutation'

function uploadToCore(input: UploadAttachmentInput, workspaceId: string) {
  const form = new FormData()
  form.set('file', input.file)
  form.set('entityType', input.entityType)
  form.set('entityId', input.entityId)
  return Effect.gen(function* () {
    const services = yield* RequestServices
    const limited = yield* coreResult(
      RateLimitResult,
      services.core.apiCheckRateLimit({
        ip: services.request.headers.get('cf-connecting-ip') ?? undefined,
        testPolicy: rateLimitTestPolicy(services.env),
      }),
    )
    if (limited)
      return yield* new ApiError('request', 429, 'Too many requests', undefined, { retryAfter: limited.retryAfter })
    return yield* transferCoreBinary(`/files?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'POST',
      body: form,
    })
  }).pipe(
    Effect.flatMap((response) => Effect.tryPromise(() => response.json())),
    Effect.flatMap(Schema.decodeUnknownEffect(UploadedAttachmentSchema)),
    Effect.mapError((error) =>
      error instanceof ApiError ? error : new ApiError('request', 502, 'The operation could not be completed.'),
    ),
  )
}

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
          const selection = context.scope.selection
          if (selection.kind !== 'workspace' && selection.kind !== 'project')
            return yield* new ApiError('request', 403, 'Selected workspace is not accessible.')
          return yield* uploadToCore(input, selection.workspace.id)
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
          const selection = context.scope.selection
          if (selection.kind !== 'workspace' && selection.kind !== 'project')
            return yield* new ApiError('request', 403, 'Selected workspace is not accessible.')
          return yield* uploadToCore(input, selection.workspace.id)
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
