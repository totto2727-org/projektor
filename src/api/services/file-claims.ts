import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const claimFiles = async function claimFiles(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiClaimFiles']>
): Promise<typeof ApiResults.apiClaimFiles.Type> {
  return apiReply(ApiResults.apiClaimFiles, ctx.core.apiClaimFiles(ctx.actor, ctx.workspaceId, ...args))
}
export const releaseFiles = async function releaseFiles(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiReleaseFiles']>
): Promise<typeof ApiResults.apiReleaseFiles.Type> {
  return apiReply(ApiResults.apiReleaseFiles, ctx.core.apiReleaseFiles(ctx.actor, ctx.workspaceId, ...args))
}
export const listFileClaims = async function listFileClaims(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListFileClaims']>
): Promise<typeof ApiResults.apiListFileClaims.Type> {
  return apiReply(ApiResults.apiListFileClaims, ctx.core.apiListFileClaims(ctx.actor, ctx.workspaceId, ...args))
}
