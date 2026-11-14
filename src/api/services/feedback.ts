import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listFeedback(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListFeedback']>) {
  return apiReply(ApiResults.apiListFeedback, ctx.core.apiListFeedback(ctx.actor, ctx.workspaceId, ...args))
}
export function updateFeedbackStatus(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateFeedbackStatus']>
) {
  return apiReply(
    ApiResults.apiUpdateFeedbackStatus,
    ctx.core.apiUpdateFeedbackStatus(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function convertFeedbackToIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiConvertFeedbackToIssue']>
) {
  return apiReply(
    ApiResults.apiConvertFeedbackToIssue,
    ctx.core.apiConvertFeedbackToIssue(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function bulkMarkReviewed(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiBulkMarkReviewed']>) {
  return apiReply(ApiResults.apiBulkMarkReviewed, ctx.core.apiBulkMarkReviewed(ctx.actor, ctx.workspaceId, ...args))
}
export function bulkConvertToIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiBulkConvertToIssue']>
) {
  return apiReply(ApiResults.apiBulkConvertToIssue, ctx.core.apiBulkConvertToIssue(ctx.actor, ctx.workspaceId, ...args))
}
export function getFeedbackSummary(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetFeedbackSummary']>
) {
  return apiReply(ApiResults.apiGetFeedbackSummary, ctx.core.apiGetFeedbackSummary(ctx.actor, ctx.workspaceId, ...args))
}
