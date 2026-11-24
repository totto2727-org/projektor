import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const createLink = function createLink(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateLink']>
) {
  return apiReply(ApiResults.apiCreateLink, ctx.core.apiCreateLink(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteLink = function deleteLink(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteLink']>
) {
  return apiReply(ApiResults.apiDeleteLink, ctx.core.apiDeleteLink(ctx.actor, ctx.workspaceId, ...args))
}
export const listLinksForIssue = function listLinksForIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListLinksForIssue']>
) {
  return apiReply(ApiResults.apiListLinksForIssue, ctx.core.apiListLinksForIssue(ctx.actor, ctx.workspaceId, ...args))
}
