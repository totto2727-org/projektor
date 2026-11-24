import { and, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { listProjects } from '#services/projects.ts'
import * as wikiData from '#services/wiki.ts'

import { ApiError, ScopeError } from '../../contracts/errors.ts'
import type { CoreEnvironment } from '../environment.ts'
import { authorizeDataEntity, dataError, requireDataWorkspace, visibleProjectPredicate } from './data-context.ts'
import type { RequestScope } from './scope.ts'

/** An existing archived page follows the same workspace/grant policy in SSR and ServerFns. */
export function readAuthorizedWikiPage(db: CoreEnvironment['DB'], scope: RequestScope, ref: string) {
  return Effect.gen(function* () {
    const workspace = yield* Effect.try({
      try: () => requireDataWorkspace(scope),
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
    })
    const page = yield* wikiData.findWikiPage(db, workspace.id, ref).pipe(Effect.mapError(dataError))
    if (!page) {
      return yield* new ApiError('http', 404, 'Wiki page not found.')
    }
    if (
      page.project_id !== null &&
      !scope.projects.some((project) => project.id === page.project_id && project.workspace_id === workspace.id)
    ) {
      const visibility = yield* Effect.try({
        try: () =>
          and(sql`projects.id = ${page.project_id}`, visibleProjectPredicate(scope, workspace.id, sql`projects.id`)),
        catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
      })
      const projects = yield* listProjects(db, workspace.id, { includeArchived: true, visibility }).pipe(
        Effect.mapError(dataError),
      )
      if (projects.length === 0) {
        return yield* new ScopeError(404, 'Selected project is not accessible.')
      }
    } else {
      yield* Effect.try({
        try: () => authorizeDataEntity(scope, workspace.id, { ...page, projectId: page.project_id }),
        catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
      })
    }
    return { db, workspace, page }
  })
}

export function pageFreshness(
  page: { verified_at: number | null; verify_interval: number | null; status: string | null },
  now = Math.floor(Date.now() / 1000),
) {
  const due =
    page.verified_at !== null && page.verify_interval !== null ? page.verified_at + page.verify_interval * 86_400 : null
  if (page.status === null && page.verify_interval === null) {
    return null
  }
  if (page.status === 'stale' || page.status === 'deprecated') {
    return { state: 'stale' as const, staleSince: due !== null && due <= now ? due : null }
  }
  if (page.verify_interval !== null && page.verified_at === null) {
    return { state: 'unverified' as const, staleSince: null }
  }
  return due !== null && due <= now
    ? { state: 'stale' as const, staleSince: due }
    : { state: 'fresh' as const, staleSince: null }
}
