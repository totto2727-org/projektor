import { Effect } from 'effect'
import type { ReactNode } from 'react'

import { browserRequest, coreResult } from '../../core.ts'
import { RequestServices } from '../../request.ts'
import type { Env } from '../../request.ts'
import {
  dataError,
  requireAuthenticatedDataSession,
  requireDataProject,
  requireDataWorkspace,
} from '../../server/data-context.ts'
import { ScopeError } from '../../server/errors.ts'
import type { ApiError } from '../../server/errors.ts'
import type { RequestScope } from '../../server/index.ts'
import { HelpPage } from '../help/HelpPage.tsx'
import { ProjectLanding } from './ProjectLanding.tsx'
import { ProjectList } from './ProjectList.tsx'
import { ProjectOverviewSchema, ProjectSummariesSchema } from './schemas.ts'

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
  if (scope.selection.kind !== 'project') {
    return Effect.succeed(<p className='text-text-muted'>No project specified.</p>)
  }
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
