import { Schema } from 'effect'

import { coreResult } from '@/core.ts'
import type { CoreResult } from '@/core.ts'
import type { BrowserCommandClient } from '@/server/browser-command.ts'

import { CreatedSource, Converted, Ok } from './schemas.ts'

export const sourceCommands = {
  createFeedbackSource: (ctx: BrowserCommandClient, input: unknown): CoreResult<typeof CreatedSource.Type> =>
    coreResult(CreatedSource, ctx.core.webCreateFeedbackSource(ctx.proof, input)),
  updateFeedbackSource: (ctx: BrowserCommandClient, input: unknown): CoreResult<typeof Ok.Type> =>
    coreResult(Ok, ctx.core.webUpdateFeedbackSource(ctx.proof, input)),
  rotateFeedbackSourceToken: (ctx: BrowserCommandClient, input: unknown): CoreResult<Readonly<{ token: string }>> =>
    coreResult(Schema.Struct({ token: Schema.String }), ctx.core.webRotateFeedbackSourceToken(ctx.proof, input)),
  revokeFeedbackSource: (ctx: BrowserCommandClient, input: unknown): CoreResult<typeof Ok.Type> =>
    coreResult(Ok, ctx.core.webRevokeFeedbackSource(ctx.proof, input)),
}
export const feedbackCommands = {
  updateFeedbackStatus: (ctx: BrowserCommandClient, input: unknown): CoreResult<typeof Ok.Type> =>
    coreResult(Ok, ctx.core.webUpdateFeedbackStatus(ctx.proof, input)),
  convertFeedbackToIssue: (ctx: BrowserCommandClient, input: unknown): CoreResult<typeof Converted.Type> =>
    coreResult(Converted, ctx.core.webConvertFeedback(ctx.proof, input)),
  bulkMarkReviewed: (ctx: BrowserCommandClient, input: unknown): CoreResult<Readonly<{ updated: number }>> =>
    coreResult(Schema.Struct({ updated: Schema.Number }), ctx.core.webBulkReviewFeedback(ctx.proof, input)),
  bulkConvertToIssue: (
    ctx: BrowserCommandClient,
    input: unknown,
  ): CoreResult<typeof Converted.Type & Readonly<{ convertedCount: number }>> =>
    coreResult(
      Schema.Struct({ ...Converted.fields, convertedCount: Schema.Number }),
      ctx.core.webBulkConvertFeedback(ctx.proof, input),
    ),
}
