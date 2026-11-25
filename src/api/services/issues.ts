import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listIssues = async function listIssues(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListIssues']>
): Promise<typeof ApiResults.apiListIssues.Type> {
  return apiReply(ApiResults.apiListIssues, ctx.core.apiListIssues(ctx.actor, ctx.workspaceId, ...args))
}
export const resolveIssueIdParam = async function resolveIssueIdParam(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiResolveIssueIdParam']>
): Promise<string> {
  return apiReply(
    ApiResults.apiResolveIssueIdParam,
    ctx.core.apiResolveIssueIdParam(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const getIssue = async function getIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetIssue']>
): Promise<typeof ApiResults.apiGetIssue.Type> {
  return apiReply(ApiResults.apiGetIssue, ctx.core.apiGetIssue(ctx.actor, ctx.workspaceId, ...args))
}
export const getIssuesBatch = async function getIssuesBatch(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetIssuesBatch']>
): Promise<typeof ApiResults.apiGetIssuesBatch.Type> {
  return apiReply(ApiResults.apiGetIssuesBatch, ctx.core.apiGetIssuesBatch(ctx.actor, ctx.workspaceId, ...args))
}
export const createIssue = async function createIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateIssue']>
): Promise<typeof ApiResults.apiCreateIssue.Type> {
  return apiReply(ApiResults.apiCreateIssue, ctx.core.apiCreateIssue(ctx.actor, ctx.workspaceId, ...args))
}
export const updateIssue = async function updateIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateIssue']>
): Promise<typeof ApiResults.apiUpdateIssue.Type> {
  return apiReply(ApiResults.apiUpdateIssue, ctx.core.apiUpdateIssue(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteIssue = async function deleteIssue(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteIssue']>
): Promise<typeof ApiResults.apiDeleteIssue.Type> {
  return apiReply(ApiResults.apiDeleteIssue, ctx.core.apiDeleteIssue(ctx.actor, ctx.workspaceId, ...args))
}
export const getPrioritizedIssues = async function getPrioritizedIssues(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetPrioritizedIssues']>
): Promise<typeof ApiResults.apiGetPrioritizedIssues.Type> {
  return apiReply(
    ApiResults.apiGetPrioritizedIssues,
    ctx.core.apiGetPrioritizedIssues(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const searchIssues = async function searchIssues(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiSearchIssues']>
): Promise<typeof ApiResults.apiSearchIssues.Type> {
  return apiReply(ApiResults.apiSearchIssues, ctx.core.apiSearchIssues(ctx.actor, ctx.workspaceId, ...args))
}
