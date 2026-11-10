import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listTaskTypes(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListTaskTypes']>) {
  return apiReply(ApiResults.apiListTaskTypes, ctx.core.apiListTaskTypes(ctx.actor, ctx.workspaceId, ...args))
}
export function createTaskType(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiCreateTaskType']>) {
  return apiReply(ApiResults.apiCreateTaskType, ctx.core.apiCreateTaskType(ctx.actor, ctx.workspaceId, ...args))
}
export function updateTaskType(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiUpdateTaskType']>) {
  return apiReply(ApiResults.apiUpdateTaskType, ctx.core.apiUpdateTaskType(ctx.actor, ctx.workspaceId, ...args))
}
export function deleteTaskType(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiDeleteTaskType']>) {
  return apiReply(ApiResults.apiDeleteTaskType, ctx.core.apiDeleteTaskType(ctx.actor, ctx.workspaceId, ...args))
}
