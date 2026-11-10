import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listComments(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListComments']>) {
  return apiReply(ApiResults.apiListComments, ctx.core.apiListComments(ctx.actor, ctx.workspaceId, ...args))
}
export function addComment(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiAddComment']>) {
  return apiReply(ApiResults.apiAddComment, ctx.core.apiAddComment(ctx.actor, ctx.workspaceId, ...args))
}
export function updateComment(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiUpdateComment']>) {
  return apiReply(ApiResults.apiUpdateComment, ctx.core.apiUpdateComment(ctx.actor, ctx.workspaceId, ...args))
}
export function deleteComment(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiDeleteComment']>) {
  return apiReply(ApiResults.apiDeleteComment, ctx.core.apiDeleteComment(ctx.actor, ctx.workspaceId, ...args))
}
