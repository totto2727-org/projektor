import { ApiResults } from '../../contracts/api-results.ts'
import type { CoreRpcShape } from '../../core/contract.ts'
import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export function postMessage(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiPostMessage']>) {
  return apiReply(ApiResults.apiPostMessage, ctx.core.apiPostMessage(ctx.actor, ctx.workspaceId, ...args))
}
export function listMessages(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListMessages']>) {
  return apiReply(ApiResults.apiListMessages, ctx.core.apiListMessages(ctx.actor, ctx.workspaceId, ...args))
}
