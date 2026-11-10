import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function createShareToken(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiCreateShareToken']>) {
  return apiReply(ApiResults.apiCreateShareToken, ctx.core.apiCreateShareToken(ctx.actor, ctx.workspaceId, ...args))
}
export function revokeShareToken(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiRevokeShareToken']>) {
  return apiReply(ApiResults.apiRevokeShareToken, ctx.core.apiRevokeShareToken(ctx.actor, ctx.workspaceId, ...args))
}
