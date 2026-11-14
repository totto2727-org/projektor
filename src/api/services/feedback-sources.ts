import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function createFeedbackSource(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateFeedbackSource']>
) {
  return apiReply(
    ApiResults.apiCreateFeedbackSource,
    ctx.core.apiCreateFeedbackSource(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function listFeedbackSources(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListFeedbackSources']>
) {
  return apiReply(
    ApiResults.apiListFeedbackSources,
    ctx.core.apiListFeedbackSources(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function getFeedbackSource(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetFeedbackSource']>) {
  return apiReply(ApiResults.apiGetFeedbackSource, ctx.core.apiGetFeedbackSource(ctx.actor, ctx.workspaceId, ...args))
}
export function updateFeedbackSource(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateFeedbackSource']>
) {
  return apiReply(
    ApiResults.apiUpdateFeedbackSource,
    ctx.core.apiUpdateFeedbackSource(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function rotateFeedbackSourceToken(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRotateFeedbackSourceToken']>
) {
  return apiReply(
    ApiResults.apiRotateFeedbackSourceToken,
    ctx.core.apiRotateFeedbackSourceToken(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function revokeFeedbackSource(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRevokeFeedbackSource']>
) {
  return apiReply(
    ApiResults.apiRevokeFeedbackSource,
    ctx.core.apiRevokeFeedbackSource(ctx.actor, ctx.workspaceId, ...args),
  )
}
