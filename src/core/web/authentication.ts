import { String, Predicate, Effect, Schema } from 'effect'

import { getUserWorkspaces } from '#commands/user-tokens.ts'
import { ApiError, ScopeError } from '#contracts/errors.ts'
import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN } from '#contracts/http-status.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { coreFailure } from '#core/contract.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import { authenticateBrowser, BrowserAuthenticationError } from '#services/authentication.ts'
import type { BrowserPrincipal } from '#services/authentication.ts'
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
import type { WebRequest, ScopeOptions, ProjectSummary, RequestScope, AuthSession } from './scope.ts'

const decodeWebRequest = Schema.decodeEffect(WebRequestSchema)
const decodeScopeOptions = Schema.decodeEffect(ScopeOptionsSchema)

export const nativeRequest = function nativeRequest(input: WebRequest): Request<unknown, CfProperties> {
  const { url } = input
  const init = fieldsInOrder([
    ['method', input.method],
    ['headers', input.headers.map(([name, value]): [string, string] => [name, value])],
  ])
  return new Request(url, init)
}

export const publicWebFailure = function publicWebFailure(error: unknown): unknown {
  if (error instanceof ApiError || error instanceof ScopeError) {
    return coreFailure(error.status, error.message)
  }
  if (error instanceof BrowserAuthenticationError) {
    return coreFailure(error.status, error.message)
  }
  return error
}

type AuthenticatedRequestScope = Omit<RequestScope, 'auth'> & { auth: BrowserPrincipal['auth'] }
type CatalogError = Effect.Error<ReturnType<typeof listProjectSummaries>>

interface BrowserScopeRequest {
  request: Request<unknown, CfProperties>
  selected: ScopeOptions
}

const validateBrowserScopeRequest = function validateBrowserScopeRequest(
  input: WebRequest,
  options: ScopeOptions,
): Effect.Effect<BrowserScopeRequest, ReturnType<typeof coreFailure>> {
  return Effect.gen(function* () {
    const decoded = yield* decodeWebRequest(input).pipe(
      Effect.mapError(() => coreFailure(HTTP_BAD_REQUEST, 'Invalid browser request.')),
    )
    const selected = yield* decodeScopeOptions(options).pipe(
      Effect.mapError(() => coreFailure(HTTP_BAD_REQUEST, 'Invalid scope options.')),
    )
    const request = yield* Effect.try({
      catch: () => coreFailure(HTTP_BAD_REQUEST, 'Invalid browser request.'),
      try: () => nativeRequest(decoded),
    })
    return { request, selected }
  })
}

interface BrowserIdentity {
  principal: BrowserPrincipal
  session: AuthSession
}

const readBrowserIdentity = function readBrowserIdentity(
  env: CoreEnvironment,
  request: Request<unknown, CfProperties>,
): Effect.Effect<BrowserIdentity, unknown> {
  return Effect.gen(function* () {
    if (request.headers.has('authorization')) {
      return yield* coreFailure(HTTP_FORBIDDEN, 'An interactive browser session is required.')
    }
    const principal = yield* Effect.tryPromise({
      catch: publicWebFailure,
      try: async () => authenticateBrowser(request, env),
    })
    if (principal.user.email === 'public-viewer@projektor.local') {
      return yield* coreFailure(HTTP_FORBIDDEN, 'An interactive browser session is required.')
    }
    const session = yield* Effect.tryPromise({
      catch: publicWebFailure,
      try: async () =>
        decodeAuthSession({
          user: principal.user,
          workspaces: await getUserWorkspaces({ db: env.DB, userId: principal.user.id }),
        }),
    })
    return { principal, session }
  })
}

const withBrowserAuth = function withBrowserAuth(
  scope: RequestScope,
  auth: BrowserPrincipal['auth'],
): AuthenticatedRequestScope {
  return { ...scope, auth }
}

export const loadBrowserScope = function loadBrowserScope(
  env: CoreEnvironment,
  input: WebRequest,
  options: ScopeOptions = {},
): Effect.Effect<AuthenticatedRequestScope, unknown> {
  return Effect.gen(function* () {
    const { request, selected } = yield* validateBrowserScopeRequest(input, options)
    const { principal, session } = yield* readBrowserIdentity(env, request)
    const visibility = fieldsInOrder([
      [
        'sql',
        `wm.role IN ('owner','admin') OR EXISTS (SELECT 1 FROM user_group_members ugm JOIN group_project_grants gpg ON gpg.group_id = ugm.group_id WHERE ugm.user_id = ? AND gpg.project_id = p.id)`,
      ],
      ['bindings', [session.user.id]],
    ])
    const catalog = (archived = false): Effect.Effect<ProjectSummary[], CatalogError> =>
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
    return yield* Effect.try({
      catch: publicWebFailure,
      try: () => resolveScope(session, visible, url, selected),
    }).pipe(Effect.map((scope) => withBrowserAuth(scope, principal.auth)))
  })
}
