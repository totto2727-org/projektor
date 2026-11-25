import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listWorkspaces = async function listWorkspaces(
  ctx: ApiServiceCtx,
): Promise<typeof ApiResults.apiListWorkspaces.Type> {
  return apiReply(ApiResults.apiListWorkspaces, ctx.core.apiListWorkspaces(ctx.actor))
}
export const createWorkspace = async function createWorkspace(
  ctx: ApiServiceCtx,
  input: unknown,
): Promise<typeof ApiResults.apiCreateWorkspace.Type> {
  return apiReply(ApiResults.apiCreateWorkspace, ctx.core.apiCreateWorkspace(ctx.actor, input))
}
export const getWorkspaceWithMembers = async function getWorkspaceWithMembers(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWorkspaceWithMembers']>
): Promise<typeof ApiResults.apiGetWorkspaceWithMembers.Type> {
  return apiReply(
    ApiResults.apiGetWorkspaceWithMembers,
    ctx.core.apiGetWorkspaceWithMembers(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const updateWorkspace = async function updateWorkspace(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateWorkspace']>
): Promise<typeof ApiResults.apiUpdateWorkspace.Type> {
  return apiReply(ApiResults.apiUpdateWorkspace, ctx.core.apiUpdateWorkspace(ctx.actor, ctx.workspaceId, ...args))
}
export const inviteMember = async function inviteMember(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiInviteMember']>
): Promise<typeof ApiResults.apiInviteMember.Type> {
  return apiReply(ApiResults.apiInviteMember, ctx.core.apiInviteMember(ctx.actor, ctx.workspaceId, ...args))
}
export const removeMember = async function removeMember(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRemoveMember']>
): Promise<typeof ApiResults.apiRemoveMember.Type> {
  return apiReply(ApiResults.apiRemoveMember, ctx.core.apiRemoveMember(ctx.actor, ctx.workspaceId, ...args))
}
export const updateMemberRole = async function updateMemberRole(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateMemberRole']>
): Promise<typeof ApiResults.apiUpdateMemberRole.Type> {
  return apiReply(ApiResults.apiUpdateMemberRole, ctx.core.apiUpdateMemberRole(ctx.actor, ctx.workspaceId, ...args))
}
export const createToken = async function createToken(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateToken']>
): Promise<typeof ApiResults.apiCreateToken.Type> {
  return apiReply(ApiResults.apiCreateToken, ctx.core.apiCreateToken(ctx.actor, ctx.workspaceId, ...args))
}
export const revokeToken = async function revokeToken(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRevokeToken']>
): Promise<typeof ApiResults.apiRevokeToken.Type> {
  return apiReply(ApiResults.apiRevokeToken, ctx.core.apiRevokeToken(ctx.actor, ctx.workspaceId, ...args))
}
export const listTokens = async function listTokens(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListTokens']>
): Promise<typeof ApiResults.apiListTokens.Type> {
  return apiReply(ApiResults.apiListTokens, ctx.core.apiListTokens(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteWorkspace = async function deleteWorkspace(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteWorkspace']>
): Promise<typeof ApiResults.apiDeleteWorkspace.Type> {
  return apiReply(ApiResults.apiDeleteWorkspace, ctx.core.apiDeleteWorkspace(ctx.actor, ctx.workspaceId, ...args))
}
export const getWorkspaceMcpInfo = async function getWorkspaceMcpInfo(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWorkspaceMcpInfo']>
): Promise<typeof ApiResults.apiGetWorkspaceMcpInfo.Type> {
  return apiReply(
    ApiResults.apiGetWorkspaceMcpInfo,
    ctx.core.apiGetWorkspaceMcpInfo(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const getWorkspaceBrand = async function getWorkspaceBrand(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetWorkspaceBrand']>
): Promise<typeof ApiResults.apiGetWorkspaceBrand.Type> {
  return apiReply(ApiResults.apiGetWorkspaceBrand, ctx.core.apiGetWorkspaceBrand(ctx.actor, ctx.workspaceId, ...args))
}
export const updateWorkspaceBrand = async function updateWorkspaceBrand(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateWorkspaceBrand']>
): Promise<typeof ApiResults.apiUpdateWorkspaceBrand.Type> {
  return apiReply(
    ApiResults.apiUpdateWorkspaceBrand,
    ctx.core.apiUpdateWorkspaceBrand(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const deleteWorkspaceLogo = async function deleteWorkspaceLogo(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteWorkspaceLogo']>
): Promise<typeof ApiResults.apiDeleteWorkspaceLogo.Type> {
  return apiReply(
    ApiResults.apiDeleteWorkspaceLogo,
    ctx.core.apiDeleteWorkspaceLogo(ctx.actor, ctx.workspaceId, ...args),
  )
}
