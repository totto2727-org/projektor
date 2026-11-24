import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listIssues = function listIssues(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListIssues']>
) {
  return apiReply(ApiResults.apiListIssues, ctx.core.apiListIssues(ctx.actor, ctx.workspaceId, ...args))
}
export const resolveIssueIdParam = function resolveIssueIdParam(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiResolveIssueIdParam']>
): Promise<string> {
  return apiReply(
    ApiResults.apiResolveIssueIdParam,
    ctx.core.apiResolveIssueIdParam(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const getIssue = function getIssue(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetIssue']>) {
  return apiReply(ApiResults.apiGetIssue, ctx.core.apiGetIssue(ctx.actor, ctx.workspaceId, ...args))
}
export const getIssuesBatch = function getIssuesBatch(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetIssuesBatch']>
) {
  return apiReply(ApiResults.apiGetIssuesBatch, ctx.core.apiGetIssuesBatch(ctx.actor, ctx.workspaceId, ...args))
}
export const createIssue = function createIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateIssue']>
) {
  return apiReply(ApiResults.apiCreateIssue, ctx.core.apiCreateIssue(ctx.actor, ctx.workspaceId, ...args))
}
export const updateIssue = function updateIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateIssue']>
) {
  return apiReply(ApiResults.apiUpdateIssue, ctx.core.apiUpdateIssue(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteIssue = function deleteIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteIssue']>
) {
  return apiReply(ApiResults.apiDeleteIssue, ctx.core.apiDeleteIssue(ctx.actor, ctx.workspaceId, ...args))
}
export const getPrioritizedIssues = function getPrioritizedIssues(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetPrioritizedIssues']>
) {
  return apiReply(
    ApiResults.apiGetPrioritizedIssues,
    ctx.core.apiGetPrioritizedIssues(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const searchIssues = function searchIssues(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiSearchIssues']>
) {
  return apiReply(ApiResults.apiSearchIssues, ctx.core.apiSearchIssues(ctx.actor, ctx.workspaceId, ...args))
}
