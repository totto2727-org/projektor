import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function registerAgent(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiRegisterAgent']>) {
  return apiReply(ApiResults.apiRegisterAgent, ctx.core.apiRegisterAgent(ctx.actor, ctx.workspaceId, ...args))
}
export function startWork(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiStartWork']>) {
  return apiReply(ApiResults.apiStartWork, ctx.core.apiStartWork(ctx.actor, ctx.workspaceId, ...args))
}
export function heartbeatAgent(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiHeartbeatAgent']>) {
  return apiReply(ApiResults.apiHeartbeatAgent, ctx.core.apiHeartbeatAgent(ctx.actor, ctx.workspaceId, ...args))
}
export function endAgent(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiEndAgent']>) {
  return apiReply(ApiResults.apiEndAgent, ctx.core.apiEndAgent(ctx.actor, ctx.workspaceId, ...args))
}
export function finishWork(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiFinishWork']>) {
  return apiReply(ApiResults.apiFinishWork, ctx.core.apiFinishWork(ctx.actor, ctx.workspaceId, ...args))
}
export function listActiveAgents(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListActiveAgents']>) {
  return apiReply(ApiResults.apiListActiveAgents, ctx.core.apiListActiveAgents(ctx.actor, ctx.workspaceId, ...args))
}
