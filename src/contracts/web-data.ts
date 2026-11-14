import type { AuthSession, ProjectSummary, RequestScope, WorkspaceMembership } from '../core/web/scope'
import { ApiError, ScopeError } from './errors'

export function requireBrowserDataRequest(request: Request): void {
  if (request.headers.has('authorization')) throw new ScopeError(403, 'An interactive browser session is required.')
}

export function requireAuthenticatedDataSession(session: AuthSession): void {
  if (session.user.email === 'public-viewer@projektor.local') {
    throw new ScopeError(403, 'An interactive browser session is required.')
  }
}

/** Never expose driver SQL, bindings or authentication diagnostics to page clients. */
export function dataError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause
  return new ApiError('request', 500, 'Unable to load project data.', cause)
}

/** Presentation selection is not authority. Core revalidates membership before storage access. */
export function requireDataWorkspace(scope: RequestScope, workspaceId?: string): WorkspaceMembership {
  requireAuthenticatedDataSession(scope)
  const selected = scope.selection
  const id =
    workspaceId ?? (selected.kind === 'workspace' || selected.kind === 'project' ? selected.workspace.id : undefined)
  const membership = scope.workspaces.find((workspace) => workspace.id === id)
  if (!membership) throw new ScopeError(403, 'Selected workspace is not accessible.')
  return membership
}

export function requireDataProject(scope: RequestScope, projectId: string, workspaceId?: string): ProjectSummary {
  requireAuthenticatedDataSession(scope)
  const project = scope.projects.find(
    (candidate) => candidate.id === projectId && (workspaceId === undefined || candidate.workspace_id === workspaceId),
  )
  const membership =
    project &&
    scope.workspaces.find(
      (workspace) => workspace.id === project.workspace_id && workspace.slug === project.workspace_slug,
    )
  if (!project || !membership) throw new ScopeError(404, 'Selected project is not accessible.')
  return project
}

export function authorizeDataEntity<T extends { readonly projectId: string | null }>(
  scope: RequestScope,
  workspaceId: string,
  entity: T | undefined,
): T {
  if (!entity) throw new ScopeError(404, 'Not found.')
  requireDataWorkspace(scope, workspaceId)
  if (entity.projectId !== null) requireDataProject(scope, entity.projectId, workspaceId)
  return entity
}
