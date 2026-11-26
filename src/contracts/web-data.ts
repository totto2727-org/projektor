import { Predicate } from 'effect'

import { HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_INTERNAL_SERVER_ERROR } from '#contracts/http-status.ts'
import type { AuthSession, ProjectSummary, RequestScope, WorkspaceMembership } from '#core/web/scope.ts'

import { ApiError, ScopeError } from './errors.ts'

export const requireBrowserDataRequest = function requireBrowserDataRequest(request: Request): void {
  if (request.headers.has('authorization')) {
    throw new ScopeError(HTTP_FORBIDDEN, 'An interactive browser session is required.')
  }
}

export const requireAuthenticatedDataSession = function requireAuthenticatedDataSession(session: AuthSession): void {
  if (session.user.email === 'public-viewer@projektor.local') {
    throw new ScopeError(HTTP_FORBIDDEN, 'An interactive browser session is required.')
  }
}

/**
 * Keep driver SQL, bindings and authentication diagnostics on the server.
 *
 * @param {unknown} cause The failure raised while loading page data.
 * @returns {ApiError} The existing API error or a generic request error with the original cause for server diagnostics.
 */
export const dataError = function dataError(cause: unknown): ApiError {
  if (cause instanceof ApiError) {
    return cause
  }
  return new ApiError('request', HTTP_INTERNAL_SERVER_ERROR, 'Unable to load project data.', cause)
}

/**
 * Check the selected or explicitly requested workspace against the authenticated scope before storage access.
 * Core revalidates membership for the operation.
 *
 * @param {RequestScope} scope The session, workspace memberships and current presentation selection.
 * @param {string} [workspaceId] The requested workspace when the caller overrides the current selection.
 * @returns {WorkspaceMembership} The matching membership from the authenticated scope.
 */
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
    throw new ScopeError(HTTP_FORBIDDEN, 'Selected workspace is not accessible.')
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
    throw new ScopeError(HTTP_NOT_FOUND, 'Selected project is not accessible.')
  }
  return project
}

export const authorizeDataEntity = function authorizeDataEntity<T extends Readonly<{ projectId: string | null }>>(
  scope: RequestScope,
  workspaceId: string,
  entity: T | undefined,
): T {
  if (!entity) {
    throw new ScopeError(HTTP_NOT_FOUND, 'Not found.')
  }
  requireDataWorkspace(scope, workspaceId)
  if (Predicate.isNotNullish(entity.projectId)) {
    requireDataProject(scope, entity.projectId, workspaceId)
  }
  return entity
}
