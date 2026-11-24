import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const getWikiDraft = function getWikiDraft(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiDraft']>
): Promise<typeof ApiResults.apiGetWikiDraft.Type> {
  return apiReply(ApiResults.apiGetWikiDraft, ctx.core.apiGetWikiDraft(ctx.actor, ctx.workspaceId, ...args))
}
export const saveWikiDraft = function saveWikiDraft(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiSaveWikiDraft']>
): Promise<typeof ApiResults.apiSaveWikiDraft.Type> {
  return apiReply(ApiResults.apiSaveWikiDraft, ctx.core.apiSaveWikiDraft(ctx.actor, ctx.workspaceId, ...args))
}
export const discardWikiDraft = function discardWikiDraft(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDiscardWikiDraft']>
): Promise<typeof ApiResults.apiDiscardWikiDraft.Type> {
  return apiReply(ApiResults.apiDiscardWikiDraft, ctx.core.apiDiscardWikiDraft(ctx.actor, ctx.workspaceId, ...args))
}
