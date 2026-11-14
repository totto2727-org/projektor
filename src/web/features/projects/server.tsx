import { Effect } from 'effect'
import type { ReactNode } from 'react'

import { browserRequest, coreResult } from '../../core'
import { type Env, RequestServices } from '../../request'
import type { RequestScope } from '../../server'
import {
  dataError,
  requireAuthenticatedDataSession,
  requireDataProject,
  requireDataWorkspace,
} from '../../server/data-context'
import { type ApiError, ScopeError } from '../../server/errors'
import { HelpPage } from '../help/HelpPage'
import { ProjectLanding } from './ProjectLanding'
import { ProjectList } from './ProjectList'
import { ProjectOverviewSchema, ProjectSummariesSchema } from './schemas'

export function renderProjects(
  scope: RequestScope,
  url: URL,
): Effect.Effect<ReactNode, ApiError | ScopeError, RequestServices> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    yield* Effect.try({
      try: () => requireAuthenticatedDataSession(scope),
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
    })
    const showArchived = url.searchParams.get('includeArchived') === 'true'
    const projects = showArchived
      ? yield* coreResult(
          ProjectSummariesSchema,
          services.core.webProjectCatalog(browserRequest(services.request), true),
        )
      : scope.projects
    return <ProjectList initialProjects={projects} memberships={scope.workspaces} showArchived={showArchived} />
  })
}

export function renderOverview(
  scope: RequestScope,
  _url: URL,
): Effect.Effect<ReactNode, ApiError | ScopeError, RequestServices> {
  if (scope.selection.kind !== 'project')
    return Effect.succeed(<p className='text-text-muted'>No project specified.</p>)
  const { project: selected, workspace } = scope.selection
  return Effect.gen(function* () {
    const services = yield* RequestServices
    yield* Effect.try({
      try: () => {
        requireDataWorkspace(scope, workspace.id)
        requireDataProject(scope, selected.id, workspace.id)
      },
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
    })
    const value = yield* coreResult(
      ProjectOverviewSchema,
      services.core.webProjectOverview(browserRequest(services.request), workspace.id, selected.id),
    )
    return (
      <ProjectLanding
        initialProject={value.project}
        initialIssues={value.issues}
        initialWiki={value.wiki}
        initialFlow={value.flow}
        workspaceSlug={workspace.slug}
        canEdit={workspace.role === 'owner' || workspace.role === 'admin' || workspace.role === 'member'}
      />
    )
  })
}

export function renderHelp(_env: Env, _scope: null, _url: URL): Effect.Effect<ReactNode, never> {
  return Effect.succeed(<HelpPage />)
}
