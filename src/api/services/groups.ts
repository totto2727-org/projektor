import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listGroups(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListGroups']>) {
  return apiReply(ApiResults.apiListGroups, ctx.core.apiListGroups(ctx.actor, ctx.workspaceId, ...args))
}
export function getGroup(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetGroup']>) {
  return apiReply(ApiResults.apiGetGroup, ctx.core.apiGetGroup(ctx.actor, ctx.workspaceId, ...args))
}
export function listMemberGroups(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListMemberGroups']>) {
  return apiReply(ApiResults.apiListMemberGroups, ctx.core.apiListMemberGroups(ctx.actor, ctx.workspaceId, ...args))
}
export function createGroup(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiCreateGroup']>) {
  return apiReply(ApiResults.apiCreateGroup, ctx.core.apiCreateGroup(ctx.actor, ctx.workspaceId, ...args))
}
export function updateGroup(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiUpdateGroup']>) {
  return apiReply(ApiResults.apiUpdateGroup, ctx.core.apiUpdateGroup(ctx.actor, ctx.workspaceId, ...args))
}
export function deleteGroup(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiDeleteGroup']>) {
  return apiReply(ApiResults.apiDeleteGroup, ctx.core.apiDeleteGroup(ctx.actor, ctx.workspaceId, ...args))
}
export function addGroupMember(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiAddGroupMember']>) {
  return apiReply(ApiResults.apiAddGroupMember, ctx.core.apiAddGroupMember(ctx.actor, ctx.workspaceId, ...args))
}
export function removeGroupMember(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiRemoveGroupMember']>) {
  return apiReply(ApiResults.apiRemoveGroupMember, ctx.core.apiRemoveGroupMember(ctx.actor, ctx.workspaceId, ...args))
}
export function setGroupGrant(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiSetGroupGrant']>) {
  return apiReply(ApiResults.apiSetGroupGrant, ctx.core.apiSetGroupGrant(ctx.actor, ctx.workspaceId, ...args))
}
export function removeGroupGrant(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiRemoveGroupGrant']>) {
  return apiReply(ApiResults.apiRemoveGroupGrant, ctx.core.apiRemoveGroupGrant(ctx.actor, ctx.workspaceId, ...args))
}
