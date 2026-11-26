import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listTaskStatuses = async function listTaskStatuses(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListTaskStatuses']>
): Promise<typeof ApiResults.apiListTaskStatuses.Type> {
  return apiReply(ApiResults.apiListTaskStatuses, ctx.core.apiListTaskStatuses(ctx.actor, ctx.workspaceId, ...args))
}
export const createTaskStatus = async function createTaskStatus(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateTaskStatus']>
): Promise<typeof ApiResults.apiCreateTaskStatus.Type> {
  return apiReply(ApiResults.apiCreateTaskStatus, ctx.core.apiCreateTaskStatus(ctx.actor, ctx.workspaceId, ...args))
}
export const updateTaskStatus = async function updateTaskStatus(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateTaskStatus']>
): Promise<typeof ApiResults.apiUpdateTaskStatus.Type> {
  return apiReply(ApiResults.apiUpdateTaskStatus, ctx.core.apiUpdateTaskStatus(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteTaskStatus = async function deleteTaskStatus(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteTaskStatus']>
): Promise<typeof ApiResults.apiDeleteTaskStatus.Type> {
  return apiReply(ApiResults.apiDeleteTaskStatus, ctx.core.apiDeleteTaskStatus(ctx.actor, ctx.workspaceId, ...args))
}
