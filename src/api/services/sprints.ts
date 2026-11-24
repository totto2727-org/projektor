import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listSprints = function listSprints(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListSprints']>
) {
  return apiReply(ApiResults.apiListSprints, ctx.core.apiListSprints(ctx.actor, ctx.workspaceId, ...args))
}
export const getSprint = function getSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetSprint']>
) {
  return apiReply(ApiResults.apiGetSprint, ctx.core.apiGetSprint(ctx.actor, ctx.workspaceId, ...args))
}
export const createSprint = function createSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateSprint']>
) {
  return apiReply(ApiResults.apiCreateSprint, ctx.core.apiCreateSprint(ctx.actor, ctx.workspaceId, ...args))
}
export const updateSprint = function updateSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateSprint']>
) {
  return apiReply(ApiResults.apiUpdateSprint, ctx.core.apiUpdateSprint(ctx.actor, ctx.workspaceId, ...args))
}
export const completeSprint = function completeSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCompleteSprint']>
) {
  return apiReply(ApiResults.apiCompleteSprint, ctx.core.apiCompleteSprint(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteSprint = function deleteSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteSprint']>
) {
  return apiReply(ApiResults.apiDeleteSprint, ctx.core.apiDeleteSprint(ctx.actor, ctx.workspaceId, ...args))
}
export const moveIssuesToSprint = function moveIssuesToSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiMoveIssuesToSprint']>
) {
  return apiReply(ApiResults.apiMoveIssuesToSprint, ctx.core.apiMoveIssuesToSprint(ctx.actor, ctx.workspaceId, ...args))
}
