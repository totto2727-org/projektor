import { Schema } from 'effect'

import { coreResult } from '../../core'
import type { BrowserCommandClient } from '../../server/browser-command'
import { CreatedSource, Converted, Ok } from './schemas'

export const sourceCommands = {
  createFeedbackSource: (ctx: BrowserCommandClient, input: unknown) =>
    coreResult(CreatedSource, ctx.core.webCreateFeedbackSource(ctx.proof, input)),
  updateFeedbackSource: (ctx: BrowserCommandClient, input: unknown) =>
    coreResult(Ok, ctx.core.webUpdateFeedbackSource(ctx.proof, input)),
  rotateFeedbackSourceToken: (ctx: BrowserCommandClient, input: unknown) =>
    coreResult(Schema.Struct({ token: Schema.String }), ctx.core.webRotateFeedbackSourceToken(ctx.proof, input)),
  revokeFeedbackSource: (ctx: BrowserCommandClient, input: unknown) =>
    coreResult(Ok, ctx.core.webRevokeFeedbackSource(ctx.proof, input)),
}
export const feedbackCommands = {
  updateFeedbackStatus: (ctx: BrowserCommandClient, input: unknown) =>
    coreResult(Ok, ctx.core.webUpdateFeedbackStatus(ctx.proof, input)),
  convertFeedbackToIssue: (ctx: BrowserCommandClient, input: unknown) =>
    coreResult(Converted, ctx.core.webConvertFeedback(ctx.proof, input)),
  bulkMarkReviewed: (ctx: BrowserCommandClient, input: unknown) =>
    coreResult(Schema.Struct({ updated: Schema.Number }), ctx.core.webBulkReviewFeedback(ctx.proof, input)),
  bulkConvertToIssue: (ctx: BrowserCommandClient, input: unknown) =>
    coreResult(
      Schema.Struct({ ...Converted.fields, convertedCount: Schema.Number }),
      ctx.core.webBulkConvertFeedback(ctx.proof, input),
    ),
}
