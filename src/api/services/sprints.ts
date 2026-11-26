import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listSprints = async function listSprints(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListSprints']>
): Promise<typeof ApiResults.apiListSprints.Type> {
  return apiReply(ApiResults.apiListSprints, ctx.core.apiListSprints(ctx.actor, ctx.workspaceId, ...args))
}
export const getSprint = async function getSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetSprint']>
): Promise<typeof ApiResults.apiGetSprint.Type> {
  return apiReply(ApiResults.apiGetSprint, ctx.core.apiGetSprint(ctx.actor, ctx.workspaceId, ...args))
}
export const createSprint = async function createSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateSprint']>
): Promise<typeof ApiResults.apiCreateSprint.Type> {
  return apiReply(ApiResults.apiCreateSprint, ctx.core.apiCreateSprint(ctx.actor, ctx.workspaceId, ...args))
}
export const updateSprint = async function updateSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateSprint']>
): Promise<typeof ApiResults.apiUpdateSprint.Type> {
  return apiReply(ApiResults.apiUpdateSprint, ctx.core.apiUpdateSprint(ctx.actor, ctx.workspaceId, ...args))
}
export const completeSprint = async function completeSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCompleteSprint']>
): Promise<typeof ApiResults.apiCompleteSprint.Type> {
  return apiReply(ApiResults.apiCompleteSprint, ctx.core.apiCompleteSprint(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteSprint = async function deleteSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteSprint']>
): Promise<typeof ApiResults.apiDeleteSprint.Type> {
  return apiReply(ApiResults.apiDeleteSprint, ctx.core.apiDeleteSprint(ctx.actor, ctx.workspaceId, ...args))
}
export const moveIssuesToSprint = async function moveIssuesToSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiMoveIssuesToSprint']>
): Promise<typeof ApiResults.apiMoveIssuesToSprint.Type> {
  return apiReply(ApiResults.apiMoveIssuesToSprint, ctx.core.apiMoveIssuesToSprint(ctx.actor, ctx.workspaceId, ...args))
}
