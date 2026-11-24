import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listGroups = function listGroups(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListGroups']>
) {
  return apiReply(ApiResults.apiListGroups, ctx.core.apiListGroups(ctx.actor, ctx.workspaceId, ...args))
}
export const getGroup = function getGroup(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetGroup']>) {
  return apiReply(ApiResults.apiGetGroup, ctx.core.apiGetGroup(ctx.actor, ctx.workspaceId, ...args))
}
export const listMemberGroups = function listMemberGroups(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListMemberGroups']>
) {
  return apiReply(ApiResults.apiListMemberGroups, ctx.core.apiListMemberGroups(ctx.actor, ctx.workspaceId, ...args))
}
export const createGroup = function createGroup(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateGroup']>
) {
  return apiReply(ApiResults.apiCreateGroup, ctx.core.apiCreateGroup(ctx.actor, ctx.workspaceId, ...args))
}
export const updateGroup = function updateGroup(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateGroup']>
) {
  return apiReply(ApiResults.apiUpdateGroup, ctx.core.apiUpdateGroup(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteGroup = function deleteGroup(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteGroup']>
) {
  return apiReply(ApiResults.apiDeleteGroup, ctx.core.apiDeleteGroup(ctx.actor, ctx.workspaceId, ...args))
}
export const addGroupMember = function addGroupMember(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiAddGroupMember']>
) {
  return apiReply(ApiResults.apiAddGroupMember, ctx.core.apiAddGroupMember(ctx.actor, ctx.workspaceId, ...args))
}
export const removeGroupMember = function removeGroupMember(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRemoveGroupMember']>
) {
  return apiReply(ApiResults.apiRemoveGroupMember, ctx.core.apiRemoveGroupMember(ctx.actor, ctx.workspaceId, ...args))
}
export const setGroupGrant = function setGroupGrant(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiSetGroupGrant']>
) {
  return apiReply(ApiResults.apiSetGroupGrant, ctx.core.apiSetGroupGrant(ctx.actor, ctx.workspaceId, ...args))
}
export const removeGroupGrant = function removeGroupGrant(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRemoveGroupGrant']>
) {
  return apiReply(ApiResults.apiRemoveGroupGrant, ctx.core.apiRemoveGroupGrant(ctx.actor, ctx.workspaceId, ...args))
}
