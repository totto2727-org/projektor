import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listAttachments = function listAttachments(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListAttachments']>
) {
  return apiReply(ApiResults.apiListAttachments, ctx.core.apiListAttachments(ctx.actor, ctx.workspaceId, ...args))
}
export const createLinkAttachment = function createLinkAttachment(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateLinkAttachment']>
) {
  return apiReply(
    ApiResults.apiCreateLinkAttachment,
    ctx.core.apiCreateLinkAttachment(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const getAttachment = function getAttachment(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetAttachment']>
) {
  return apiReply(ApiResults.apiGetAttachment, ctx.core.apiGetAttachment(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteAttachment = function deleteAttachment(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteAttachment']>
) {
  return apiReply(ApiResults.apiDeleteAttachment, ctx.core.apiDeleteAttachment(ctx.actor, ctx.workspaceId, ...args))
}
export const setAttachmentReviewStatus = function setAttachmentReviewStatus(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiSetAttachmentReviewStatus']>
) {
  return apiReply(
    ApiResults.apiSetAttachmentReviewStatus,
    ctx.core.apiSetAttachmentReviewStatus(ctx.actor, ctx.workspaceId, ...args),
  )
}
