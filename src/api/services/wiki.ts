import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listBrokenWikiLinks(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListBrokenWikiLinks']>
) {
  return apiReply(
    ApiResults.apiListBrokenWikiLinks,
    ctx.core.apiListBrokenWikiLinks(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function backfillWikiLinks(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiBackfillWikiLinks']>) {
  return apiReply(ApiResults.apiBackfillWikiLinks, ctx.core.apiBackfillWikiLinks(ctx.actor, ctx.workspaceId, ...args))
}
export function purgeExpiredWikiPages(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiPurgeExpiredWikiPages']>
) {
  return apiReply(
    ApiResults.apiPurgeExpiredWikiPages,
    ctx.core.apiPurgeExpiredWikiPages(ctx.actor, ctx.workspaceId, ...args),
  )
}

export function listWikiPages(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListWikiPages']>) {
  return apiReply(ApiResults.apiListWikiPages, ctx.core.apiListWikiPages(ctx.actor, ctx.workspaceId, ...args))
}
export function searchWiki(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiSearchWiki']>) {
  return apiReply(ApiResults.apiSearchWiki, ctx.core.apiSearchWiki(ctx.actor, ctx.workspaceId, ...args))
}
export function getWikiPage(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiPage']>) {
  return apiReply(ApiResults.apiGetWikiPage, ctx.core.apiGetWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export function getWikiBacklinks(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiBacklinks']>) {
  return apiReply(ApiResults.apiGetWikiBacklinks, ctx.core.apiGetWikiBacklinks(ctx.actor, ctx.workspaceId, ...args))
}
export function createWikiPage(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiCreateWikiPage']>) {
  return apiReply(ApiResults.apiCreateWikiPage, ctx.core.apiCreateWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export function updateWikiPage(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiUpdateWikiPage']>) {
  return apiReply(ApiResults.apiUpdateWikiPage, ctx.core.apiUpdateWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export function verifyWikiPage(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiVerifyWikiPage']>) {
  return apiReply(ApiResults.apiVerifyWikiPage, ctx.core.apiVerifyWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export function listStaleWikiPages(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListStaleWikiPages']>
) {
  return apiReply(ApiResults.apiListStaleWikiPages, ctx.core.apiListStaleWikiPages(ctx.actor, ctx.workspaceId, ...args))
}
export function patchWikiPage(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiPatchWikiPage']>) {
  return apiReply(ApiResults.apiPatchWikiPage, ctx.core.apiPatchWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export function listWikiTemplates(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListWikiTemplates']>) {
  return apiReply(ApiResults.apiListWikiTemplates, ctx.core.apiListWikiTemplates(ctx.actor, ctx.workspaceId, ...args))
}
export function deleteWikiPage(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiDeleteWikiPage']>) {
  return apiReply(ApiResults.apiDeleteWikiPage, ctx.core.apiDeleteWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export function undeleteWikiPage(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiUndeleteWikiPage']>) {
  return apiReply(ApiResults.apiUndeleteWikiPage, ctx.core.apiUndeleteWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export function listWikiTrash(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListWikiTrash']>) {
  return apiReply(ApiResults.apiListWikiTrash, ctx.core.apiListWikiTrash(ctx.actor, ctx.workspaceId, ...args))
}
export function getWikiTree(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiTree']>) {
  return apiReply(ApiResults.apiGetWikiTree, ctx.core.apiGetWikiTree(ctx.actor, ctx.workspaceId, ...args))
}
export function listWikiRevisions(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListWikiRevisions']>) {
  return apiReply(ApiResults.apiListWikiRevisions, ctx.core.apiListWikiRevisions(ctx.actor, ctx.workspaceId, ...args))
}
export function getWikiRevision(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiRevision']>) {
  return apiReply(ApiResults.apiGetWikiRevision, ctx.core.apiGetWikiRevision(ctx.actor, ctx.workspaceId, ...args))
}
export function getWikiRevisionDiff(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiRevisionDiff']>
) {
  return apiReply(
    ApiResults.apiGetWikiRevisionDiff,
    ctx.core.apiGetWikiRevisionDiff(ctx.actor, ctx.workspaceId, ...args),
  )
}
