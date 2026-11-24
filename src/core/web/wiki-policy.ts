import { and, sql } from 'drizzle-orm'
import { Array as EffectArray, Predicate, Effect } from 'effect'

import { ApiError, ScopeError } from '#contracts/errors.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import { listProjects } from '#services/projects.ts'
import * as wikiData from '#services/wiki.ts'

import { authorizeDataEntity, dataError, requireDataWorkspace, visibleProjectPredicate } from './data-context.ts'
import type { RequestScope } from './scope.ts'

/** An existing archived page follows the same workspace/grant policy in SSR and ServerFns. */
export const readAuthorizedWikiPage = function readAuthorizedWikiPage(
  db: CoreEnvironment['DB'],
  scope: RequestScope,
  ref: string,
) {
  return Effect.gen(function* () {
    const workspace = yield* Effect.try({
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
      try: () => requireDataWorkspace(scope),
    })
    const page = yield* wikiData.findWikiPage(db, workspace.id, ref).pipe(Effect.mapError(dataError))
    if (!page) {
      return yield* new ApiError('http', 404, 'Wiki page not found.')
    }
    if (
      Predicate.isNotNullish(page.project_id) &&
      !scope.projects.some((project) => project.id === page.project_id && project.workspace_id === workspace.id)
    ) {
      const visibility = yield* Effect.try({
        catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
        try: () =>
          and(sql`projects.id = ${page.project_id}`, visibleProjectPredicate(scope, workspace.id, sql`projects.id`)),
      })
      const projects = yield* listProjects(db, workspace.id, { includeArchived: true, visibility }).pipe(
        Effect.mapError(dataError),
      )
      if (EffectArray.isArrayEmpty(projects)) {
        return yield* new ScopeError(404, 'Selected project is not accessible.')
      }
    } else {
      yield* Effect.try({
        catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
        try: () => authorizeDataEntity(scope, workspace.id, { ...page, projectId: page.project_id }),
      })
    }
    return { db, workspace, page }
  })
}

export const pageFreshness = function pageFreshness(
  page: { verified_at: number | null; verify_interval: number | null; status: string | null },
  now = Math.floor(Date.now() / 1000),
) {
  const due =
    Predicate.isNotNullish(page.verified_at) && Predicate.isNotNullish(page.verify_interval)
      ? page.verified_at + page.verify_interval * 86_400
      : null
  if (Predicate.isNullish(page.status) && Predicate.isNullish(page.verify_interval)) {
    return null
  }
  if (page.status === 'stale' || page.status === 'deprecated') {
    return { state: 'stale' as const, staleSince: Predicate.isNotNullish(due) && due <= now ? due : null }
  }
  if (Predicate.isNotNullish(page.verify_interval) && Predicate.isNullish(page.verified_at)) {
    return { state: 'unverified' as const, staleSince: null }
  }
  return Predicate.isNotNullish(due) && due <= now
    ? { state: 'stale' as const, staleSince: due }
    : { state: 'fresh' as const, staleSince: null }
}
