import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function postMessage(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiPostMessage']>) {
  return apiReply(ApiResults.apiPostMessage, ctx.core.apiPostMessage(ctx.actor, ctx.workspaceId, ...args))
}
export function listMessages(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListMessages']>) {
  return apiReply(ApiResults.apiListMessages, ctx.core.apiListMessages(ctx.actor, ctx.workspaceId, ...args))
}
