import { String, Predicate, Effect, Schema } from 'effect'

import { getUserWorkspaces } from '#commands/user-tokens.ts'
import { ApiError, ScopeError } from '#contracts/errors.ts'
import { coreFailure } from '#core/contract.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import { authenticateBrowser, BrowserAuthenticationError } from '#services/authentication.ts'
import { listProjectSummaries } from '#services/projects.ts'

import {
  decodeAuthSession,
  decodeProjectCatalog,
  matchesProject,
  queryHint,
  readProjectHint,
  resolveScope,
  selectedWorkspace,
  ScopeOptionsSchema,
  WebRequestSchema,
} from './scope.ts'
import type { WebRequest, ScopeOptions } from './scope.ts'

export const nativeRequest = function nativeRequest(input: WebRequest) {
  return new Request(input.url, { method: input.method, headers: input.headers.map(([name, value]) => [name, value]) })
}

export const publicWebFailure = function publicWebFailure(error: unknown) {
  if (error instanceof ApiError || error instanceof ScopeError) {
    return coreFailure(error.status, error.message)
  }
  if (error instanceof BrowserAuthenticationError) {
    return coreFailure(error.status, error.message)
  }
  return error
}

export const loadBrowserScope = function loadBrowserScope(
  env: CoreEnvironment,
  input: WebRequest,
  options: ScopeOptions = {},
) {
  return Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(WebRequestSchema)(input).pipe(
      Effect.mapError(() => coreFailure(400, 'Invalid browser request.')),
    )
    const selected = yield* Schema.decodeUnknownEffect(ScopeOptionsSchema)(options).pipe(
      Effect.mapError(() => coreFailure(400, 'Invalid scope options.')),
    )
    const request = yield* Effect.try({
      catch: () => coreFailure(400, 'Invalid browser request.'),
      try: () => nativeRequest(decoded),
    })
    if (request.headers.has('authorization')) {
      return yield* coreFailure(403, 'An interactive browser session is required.')
    }
    const principal = yield* Effect.tryPromise({
      catch: publicWebFailure,
      try: () => authenticateBrowser(request, env),
    })
    if (principal.user.email === 'public-viewer@projektor.local') {
      return yield* coreFailure(403, 'An interactive browser session is required.')
    }
    const session = yield* Effect.tryPromise({
      catch: publicWebFailure,
      try: async () =>
        decodeAuthSession({
          user: principal.user,
          workspaces: await getUserWorkspaces({ db: env.DB, userId: principal.user.id }),
        }),
    })
    const visibility = {
      sql: `wm.role IN ('owner','admin') OR EXISTS (SELECT 1 FROM user_group_members ugm JOIN group_project_grants gpg ON gpg.group_id = ugm.group_id WHERE ugm.user_id = ? AND gpg.project_id = p.id)`,
      bindings: [session.user.id],
    }
    const catalog = (archived = false) =>
      listProjectSummaries(env.DB, session.user.id, visibility, archived).pipe(
        Effect.map((rows) =>
          decodeProjectCatalog(rows).filter((project) =>
            session.workspaces.some(
              (workspace) => workspace.id === project.workspace_id && workspace.slug === project.workspace_slug,
            ),
          ),
        ),
      )
    const projects = yield* catalog()
    const url = new URL(request.url)
    const { hint, workspace } = yield* Effect.try({
      catch: publicWebFailure,
      try: () => ({
        hint: selected.projectHint ?? readProjectHint(url),
        workspace: selectedWorkspace(session.workspaces, selected.workspaceHint ?? queryHint(url, 'workspace')),
      }),
    })
    const active = projects.some(
      (project) =>
        Predicate.isNotNullish(hint) &&
        matchesProject(project, hint) &&
        (!workspace || workspace.id === project.workspace_id),
    )
    const visible = Predicate.isNotNullish(hint) && String.isNonEmpty(hint) && !active ? yield* catalog(true) : projects
    const scope = yield* Effect.try({
      catch: publicWebFailure,
      try: () => resolveScope(session, visible, url, selected),
    })
    return { ...scope, auth: principal.auth }
  })
}
