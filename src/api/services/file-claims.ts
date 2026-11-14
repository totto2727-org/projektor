import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function claimFiles(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiClaimFiles']>) {
  return apiReply(ApiResults.apiClaimFiles, ctx.core.apiClaimFiles(ctx.actor, ctx.workspaceId, ...args))
}
export function releaseFiles(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiReleaseFiles']>) {
  return apiReply(ApiResults.apiReleaseFiles, ctx.core.apiReleaseFiles(ctx.actor, ctx.workspaceId, ...args))
}
export function listFileClaims(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListFileClaims']>) {
  return apiReply(ApiResults.apiListFileClaims, ctx.core.apiListFileClaims(ctx.actor, ctx.workspaceId, ...args))
}
