import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listAttachments(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListAttachments']>) {
  return apiReply(ApiResults.apiListAttachments, ctx.core.apiListAttachments(ctx.actor, ctx.workspaceId, ...args))
}
export function createLinkAttachment(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateLinkAttachment']>
) {
  return apiReply(
    ApiResults.apiCreateLinkAttachment,
    ctx.core.apiCreateLinkAttachment(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function getAttachment(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetAttachment']>) {
  return apiReply(ApiResults.apiGetAttachment, ctx.core.apiGetAttachment(ctx.actor, ctx.workspaceId, ...args))
}
export function deleteAttachment(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiDeleteAttachment']>) {
  return apiReply(ApiResults.apiDeleteAttachment, ctx.core.apiDeleteAttachment(ctx.actor, ctx.workspaceId, ...args))
}
export function setAttachmentReviewStatus(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiSetAttachmentReviewStatus']>
) {
  return apiReply(
    ApiResults.apiSetAttachmentReviewStatus,
    ctx.core.apiSetAttachmentReviewStatus(ctx.actor, ctx.workspaceId, ...args),
  )
}
