import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const claimIssue = async function claimIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiClaimIssue']>
): Promise<typeof ApiResults.apiClaimIssue.Type> {
  return apiReply(ApiResults.apiClaimIssue, ctx.core.apiClaimIssue(ctx.actor, ctx.workspaceId, ...args))
}
export const releaseIssue = async function releaseIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiReleaseIssue']>
): Promise<typeof ApiResults.apiReleaseIssue.Type> {
  return apiReply(ApiResults.apiReleaseIssue, ctx.core.apiReleaseIssue(ctx.actor, ctx.workspaceId, ...args))
}
export const listIssueLeases = async function listIssueLeases(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListIssueLeases']>
): Promise<typeof ApiResults.apiListIssueLeases.Type> {
  return apiReply(ApiResults.apiListIssueLeases, ctx.core.apiListIssueLeases(ctx.actor, ctx.workspaceId, ...args))
}
