import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listTaskTypes = async function listTaskTypes(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListTaskTypes']>
): Promise<typeof ApiResults.apiListTaskTypes.Type> {
  return apiReply(ApiResults.apiListTaskTypes, ctx.core.apiListTaskTypes(ctx.actor, ctx.workspaceId, ...args))
}
export const createTaskType = async function createTaskType(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateTaskType']>
): Promise<typeof ApiResults.apiCreateTaskType.Type> {
  return apiReply(ApiResults.apiCreateTaskType, ctx.core.apiCreateTaskType(ctx.actor, ctx.workspaceId, ...args))
}
export const updateTaskType = async function updateTaskType(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateTaskType']>
): Promise<typeof ApiResults.apiUpdateTaskType.Type> {
  return apiReply(ApiResults.apiUpdateTaskType, ctx.core.apiUpdateTaskType(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteTaskType = async function deleteTaskType(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteTaskType']>
): Promise<typeof ApiResults.apiDeleteTaskType.Type> {
  return apiReply(ApiResults.apiDeleteTaskType, ctx.core.apiDeleteTaskType(ctx.actor, ctx.workspaceId, ...args))
}
