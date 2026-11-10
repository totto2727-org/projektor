import { Effect, Schema } from 'effect'

import { getUserWorkspaces } from '#commands/user-tokens'
import { authenticateBrowser, BrowserAuthenticationError } from '#services/authentication'
import { listProjectSummaries } from '#services/projects'

import { ApiError, ScopeError } from '../../contracts/errors'
import { coreFailure } from '../contract'
import type { CoreEnvironment } from '../environment'
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
  type WebRequest,
  type ScopeOptions,
} from './scope'

export function nativeRequest(input: WebRequest) {
  return new Request(input.url, { method: input.method, headers: input.headers.map(([name, value]) => [name, value]) })
}

export function publicWebFailure(error: unknown) {
  if (error instanceof ApiError || error instanceof ScopeError) return coreFailure(error.status, error.message)
  if (error instanceof BrowserAuthenticationError) return coreFailure(error.status, error.message)
  return error
}

export function loadBrowserScope(env: CoreEnvironment, input: WebRequest, options: ScopeOptions = {}) {
  return Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(WebRequestSchema)(input).pipe(
      Effect.mapError(() => coreFailure(400, 'Invalid browser request.')),
    )
    const selected = yield* Schema.decodeUnknownEffect(ScopeOptionsSchema)(options).pipe(
      Effect.mapError(() => coreFailure(400, 'Invalid scope options.')),
    )
    const request = yield* Effect.try({
      try: () => nativeRequest(decoded),
      catch: () => coreFailure(400, 'Invalid browser request.'),
    })
    if (request.headers.has('authorization'))
      return yield* coreFailure(403, 'An interactive browser session is required.')
    const principal = yield* Effect.tryPromise({
      try: () => authenticateBrowser(request, env),
      catch: publicWebFailure,
    })
    if (principal.user.email === 'public-viewer@projektor.local')
      return yield* coreFailure(403, 'An interactive browser session is required.')
    const session = yield* Effect.tryPromise({
      try: async () =>
        decodeAuthSession({
          user: principal.user,
          workspaces: await getUserWorkspaces({ db: env.DB, userId: principal.user.id }),
        }),
      catch: publicWebFailure,
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
      try: () => ({
        hint: selected.projectHint ?? readProjectHint(url),
        workspace: selectedWorkspace(session.workspaces, selected.workspaceHint ?? queryHint(url, 'workspace')),
      }),
      catch: publicWebFailure,
    })
    const active = projects.some(
      (project) =>
        hint !== undefined && matchesProject(project, hint) && (!workspace || workspace.id === project.workspace_id),
    )
    const visible = hint && !active ? yield* catalog(true) : projects
    const scope = yield* Effect.try({
      try: () => resolveScope(session, visible, url, selected),
      catch: publicWebFailure,
    })
    return { ...scope, auth: principal.auth }
  })
}
