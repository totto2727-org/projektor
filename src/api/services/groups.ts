import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listGroups = async function listGroups(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListGroups']>
): Promise<typeof ApiResults.apiListGroups.Type> {
  return apiReply(ApiResults.apiListGroups, ctx.core.apiListGroups(ctx.actor, ctx.workspaceId, ...args))
}
export const getGroup = async function getGroup(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetGroup']>
): Promise<typeof ApiResults.apiGetGroup.Type> {
  return apiReply(ApiResults.apiGetGroup, ctx.core.apiGetGroup(ctx.actor, ctx.workspaceId, ...args))
}
export const listMemberGroups = async function listMemberGroups(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListMemberGroups']>
): Promise<typeof ApiResults.apiListMemberGroups.Type> {
  return apiReply(ApiResults.apiListMemberGroups, ctx.core.apiListMemberGroups(ctx.actor, ctx.workspaceId, ...args))
}
export const createGroup = async function createGroup(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateGroup']>
): Promise<typeof ApiResults.apiCreateGroup.Type> {
  return apiReply(ApiResults.apiCreateGroup, ctx.core.apiCreateGroup(ctx.actor, ctx.workspaceId, ...args))
}
export const updateGroup = async function updateGroup(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateGroup']>
): Promise<typeof ApiResults.apiUpdateGroup.Type> {
  return apiReply(ApiResults.apiUpdateGroup, ctx.core.apiUpdateGroup(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteGroup = async function deleteGroup(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteGroup']>
): Promise<typeof ApiResults.apiDeleteGroup.Type> {
  return apiReply(ApiResults.apiDeleteGroup, ctx.core.apiDeleteGroup(ctx.actor, ctx.workspaceId, ...args))
}
export const addGroupMember = async function addGroupMember(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiAddGroupMember']>
): Promise<typeof ApiResults.apiAddGroupMember.Type> {
  return apiReply(ApiResults.apiAddGroupMember, ctx.core.apiAddGroupMember(ctx.actor, ctx.workspaceId, ...args))
}
export const removeGroupMember = async function removeGroupMember(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRemoveGroupMember']>
): Promise<typeof ApiResults.apiRemoveGroupMember.Type> {
  return apiReply(ApiResults.apiRemoveGroupMember, ctx.core.apiRemoveGroupMember(ctx.actor, ctx.workspaceId, ...args))
}
export const setGroupGrant = async function setGroupGrant(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiSetGroupGrant']>
): Promise<typeof ApiResults.apiSetGroupGrant.Type> {
  return apiReply(ApiResults.apiSetGroupGrant, ctx.core.apiSetGroupGrant(ctx.actor, ctx.workspaceId, ...args))
}
export const removeGroupGrant = async function removeGroupGrant(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRemoveGroupGrant']>
): Promise<typeof ApiResults.apiRemoveGroupGrant.Type> {
  return apiReply(ApiResults.apiRemoveGroupGrant, ctx.core.apiRemoveGroupGrant(ctx.actor, ctx.workspaceId, ...args))
}
