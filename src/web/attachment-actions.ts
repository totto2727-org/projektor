'use server'

import { Effect, Schema } from 'effect'

import {
  HTTP_BAD_GATEWAY,
  HTTP_FORBIDDEN,
  HTTP_PAYLOAD_TOO_LARGE,
  HTTP_TOO_MANY_REQUESTS,
} from '#contracts/http-status.ts'
import { RateLimitResult, rateLimitTestPolicy } from '#contracts/request-rate-limit.ts'

import {
  MAX_SERVER_FUNCTION_UPLOAD_BYTES,
  UploadAttachmentInputSchema,
  UploadedAttachmentSchema,
} from './attachments.ts'
import type { UploadAttachmentInput, UploadedAttachment } from './attachments.ts'
import { transferCoreBinary } from './core-binary.ts'
import { coreResult } from './core.ts'
import { EFFRONT } from './effront.ts'
import type { ActionResult } from './function-result.ts'
import { actionFailure } from './function-result.ts'
import { RequestServices } from './request.ts'
import { ApiError } from './server/errors.ts'
import { resolveFunctionContext } from './server/function-context.ts'
import { checkSameOriginMutation } from './server/mutation.ts'

const uploadToCore = function uploadToCore(input: UploadAttachmentInput, workspaceId: string) {
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
    if (limited) {
      return yield* new ApiError('request', HTTP_TOO_MANY_REQUESTS, 'Too many requests', undefined, {
        retryAfter: limited.retryAfter,
      })
    }
    return yield* transferCoreBinary(`/files?workspaceId=${encodeURIComponent(workspaceId)}`, {
      body: form,
      method: 'POST',
    })
  }).pipe(
    Effect.flatMap((response) => Effect.tryPromise(() => response.json())),
    Effect.flatMap(Schema.decodeUnknownEffect(UploadedAttachmentSchema)),
    Effect.mapError((error) =>
      error instanceof ApiError
        ? error
        : new ApiError('request', HTTP_BAD_GATEWAY, 'The operation could not be completed.'),
    ),
  )
}

/** Native form action. Effront owns decoding, request limits and page refresh. */
export const uploadAttachment = EFFRONT.ServerFn.make({
  handler: (_previous: unknown, input: UploadAttachmentInput) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.scoped(
        Effect.gen(function* () {
          yield* checkSameOriginMutation(services.request)
          const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
          // Preserve the Web transport's effective 10 MiB limit, not the API's larger cap.
          if (input.file.size > MAX_SERVER_FUNCTION_UPLOAD_BYTES) {
            return yield* new ApiError('request', HTTP_PAYLOAD_TOO_LARGE, 'File too large (max 10 MB)')
          }
          const { selection } = context.scope
          if (selection.kind !== 'workspace' && selection.kind !== 'project') {
            return yield* new ApiError('request', HTTP_FORBIDDEN, 'Selected workspace is not accessible.')
          }
          return yield* uploadToCore(input, selection.workspace.id)
        }),
      ).pipe(
        Effect.map((value): ActionResult<UploadedAttachment> => ({ ok: true, value })),
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed<ActionResult<UploadedAttachment>>(actionFailure(error.status, error.message)),
          ScopeError: (error) =>
            Effect.succeed<ActionResult<UploadedAttachment>>(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: [Schema.Unknown, Schema.fromFormData(UploadAttachmentInputSchema)] as const,
})

/** Inline editor insertion needs the returned ID without discarding its draft/cursor. */
export const uploadInlineImage = EFFRONT.ServerFn.make({
  handler: (input: UploadAttachmentInput) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.scoped(
        Effect.gen(function* () {
          yield* checkSameOriginMutation(services.request)
          const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
          // Preserve the Web transport's effective 10 MiB limit, not the API's larger cap.
          if (input.file.size > MAX_SERVER_FUNCTION_UPLOAD_BYTES) {
            return yield* new ApiError('request', HTTP_PAYLOAD_TOO_LARGE, 'File too large (max 10 MB)')
          }
          const { selection } = context.scope
          if (selection.kind !== 'workspace' && selection.kind !== 'project') {
            return yield* new ApiError('request', HTTP_FORBIDDEN, 'Selected workspace is not accessible.')
          }
          return yield* uploadToCore(input, selection.workspace.id)
        }),
      ).pipe(
        Effect.map((value): ActionResult<UploadedAttachment> => ({ ok: true, value })),
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed<ActionResult<UploadedAttachment>>(actionFailure(error.status, error.message)),
          ScopeError: (error) =>
            Effect.succeed<ActionResult<UploadedAttachment>>(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: UploadAttachmentInputSchema,
})
