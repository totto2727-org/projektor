import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function claimIssue(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiClaimIssue']>) {
  return apiReply(ApiResults.apiClaimIssue, ctx.core.apiClaimIssue(ctx.actor, ctx.workspaceId, ...args))
}
export function releaseIssue(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiReleaseIssue']>) {
  return apiReply(ApiResults.apiReleaseIssue, ctx.core.apiReleaseIssue(ctx.actor, ctx.workspaceId, ...args))
}
export function listIssueLeases(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListIssueLeases']>) {
  return apiReply(ApiResults.apiListIssueLeases, ctx.core.apiListIssueLeases(ctx.actor, ctx.workspaceId, ...args))
}
