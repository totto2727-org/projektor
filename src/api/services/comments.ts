import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listComments = function listComments(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListComments']>
): Promise<typeof ApiResults.apiListComments.Type> {
  return apiReply(ApiResults.apiListComments, ctx.core.apiListComments(ctx.actor, ctx.workspaceId, ...args))
}
export const addComment = function addComment(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiAddComment']>
): Promise<typeof ApiResults.apiAddComment.Type> {
  return apiReply(ApiResults.apiAddComment, ctx.core.apiAddComment(ctx.actor, ctx.workspaceId, ...args))
}
export const updateComment = function updateComment(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateComment']>
): Promise<typeof ApiResults.apiUpdateComment.Type> {
  return apiReply(ApiResults.apiUpdateComment, ctx.core.apiUpdateComment(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteComment = function deleteComment(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteComment']>
): Promise<typeof ApiResults.apiDeleteComment.Type> {
  return apiReply(ApiResults.apiDeleteComment, ctx.core.apiDeleteComment(ctx.actor, ctx.workspaceId, ...args))
}
