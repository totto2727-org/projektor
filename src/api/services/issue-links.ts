import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const createLink = async function createLink(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateLink']>
): Promise<typeof ApiResults.apiCreateLink.Type> {
  return apiReply(ApiResults.apiCreateLink, ctx.core.apiCreateLink(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteLink = async function deleteLink(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteLink']>
): Promise<typeof ApiResults.apiDeleteLink.Type> {
  return apiReply(ApiResults.apiDeleteLink, ctx.core.apiDeleteLink(ctx.actor, ctx.workspaceId, ...args))
}
export const listLinksForIssue = async function listLinksForIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListLinksForIssue']>
): Promise<typeof ApiResults.apiListLinksForIssue.Type> {
  return apiReply(ApiResults.apiListLinksForIssue, ctx.core.apiListLinksForIssue(ctx.actor, ctx.workspaceId, ...args))
}
