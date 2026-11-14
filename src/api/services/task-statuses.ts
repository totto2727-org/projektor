import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listTaskStatuses(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListTaskStatuses']>) {
  return apiReply(ApiResults.apiListTaskStatuses, ctx.core.apiListTaskStatuses(ctx.actor, ctx.workspaceId, ...args))
}
export function createTaskStatus(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiCreateTaskStatus']>) {
  return apiReply(ApiResults.apiCreateTaskStatus, ctx.core.apiCreateTaskStatus(ctx.actor, ctx.workspaceId, ...args))
}
export function updateTaskStatus(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiUpdateTaskStatus']>) {
  return apiReply(ApiResults.apiUpdateTaskStatus, ctx.core.apiUpdateTaskStatus(ctx.actor, ctx.workspaceId, ...args))
}
export function deleteTaskStatus(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiDeleteTaskStatus']>) {
  return apiReply(ApiResults.apiDeleteTaskStatus, ctx.core.apiDeleteTaskStatus(ctx.actor, ctx.workspaceId, ...args))
}
