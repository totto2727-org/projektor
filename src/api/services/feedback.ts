import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listFeedback = async function listFeedback(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListFeedback']>
): Promise<typeof ApiResults.apiListFeedback.Type> {
  return apiReply(ApiResults.apiListFeedback, ctx.core.apiListFeedback(ctx.actor, ctx.workspaceId, ...args))
}
export const updateFeedbackStatus = async function updateFeedbackStatus(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateFeedbackStatus']>
): Promise<typeof ApiResults.apiUpdateFeedbackStatus.Type> {
  return apiReply(
    ApiResults.apiUpdateFeedbackStatus,
    ctx.core.apiUpdateFeedbackStatus(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const convertFeedbackToIssue = async function convertFeedbackToIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiConvertFeedbackToIssue']>
): Promise<typeof ApiResults.apiConvertFeedbackToIssue.Type> {
  return apiReply(
    ApiResults.apiConvertFeedbackToIssue,
    ctx.core.apiConvertFeedbackToIssue(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const bulkMarkReviewed = async function bulkMarkReviewed(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiBulkMarkReviewed']>
): Promise<typeof ApiResults.apiBulkMarkReviewed.Type> {
  return apiReply(ApiResults.apiBulkMarkReviewed, ctx.core.apiBulkMarkReviewed(ctx.actor, ctx.workspaceId, ...args))
}
export const bulkConvertToIssue = async function bulkConvertToIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiBulkConvertToIssue']>
): Promise<typeof ApiResults.apiBulkConvertToIssue.Type> {
  return apiReply(ApiResults.apiBulkConvertToIssue, ctx.core.apiBulkConvertToIssue(ctx.actor, ctx.workspaceId, ...args))
}
export const getFeedbackSummary = async function getFeedbackSummary(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetFeedbackSummary']>
): Promise<typeof ApiResults.apiGetFeedbackSummary.Type> {
  return apiReply(ApiResults.apiGetFeedbackSummary, ctx.core.apiGetFeedbackSummary(ctx.actor, ctx.workspaceId, ...args))
}
