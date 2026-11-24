import { Predicate } from 'effect'

import { HTTP_INTERNAL_SERVER_ERROR } from '#contracts/http-status.ts'
import type { AuthSession, ProjectSummary, RequestScope, WorkspaceMembership } from '#core/web/scope.ts'

import { ApiError, ScopeError } from './errors.ts'

export const requireBrowserDataRequest = function requireBrowserDataRequest(request: Request): void {
  if (request.headers.has('authorization')) {
    throw new ScopeError(403, 'An interactive browser session is required.')
  }
}

export const requireAuthenticatedDataSession = function requireAuthenticatedDataSession(session: AuthSession): void {
  if (session.user.email === 'public-viewer@projektor.local') {
    throw new ScopeError(403, 'An interactive browser session is required.')
  }
}

/** Never expose driver SQL, bindings or authentication diagnostics to page clients. */
export const dataError = function dataError(cause: unknown): ApiError {
  if (cause instanceof ApiError) {
    return cause
  }
  return new ApiError('request', HTTP_INTERNAL_SERVER_ERROR, 'Unable to load project data.', cause)
}

/** Presentation selection is not authority. Core revalidates membership before storage access. */
export const requireDataWorkspace = function requireDataWorkspace(
  scope: RequestScope,
  workspaceId?: string,
): WorkspaceMembership {
  requireAuthenticatedDataSession(scope)
  const selected = scope.selection
  const id =
    workspaceId ?? (selected.kind === 'workspace' || selected.kind === 'project' ? selected.workspace.id : undefined)
  const membership = scope.workspaces.find((workspace) => workspace.id === id)
  if (!membership) {
    throw new ScopeError(403, 'Selected workspace is not accessible.')
  }
  return membership
}

export const requireDataProject = function requireDataProject(
  scope: RequestScope,
  projectId: string,
  workspaceId?: string,
): ProjectSummary {
  requireAuthenticatedDataSession(scope)
  const project = scope.projects.find(
    (candidate) =>
      candidate.id === projectId && (Predicate.isNullish(workspaceId) || candidate.workspace_id === workspaceId),
  )
  const membership =
    project &&
    scope.workspaces.find(
      (workspace) => workspace.id === project.workspace_id && workspace.slug === project.workspace_slug,
    )
  if (!project || !membership) {
    throw new ScopeError(404, 'Selected project is not accessible.')
  }
  return project
}

export const authorizeDataEntity = function authorizeDataEntity<T extends { readonly projectId: string | null }>(
  scope: RequestScope,
  workspaceId: string,
  entity: T | undefined,
): T {
  if (!entity) {
    throw new ScopeError(404, 'Not found.')
  }
  requireDataWorkspace(scope, workspaceId)
  if (Predicate.isNotNullish(entity.projectId)) {
    requireDataProject(scope, entity.projectId, workspaceId)
  }
  return entity
}
