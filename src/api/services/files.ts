import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listAttachments = function listAttachments(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListAttachments']>
): Promise<typeof ApiResults.apiListAttachments.Type> {
  return apiReply(ApiResults.apiListAttachments, ctx.core.apiListAttachments(ctx.actor, ctx.workspaceId, ...args))
}
export const createLinkAttachment = function createLinkAttachment(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateLinkAttachment']>
): Promise<typeof ApiResults.apiCreateLinkAttachment.Type> {
  return apiReply(
    ApiResults.apiCreateLinkAttachment,
    ctx.core.apiCreateLinkAttachment(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const getAttachment = function getAttachment(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetAttachment']>
): Promise<typeof ApiResults.apiGetAttachment.Type> {
  return apiReply(ApiResults.apiGetAttachment, ctx.core.apiGetAttachment(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteAttachment = function deleteAttachment(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteAttachment']>
): Promise<typeof ApiResults.apiDeleteAttachment.Type> {
  return apiReply(ApiResults.apiDeleteAttachment, ctx.core.apiDeleteAttachment(ctx.actor, ctx.workspaceId, ...args))
}
export const setAttachmentReviewStatus = function setAttachmentReviewStatus(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiSetAttachmentReviewStatus']>
): Promise<typeof ApiResults.apiSetAttachmentReviewStatus.Type> {
  return apiReply(
    ApiResults.apiSetAttachmentReviewStatus,
    ctx.core.apiSetAttachmentReviewStatus(ctx.actor, ctx.workspaceId, ...args),
  )
}
