import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export function createShareToken(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiCreateShareToken']>) {
  return apiReply(ApiResults.apiCreateShareToken, ctx.core.apiCreateShareToken(ctx.actor, ctx.workspaceId, ...args))
}
export function revokeShareToken(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiRevokeShareToken']>) {
  return apiReply(ApiResults.apiRevokeShareToken, ctx.core.apiRevokeShareToken(ctx.actor, ctx.workspaceId, ...args))
}
