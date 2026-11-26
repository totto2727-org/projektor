import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listBrokenWikiLinks = async function listBrokenWikiLinks(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListBrokenWikiLinks']>
): Promise<typeof ApiResults.apiListBrokenWikiLinks.Type> {
  return apiReply(
    ApiResults.apiListBrokenWikiLinks,
    ctx.core.apiListBrokenWikiLinks(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const backfillWikiLinks = async function backfillWikiLinks(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiBackfillWikiLinks']>
): Promise<typeof ApiResults.apiBackfillWikiLinks.Type> {
  return apiReply(ApiResults.apiBackfillWikiLinks, ctx.core.apiBackfillWikiLinks(ctx.actor, ctx.workspaceId, ...args))
}
export const purgeExpiredWikiPages = async function purgeExpiredWikiPages(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiPurgeExpiredWikiPages']>
): Promise<typeof ApiResults.apiPurgeExpiredWikiPages.Type> {
  return apiReply(
    ApiResults.apiPurgeExpiredWikiPages,
    ctx.core.apiPurgeExpiredWikiPages(ctx.actor, ctx.workspaceId, ...args),
  )
}

export const listWikiPages = async function listWikiPages(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListWikiPages']>
): Promise<typeof ApiResults.apiListWikiPages.Type> {
  return apiReply(ApiResults.apiListWikiPages, ctx.core.apiListWikiPages(ctx.actor, ctx.workspaceId, ...args))
}
export const searchWiki = async function searchWiki(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiSearchWiki']>
): Promise<typeof ApiResults.apiSearchWiki.Type> {
  return apiReply(ApiResults.apiSearchWiki, ctx.core.apiSearchWiki(ctx.actor, ctx.workspaceId, ...args))
}
export const getWikiPage = async function getWikiPage(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiPage']>
): Promise<typeof ApiResults.apiGetWikiPage.Type> {
  return apiReply(ApiResults.apiGetWikiPage, ctx.core.apiGetWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export const getWikiBacklinks = async function getWikiBacklinks(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiBacklinks']>
): Promise<typeof ApiResults.apiGetWikiBacklinks.Type> {
  return apiReply(ApiResults.apiGetWikiBacklinks, ctx.core.apiGetWikiBacklinks(ctx.actor, ctx.workspaceId, ...args))
}
export const createWikiPage = async function createWikiPage(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateWikiPage']>
): Promise<typeof ApiResults.apiCreateWikiPage.Type> {
  return apiReply(ApiResults.apiCreateWikiPage, ctx.core.apiCreateWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export const updateWikiPage = async function updateWikiPage(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateWikiPage']>
): Promise<typeof ApiResults.apiUpdateWikiPage.Type> {
  return apiReply(ApiResults.apiUpdateWikiPage, ctx.core.apiUpdateWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export const verifyWikiPage = async function verifyWikiPage(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiVerifyWikiPage']>
): Promise<typeof ApiResults.apiVerifyWikiPage.Type> {
  return apiReply(ApiResults.apiVerifyWikiPage, ctx.core.apiVerifyWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export const listStaleWikiPages = async function listStaleWikiPages(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListStaleWikiPages']>
): Promise<typeof ApiResults.apiListStaleWikiPages.Type> {
  return apiReply(ApiResults.apiListStaleWikiPages, ctx.core.apiListStaleWikiPages(ctx.actor, ctx.workspaceId, ...args))
}
export const patchWikiPage = async function patchWikiPage(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiPatchWikiPage']>
): Promise<typeof ApiResults.apiPatchWikiPage.Type> {
  return apiReply(ApiResults.apiPatchWikiPage, ctx.core.apiPatchWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export const listWikiTemplates = async function listWikiTemplates(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListWikiTemplates']>
): Promise<typeof ApiResults.apiListWikiTemplates.Type> {
  return apiReply(ApiResults.apiListWikiTemplates, ctx.core.apiListWikiTemplates(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteWikiPage = async function deleteWikiPage(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteWikiPage']>
): Promise<typeof ApiResults.apiDeleteWikiPage.Type> {
  return apiReply(ApiResults.apiDeleteWikiPage, ctx.core.apiDeleteWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export const undeleteWikiPage = async function undeleteWikiPage(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUndeleteWikiPage']>
): Promise<typeof ApiResults.apiUndeleteWikiPage.Type> {
  return apiReply(ApiResults.apiUndeleteWikiPage, ctx.core.apiUndeleteWikiPage(ctx.actor, ctx.workspaceId, ...args))
}
export const listWikiTrash = async function listWikiTrash(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListWikiTrash']>
): Promise<typeof ApiResults.apiListWikiTrash.Type> {
  return apiReply(ApiResults.apiListWikiTrash, ctx.core.apiListWikiTrash(ctx.actor, ctx.workspaceId, ...args))
}
export const getWikiTree = async function getWikiTree(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiTree']>
): Promise<typeof ApiResults.apiGetWikiTree.Type> {
  return apiReply(ApiResults.apiGetWikiTree, ctx.core.apiGetWikiTree(ctx.actor, ctx.workspaceId, ...args))
}
export const listWikiRevisions = async function listWikiRevisions(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListWikiRevisions']>
): Promise<typeof ApiResults.apiListWikiRevisions.Type> {
  return apiReply(ApiResults.apiListWikiRevisions, ctx.core.apiListWikiRevisions(ctx.actor, ctx.workspaceId, ...args))
}
export const getWikiRevision = async function getWikiRevision(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiRevision']>
): Promise<typeof ApiResults.apiGetWikiRevision.Type> {
  return apiReply(ApiResults.apiGetWikiRevision, ctx.core.apiGetWikiRevision(ctx.actor, ctx.workspaceId, ...args))
}
export const getWikiRevisionDiff = async function getWikiRevisionDiff(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWikiRevisionDiff']>
): Promise<typeof ApiResults.apiGetWikiRevisionDiff.Type> {
  return apiReply(
    ApiResults.apiGetWikiRevisionDiff,
    ctx.core.apiGetWikiRevisionDiff(ctx.actor, ctx.workspaceId, ...args),
  )
}
