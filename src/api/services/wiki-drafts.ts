import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export function getWikiDraft(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiDraft']>) {
  return apiReply(ApiResults.apiGetWikiDraft, ctx.core.apiGetWikiDraft(ctx.actor, ctx.workspaceId, ...args))
}
export function saveWikiDraft(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiSaveWikiDraft']>) {
  return apiReply(ApiResults.apiSaveWikiDraft, ctx.core.apiSaveWikiDraft(ctx.actor, ctx.workspaceId, ...args))
}
export function discardWikiDraft(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiDiscardWikiDraft']>) {
  return apiReply(ApiResults.apiDiscardWikiDraft, ctx.core.apiDiscardWikiDraft(ctx.actor, ctx.workspaceId, ...args))
}
