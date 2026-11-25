import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const watchWikiPage = async function watchWikiPage(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiWatchWikiPage']>
): Promise<typeof ApiResults.apiWatchWikiPage.Type> {
  return apiReply(ApiResults.apiWatchWikiPage, ctx.core.apiWatchWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export const unwatchWikiPage = async function unwatchWikiPage(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUnwatchWikiPage']>
): Promise<typeof ApiResults.apiUnwatchWikiPage.Type> {
  return apiReply(ApiResults.apiUnwatchWikiPage, ctx.core.apiUnwatchWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export const listWikiWatches = async function listWikiWatches(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListWikiWatches']>
): Promise<typeof ApiResults.apiListWikiWatches.Type> {
  return apiReply(ApiResults.apiListWikiWatches, ctx.core.apiListWikiWatches(ctx.actor, ctx.workspaceId, ...args))
}
export const listWikiNotifications = async function listWikiNotifications(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListWikiNotifications']>
): Promise<typeof ApiResults.apiListWikiNotifications.Type> {
  return apiReply(
    ApiResults.apiListWikiNotifications,
    ctx.core.apiListWikiNotifications(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const markWikiNotificationsRead = async function markWikiNotificationsRead(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiMarkWikiNotificationsRead']>
): Promise<typeof ApiResults.apiMarkWikiNotificationsRead.Type> {
  return apiReply(
    ApiResults.apiMarkWikiNotificationsRead,
    ctx.core.apiMarkWikiNotificationsRead(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const listWikiChanges = async function listWikiChanges(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListWikiChanges']>
): Promise<typeof ApiResults.apiListWikiChanges.Type> {
  return apiReply(ApiResults.apiListWikiChanges, ctx.core.apiListWikiChanges(ctx.actor, ctx.workspaceId, ...args))
}
