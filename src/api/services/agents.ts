import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const registerAgent = async function registerAgent(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRegisterAgent']>
): Promise<typeof ApiResults.apiRegisterAgent.Type> {
  return apiReply(ApiResults.apiRegisterAgent, ctx.core.apiRegisterAgent(ctx.actor, ctx.workspaceId, ...args))
}
export const startWork = async function startWork(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiStartWork']>
): Promise<typeof ApiResults.apiStartWork.Type> {
  return apiReply(ApiResults.apiStartWork, ctx.core.apiStartWork(ctx.actor, ctx.workspaceId, ...args))
}
export const heartbeatAgent = async function heartbeatAgent(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiHeartbeatAgent']>
): Promise<typeof ApiResults.apiHeartbeatAgent.Type> {
  return apiReply(ApiResults.apiHeartbeatAgent, ctx.core.apiHeartbeatAgent(ctx.actor, ctx.workspaceId, ...args))
}
export const endAgent = async function endAgent(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiEndAgent']>
): Promise<typeof ApiResults.apiEndAgent.Type> {
  return apiReply(ApiResults.apiEndAgent, ctx.core.apiEndAgent(ctx.actor, ctx.workspaceId, ...args))
}
export const finishWork = async function finishWork(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiFinishWork']>
): Promise<typeof ApiResults.apiFinishWork.Type> {
  return apiReply(ApiResults.apiFinishWork, ctx.core.apiFinishWork(ctx.actor, ctx.workspaceId, ...args))
}
export const listActiveAgents = async function listActiveAgents(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListActiveAgents']>
): Promise<typeof ApiResults.apiListActiveAgents.Type> {
  return apiReply(ApiResults.apiListActiveAgents, ctx.core.apiListActiveAgents(ctx.actor, ctx.workspaceId, ...args))
}
