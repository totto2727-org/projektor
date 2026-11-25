import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const createFeedbackSource = async function createFeedbackSource(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateFeedbackSource']>
): Promise<typeof ApiResults.apiCreateFeedbackSource.Type> {
  return apiReply(
    ApiResults.apiCreateFeedbackSource,
    ctx.core.apiCreateFeedbackSource(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const listFeedbackSources = async function listFeedbackSources(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListFeedbackSources']>
): Promise<typeof ApiResults.apiListFeedbackSources.Type> {
  return apiReply(
    ApiResults.apiListFeedbackSources,
    ctx.core.apiListFeedbackSources(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const getFeedbackSource = async function getFeedbackSource(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetFeedbackSource']>
): Promise<typeof ApiResults.apiGetFeedbackSource.Type> {
  return apiReply(ApiResults.apiGetFeedbackSource, ctx.core.apiGetFeedbackSource(ctx.actor, ctx.workspaceId, ...args))
}
export const updateFeedbackSource = async function updateFeedbackSource(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateFeedbackSource']>
): Promise<typeof ApiResults.apiUpdateFeedbackSource.Type> {
  return apiReply(
    ApiResults.apiUpdateFeedbackSource,
    ctx.core.apiUpdateFeedbackSource(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const rotateFeedbackSourceToken = async function rotateFeedbackSourceToken(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRotateFeedbackSourceToken']>
): Promise<typeof ApiResults.apiRotateFeedbackSourceToken.Type> {
  return apiReply(
    ApiResults.apiRotateFeedbackSourceToken,
    ctx.core.apiRotateFeedbackSourceToken(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const revokeFeedbackSource = async function revokeFeedbackSource(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRevokeFeedbackSource']>
): Promise<typeof ApiResults.apiRevokeFeedbackSource.Type> {
  return apiReply(
    ApiResults.apiRevokeFeedbackSource,
    ctx.core.apiRevokeFeedbackSource(ctx.actor, ctx.workspaceId, ...args),
  )
}
