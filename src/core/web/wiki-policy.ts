import { and, sql } from 'drizzle-orm'
import { Array, Predicate, Effect } from 'effect'

import { ApiError, ScopeError } from '#contracts/errors.ts'
import { HTTP_NOT_FOUND } from '#contracts/http-status.ts'
import { JSON_NULL } from '#contracts/json-null.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { SECONDS_PER_DAY, currentEpochSeconds } from '#contracts/time.ts'
import { listProjects } from '#services/projects.ts'
import * as wikiData from '#services/wiki.ts'

import { authorizeDataEntity, dataError, requireDataWorkspace, visibleProjectPredicate } from './data-context.ts'

type FirstParameter<Parameters> = Parameters extends [infer First, ...unknown[]] ? First : never

type WikiDatabase = FirstParameter<Parameters<typeof wikiData.findWikiPage>>
type WikiPage = NonNullable<Effect.Success<ReturnType<typeof wikiData.findWikiPage>>>
type WikiScope = FirstParameter<Parameters<typeof requireDataWorkspace>>
type WikiWorkspace = ReturnType<typeof requireDataWorkspace>

interface AuthorizedWikiPage {
  db: WikiDatabase
  workspace: WikiWorkspace
  page: WikiPage
}

type BrowserPageFreshness =
  | { state: 'fresh'; staleSince: null }
  | { state: 'stale'; staleSince: number | null }
  | { state: 'unverified'; staleSince: null }

const requireVisibleWikiProject = function requireVisibleWikiProject(
  db: WikiDatabase,
  workspaceId: string,
  visibility: ReturnType<typeof and>,
): Effect.Effect<void, ApiError | ScopeError> {
  return Effect.gen(function* () {
    const projects = yield* listProjects(db, workspaceId, { includeArchived: true, visibility }).pipe(
      Effect.mapError(dataError),
    )
    if (Array.isArrayEmpty(projects)) {
      yield* new ScopeError(HTTP_NOT_FOUND, 'Selected project is not accessible.')
    }
  })
}

/**
 * Apply the same workspace and grant policy to Wiki reads in SSR and server functions.
 *
 * @param {D1Database} db Database used for the page and project lookups.
 * @param {RequestScope} scope Authenticated browser scope for the current request.
 * @param {string} ref Page reference in the selected workspace.
 * @returns {Effect.Effect<AuthorizedWikiPage, ApiError | ScopeError>} An effect that yields the database, workspace and page after authorization.
 */
export const readAuthorizedWikiPage = function readAuthorizedWikiPage(
  db: WikiDatabase,
  scope: WikiScope,
  ref: string,
): Effect.Effect<AuthorizedWikiPage, ApiError | ScopeError> {
  return Effect.gen(function* () {
    const workspace = yield* Effect.try({
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
      try: () => requireDataWorkspace(scope),
    })
    const page = yield* wikiData.findWikiPage(db, workspace.id, ref).pipe(Effect.mapError(dataError))
    if (!page) {
      return yield* new ApiError('http', HTTP_NOT_FOUND, 'Wiki page not found.')
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
      yield* requireVisibleWikiProject(db, workspace.id, visibility)
    } else {
      yield* Effect.try({
        catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
        try: () => authorizeDataEntity(scope, workspace.id, { ...page, projectId: page.project_id }),
      })
    }
    return fieldsInOrder([
      ['db', db],
      ['workspace', workspace],
      ['page', page],
    ])
  })
}

export const pageFreshness = function pageFreshness(
  page: { verified_at: number | null; verify_interval: number | null; status: string | null },
  now = currentEpochSeconds(),
): BrowserPageFreshness | null {
  const due =
    Predicate.isNotNullish(page.verified_at) && Predicate.isNotNullish(page.verify_interval)
      ? page.verified_at + page.verify_interval * SECONDS_PER_DAY
      : undefined
  if (Predicate.isNullish(page.status) && Predicate.isNullish(page.verify_interval)) {
    return JSON_NULL
  }
  if (page.status === 'stale' || page.status === 'deprecated') {
    return fieldsInOrder([
      ['state', 'stale'],
      ['staleSince', Predicate.isNotNullish(due) && due <= now ? due : JSON_NULL],
    ])
  }
  if (Predicate.isNotNullish(page.verify_interval) && Predicate.isNullish(page.verified_at)) {
    return fieldsInOrder([
      ['state', 'unverified'],
      ['staleSince', JSON_NULL],
    ])
  }
  return Predicate.isNotNullish(due) && due <= now
    ? fieldsInOrder([
        ['state', 'stale'],
        ['staleSince', due],
      ])
    : fieldsInOrder([
        ['state', 'fresh'],
        ['staleSince', JSON_NULL],
      ])
}
