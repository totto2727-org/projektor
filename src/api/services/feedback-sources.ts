import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const createFeedbackSource = function createFeedbackSource(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateFeedbackSource']>
) {
  return apiReply(
    ApiResults.apiCreateFeedbackSource,
    ctx.core.apiCreateFeedbackSource(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const listFeedbackSources = function listFeedbackSources(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListFeedbackSources']>
) {
  return apiReply(
    ApiResults.apiListFeedbackSources,
    ctx.core.apiListFeedbackSources(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const getFeedbackSource = function getFeedbackSource(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetFeedbackSource']>
) {
  return apiReply(ApiResults.apiGetFeedbackSource, ctx.core.apiGetFeedbackSource(ctx.actor, ctx.workspaceId, ...args))
}
export const updateFeedbackSource = function updateFeedbackSource(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateFeedbackSource']>
) {
  return apiReply(
    ApiResults.apiUpdateFeedbackSource,
    ctx.core.apiUpdateFeedbackSource(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const rotateFeedbackSourceToken = function rotateFeedbackSourceToken(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRotateFeedbackSourceToken']>
) {
  return apiReply(
    ApiResults.apiRotateFeedbackSourceToken,
    ctx.core.apiRotateFeedbackSourceToken(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const revokeFeedbackSource = function revokeFeedbackSource(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRevokeFeedbackSource']>
) {
  return apiReply(
    ApiResults.apiRevokeFeedbackSource,
    ctx.core.apiRevokeFeedbackSource(ctx.actor, ctx.workspaceId, ...args),
  )
}
