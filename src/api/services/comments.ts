import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

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
