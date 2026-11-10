import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function createLink(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiCreateLink']>) {
  return apiReply(ApiResults.apiCreateLink, ctx.core.apiCreateLink(ctx.actor, ctx.workspaceId, ...args))
}
export function deleteLink(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiDeleteLink']>) {
  return apiReply(ApiResults.apiDeleteLink, ctx.core.apiDeleteLink(ctx.actor, ctx.workspaceId, ...args))
}
export function listLinksForIssue(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListLinksForIssue']>) {
  return apiReply(ApiResults.apiListLinksForIssue, ctx.core.apiListLinksForIssue(ctx.actor, ctx.workspaceId, ...args))
}
