import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listWorkspaces(ctx: ApiServiceCtx) {
  return apiReply(ApiResults.apiListWorkspaces, ctx.core.apiListWorkspaces(ctx.actor))
}
export function createWorkspace(ctx: ApiServiceCtx, input: unknown) {
  return apiReply(ApiResults.apiCreateWorkspace, ctx.core.apiCreateWorkspace(ctx.actor, input))
}
export function getWorkspaceWithMembers(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWorkspaceWithMembers']>
) {
  return apiReply(
    ApiResults.apiGetWorkspaceWithMembers,
    ctx.core.apiGetWorkspaceWithMembers(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function updateWorkspace(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiUpdateWorkspace']>) {
  return apiReply(ApiResults.apiUpdateWorkspace, ctx.core.apiUpdateWorkspace(ctx.actor, ctx.workspaceId, ...args))
}
export function inviteMember(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiInviteMember']>) {
  return apiReply(ApiResults.apiInviteMember, ctx.core.apiInviteMember(ctx.actor, ctx.workspaceId, ...args))
}
export function removeMember(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiRemoveMember']>) {
  return apiReply(ApiResults.apiRemoveMember, ctx.core.apiRemoveMember(ctx.actor, ctx.workspaceId, ...args))
}
export function updateMemberRole(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiUpdateMemberRole']>) {
  return apiReply(ApiResults.apiUpdateMemberRole, ctx.core.apiUpdateMemberRole(ctx.actor, ctx.workspaceId, ...args))
}
export function listTokens(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListTokens']>) {
  return apiReply(ApiResults.apiListTokens, ctx.core.apiListTokens(ctx.actor, ctx.workspaceId, ...args))
}
export function deleteWorkspace(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiDeleteWorkspace']>) {
  return apiReply(ApiResults.apiDeleteWorkspace, ctx.core.apiDeleteWorkspace(ctx.actor, ctx.workspaceId, ...args))
}
export function getWorkspaceMcpInfo(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWorkspaceMcpInfo']>
) {
  return apiReply(
    ApiResults.apiGetWorkspaceMcpInfo,
    ctx.core.apiGetWorkspaceMcpInfo(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function getWorkspaceBrand(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetWorkspaceBrand']>) {
  return apiReply(ApiResults.apiGetWorkspaceBrand, ctx.core.apiGetWorkspaceBrand(ctx.actor, ctx.workspaceId, ...args))
}
export function updateWorkspaceBrand(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateWorkspaceBrand']>
) {
  return apiReply(
    ApiResults.apiUpdateWorkspaceBrand,
    ctx.core.apiUpdateWorkspaceBrand(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function deleteWorkspaceLogo(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteWorkspaceLogo']>
) {
  return apiReply(
    ApiResults.apiDeleteWorkspaceLogo,
    ctx.core.apiDeleteWorkspaceLogo(ctx.actor, ctx.workspaceId, ...args),
  )
}
