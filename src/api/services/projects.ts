import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listProjects = function listProjects(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListProjectsInWorkspace']>
): Promise<typeof ApiResults.apiListProjectsInWorkspace.Type> {
  return apiReply(
    ApiResults.apiListProjectsInWorkspace,
    ctx.core.apiListProjectsInWorkspace(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const resolveProjectIdParam = function resolveProjectIdParam(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiResolveProjectIdParam']>
): Promise<string> {
  return apiReply(
    ApiResults.apiResolveProjectIdParam,
    ctx.core.apiResolveProjectIdParam(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const resolveVisibleProjectIdParam = function resolveVisibleProjectIdParam(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiResolveVisibleProjectIdParam']>
): Promise<string> {
  return apiReply(
    ApiResults.apiResolveVisibleProjectIdParam,
    ctx.core.apiResolveVisibleProjectIdParam(ctx.actor, ctx.workspaceId, ...args),
  )
}

export const listProjectsAcrossWorkspaces = function listProjectsAcrossWorkspaces(
  ctx: ApiServiceCtx,
  includeArchived = false,
): Promise<typeof ApiResults.apiListProjects.Type> {
  return apiReply(ApiResults.apiListProjects, ctx.core.apiListProjects(ctx.actor, includeArchived))
}
export const getProject = function getProject(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetProject']>
): Promise<typeof ApiResults.apiGetProject.Type> {
  return apiReply(ApiResults.apiGetProject, ctx.core.apiGetProject(ctx.actor, ctx.workspaceId, ...args))
}
export const getProjectBySlug = function getProjectBySlug(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetProjectBySlug']>
): Promise<typeof ApiResults.apiGetProjectBySlug.Type> {
  return apiReply(ApiResults.apiGetProjectBySlug, ctx.core.apiGetProjectBySlug(ctx.actor, ctx.workspaceId, ...args))
}
export const createProject = function createProject(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateProject']>
): Promise<typeof ApiResults.apiCreateProject.Type> {
  return apiReply(ApiResults.apiCreateProject, ctx.core.apiCreateProject(ctx.actor, ctx.workspaceId, ...args))
}
export const updateProject = function updateProject(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateProject']>
): Promise<typeof ApiResults.apiUpdateProject.Type> {
  return apiReply(ApiResults.apiUpdateProject, ctx.core.apiUpdateProject(ctx.actor, ctx.workspaceId, ...args))
}
export const deleteProject = function deleteProject(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteProject']>
): Promise<typeof ApiResults.apiDeleteProject.Type> {
  return apiReply(ApiResults.apiDeleteProject, ctx.core.apiDeleteProject(ctx.actor, ctx.workspaceId, ...args))
}
