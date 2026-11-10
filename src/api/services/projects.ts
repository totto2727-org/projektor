import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listProjects(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListProjectsInWorkspace']>
) {
  return apiReply(
    ApiResults.apiListProjectsInWorkspace,
    ctx.core.apiListProjectsInWorkspace(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function listProjectsAcrossWorkspaces(ctx: ApiServiceCtx, includeArchived = false) {
  return apiReply(ApiResults.apiListProjects, ctx.core.apiListProjects(ctx.actor, includeArchived))
}
export function getProject(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetProject']>) {
  return apiReply(ApiResults.apiGetProject, ctx.core.apiGetProject(ctx.actor, ctx.workspaceId, ...args))
}
export function getProjectBySlug(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetProjectBySlug']>) {
  return apiReply(ApiResults.apiGetProjectBySlug, ctx.core.apiGetProjectBySlug(ctx.actor, ctx.workspaceId, ...args))
}
export function createProject(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiCreateProject']>) {
  return apiReply(ApiResults.apiCreateProject, ctx.core.apiCreateProject(ctx.actor, ctx.workspaceId, ...args))
}
export function updateProject(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiUpdateProject']>) {
  return apiReply(ApiResults.apiUpdateProject, ctx.core.apiUpdateProject(ctx.actor, ctx.workspaceId, ...args))
}
export function deleteProject(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiDeleteProject']>) {
  return apiReply(ApiResults.apiDeleteProject, ctx.core.apiDeleteProject(ctx.actor, ctx.workspaceId, ...args))
}
