import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const createShareToken = function createShareToken(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateShareToken']>
) {
  return apiReply(ApiResults.apiCreateShareToken, ctx.core.apiCreateShareToken(ctx.actor, ctx.workspaceId, ...args))
}
export const revokeShareToken = function revokeShareToken(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRevokeShareToken']>
): Promise<void> {
  return apiReply(ApiResults.apiRevokeShareToken, ctx.core.apiRevokeShareToken(ctx.actor, ctx.workspaceId, ...args))
}
