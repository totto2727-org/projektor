import { Effect, Schema, Predicate, Result } from 'effect'

import { listProjectsAcrossWorkspaces } from '#commands/projects.ts'
import { createUserToken, deleteUserToken, getUserWorkspaces } from '#commands/user-tokens.ts'
import { createWorkspace, listWorkspaces } from '#commands/workspaces.ts'
import { ApiDevelopmentBootstrap, ApiPrincipal } from '#contracts/api-auth.ts'
import { ApiResults } from '#contracts/api-results.ts'
import { HTTP_FORBIDDEN, HTTP_NOT_FOUND } from '#contracts/http-status.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { requireCoreCapability, resolveCorePrincipal, resolveCoreServiceCtx } from '#core/authorization.ts'
import type { CoreActor, CorePrincipal } from '#core/authorization.ts'
import type { CoreReply } from '#core/contract.ts'
import { coreFailure, coreReply } from '#core/contract.ts'
import { publicDomainFailure } from '#core/domain-errors.ts'
import type { CoreEnvironment } from '#core/environment.ts'

import { bootstrapDevelopment } from './bootstrap.ts'

const User = Schema.Struct(
  fieldsInOrder([
    ['id', Schema.String],
    ['email', Schema.String],
    ['name', Schema.String],
  ]),
)
const Workspace = Schema.Struct(
  fieldsInOrder([
    ['id', Schema.String],
    ['name', Schema.String],
    ['slug', Schema.String],
    ['role', Schema.String],
  ]),
)
const Workspaces = Schema.Array(Workspace)
const WorkspaceTarget = Schema.Struct({ kind: Schema.Literals(['slug', 'id']), value: Schema.String })
const decodeWorkspaceTarget = Schema.decodeUnknownResult(WorkspaceTarget)

const resolveUser = async function resolveUser(
  actor: CoreActor,
  env: CoreEnvironment,
  capability: 'read' | 'write',
): Promise<CorePrincipal> {
  const principal = await resolveCorePrincipal(actor, env)
  requireCoreCapability(principal, capability)
  return principal
}

const requireInteractive = function requireInteractive(auth: { method: string; kind: string }): void {
  if (auth.kind !== 'human' || (auth.method !== 'access' && auth.method !== 'dev')) {
    throw coreFailure(HTTP_FORBIDDEN, 'Personal credentials require a signed-in browser session')
  }
}

/**
 * These named methods never accept caller-supplied user IDs or roles.
 *
 * @param {Effect.Effect<CoreEnvironment, never, R>} envSource An effect that resolves the private Core bindings for each call.
 * @returns {ReturnType<typeof makeApiIdentityHandlers>} Named handlers for bootstrap, authentication, workspaces, and personal credentials.
 */
export const makeApiIdentityHandlers = function makeApiIdentityHandlers<R>(
  envSource: Effect.Effect<CoreEnvironment, never, R>,
) {
  const attempt = function attempt<A>(operation: (env: CoreEnvironment) => Promise<A>): Effect.Effect<A, unknown, R> {
    return Effect.flatMap(envSource, (env) =>
      Effect.tryPromise({ catch: publicDomainFailure, try: () => operation(env) }),
    )
  }
  return {
    apiBootstrap: (provided: string | undefined, requestUrl: string): CoreReply<R> =>
      coreReply(
        'apiBootstrap',
        ApiDevelopmentBootstrap,
        attempt((env) => bootstrapDevelopment(env, provided, requestUrl)),
      ),
    apiAuthenticate: (actor: CoreActor): CoreReply<R> =>
      coreReply(
        'apiAuthenticate',
        ApiPrincipal,
        attempt((env) => resolveCorePrincipal(actor, env)),
      ),
    apiResolveWorkspace: (actor: CoreActor, target: { kind: 'slug' | 'id'; value: string }): CoreReply<R> =>
      coreReply(
        'apiResolveWorkspace',
        Workspace,
        attempt(async (env) => {
          await resolveUser(actor, env, 'read')
          const input = Result.getOrThrow(decodeWorkspaceTarget(target))
          const row =
            input.kind === 'id'
              ? await env.DB.prepare('SELECT id, name, slug FROM workspaces WHERE id = ?')
                  .bind(input.value)
                  .first<{ id: string; name: string; slug: string }>()
              : await env.DB.prepare('SELECT id, name, slug FROM workspaces WHERE slug = ?')
                  .bind(input.value)
                  .first<{ id: string; name: string; slug: string }>()
          if (!row) {
            throw coreFailure(HTTP_NOT_FOUND, 'Workspace not found')
          }
          const ctx = await resolveCoreServiceCtx(actor, row.id, 'read', env)
          return { ...row, role: ctx.role ?? 'viewer' }
        }),
      ),
    apiListWorkspaces: (actor: CoreActor): CoreReply<R> =>
      coreReply(
        'apiListWorkspaces',
        ApiResults.apiListWorkspaces,
        attempt(async (env) => {
          const principal = await resolveUser(actor, env, 'read')
          const memberships = await listWorkspaces(env.DB, principal.user.id)
          return Predicate.isNotNullish(principal.tokenWorkspaceId)
            ? memberships.filter((workspace) => workspace.id === principal.tokenWorkspaceId)
            : memberships
        }),
      ),
    apiUserBootstrap: (actor: CoreActor): CoreReply<R> =>
      coreReply(
        'apiUserBootstrap',
        Schema.Struct({ user: User, workspaces: Workspaces }),
        attempt(async (env) => {
          const principal = await resolveUser(actor, env, 'read')
          const memberships = await getUserWorkspaces({ db: env.DB, userId: principal.user.id })
          const workspaces = Predicate.isNotNullish(principal.tokenWorkspaceId)
            ? memberships.filter((workspace) => workspace.id === principal.tokenWorkspaceId)
            : memberships
          return { user: principal.user, workspaces }
        }),
      ),
    apiListProjects: (actor: CoreActor, includeArchived: boolean): CoreReply<R> =>
      coreReply(
        'apiListProjects',
        ApiResults.apiListProjects,
        attempt(async (env) => {
          const principal = await resolveUser(actor, env, 'read')
          const projects = await listProjectsAcrossWorkspaces(principal.user.id, env.DB, includeArchived)
          return Predicate.isNotNullish(principal.tokenWorkspaceId)
            ? projects.filter((project) => project.workspace_id === principal.tokenWorkspaceId)
            : projects
        }),
      ),
    apiCreateWorkspace: (actor: CoreActor, input: unknown): CoreReply<R> =>
      coreReply(
        'apiCreateWorkspace',
        ApiResults.apiCreateWorkspace,
        attempt(async (env) => {
          const principal = await resolveUser(actor, env, 'write')
          if (Predicate.isNotNullish(principal.tokenWorkspaceId)) {
            throw coreFailure(HTTP_FORBIDDEN, 'Workspace-scoped credentials cannot create workspaces')
          }
          return createWorkspace(env.DB, principal.user.id, input)
        }),
      ),
    apiCreateUserToken: (actor: CoreActor, input: unknown): CoreReply<R> =>
      coreReply(
        'apiCreateUserToken',
        ApiResults.apiCreateUserToken,
        attempt(async (env) => {
          const principal = await resolveUser(actor, env, 'write')
          requireInteractive(principal.auth)
          return createUserToken({ db: env.DB, userId: principal.user.id }, input)
        }),
      ),
    apiDeleteUserToken: (actor: CoreActor, id: string): CoreReply<R> =>
      coreReply(
        'apiDeleteUserToken',
        ApiResults.apiDeleteUserToken,
        attempt(async (env) => {
          const principal = await resolveUser(actor, env, 'write')
          requireInteractive(principal.auth)
          return deleteUserToken({ db: env.DB, userId: principal.user.id }, id)
        }),
      ),
  }
}
