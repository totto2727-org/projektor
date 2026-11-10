import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function watchWikiPage(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiWatchWikiPage']>) {
  return apiReply(ApiResults.apiWatchWikiPage, ctx.core.apiWatchWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export function unwatchWikiPage(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiUnwatchWikiPage']>) {
  return apiReply(ApiResults.apiUnwatchWikiPage, ctx.core.apiUnwatchWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export function listWikiWatches(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListWikiWatches']>) {
  return apiReply(ApiResults.apiListWikiWatches, ctx.core.apiListWikiWatches(ctx.actor, ctx.workspaceId, ...args))
}
export function listWikiNotifications(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListWikiNotifications']>
) {
  return apiReply(
    ApiResults.apiListWikiNotifications,
    ctx.core.apiListWikiNotifications(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function markWikiNotificationsRead(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiMarkWikiNotificationsRead']>
) {
  return apiReply(
    ApiResults.apiMarkWikiNotificationsRead,
    ctx.core.apiMarkWikiNotificationsRead(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function listWikiChanges(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListWikiChanges']>) {
  return apiReply(ApiResults.apiListWikiChanges, ctx.core.apiListWikiChanges(ctx.actor, ctx.workspaceId, ...args))
}
