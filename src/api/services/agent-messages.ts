import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const postMessage = async function postMessage(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiPostMessage']>
): Promise<typeof ApiResults.apiPostMessage.Type> {
  return apiReply(ApiResults.apiPostMessage, ctx.core.apiPostMessage(ctx.actor, ctx.workspaceId, ...args))
}
export const listMessages = async function listMessages(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListMessages']>
): Promise<typeof ApiResults.apiListMessages.Type> {
  return apiReply(ApiResults.apiListMessages, ctx.core.apiListMessages(ctx.actor, ctx.workspaceId, ...args))
}
