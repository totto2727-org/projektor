import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listSprints(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListSprints']>) {
  return apiReply(ApiResults.apiListSprints, ctx.core.apiListSprints(ctx.actor, ctx.workspaceId, ...args))
}
export function getSprint(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetSprint']>) {
  return apiReply(ApiResults.apiGetSprint, ctx.core.apiGetSprint(ctx.actor, ctx.workspaceId, ...args))
}
export function createSprint(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiCreateSprint']>) {
  return apiReply(ApiResults.apiCreateSprint, ctx.core.apiCreateSprint(ctx.actor, ctx.workspaceId, ...args))
}
export function updateSprint(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiUpdateSprint']>) {
  return apiReply(ApiResults.apiUpdateSprint, ctx.core.apiUpdateSprint(ctx.actor, ctx.workspaceId, ...args))
}
export function completeSprint(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiCompleteSprint']>) {
  return apiReply(ApiResults.apiCompleteSprint, ctx.core.apiCompleteSprint(ctx.actor, ctx.workspaceId, ...args))
}
export function deleteSprint(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiDeleteSprint']>) {
  return apiReply(ApiResults.apiDeleteSprint, ctx.core.apiDeleteSprint(ctx.actor, ctx.workspaceId, ...args))
}
export function moveIssuesToSprint(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiMoveIssuesToSprint']>
) {
  return apiReply(ApiResults.apiMoveIssuesToSprint, ctx.core.apiMoveIssuesToSprint(ctx.actor, ctx.workspaceId, ...args))
}
