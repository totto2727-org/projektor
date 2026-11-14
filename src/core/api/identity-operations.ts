import { Effect, Schema } from 'effect'

import { listProjectsAcrossWorkspaces } from '#commands/projects'
import { createUserToken, deleteUserToken, getUserWorkspaces } from '#commands/user-tokens'
import { createWorkspace, listWorkspaces } from '#commands/workspaces'

import { ApiDevelopmentBootstrap, ApiPrincipal } from '../../contracts/api-auth'
import { ApiResults } from '../../contracts/api-results'
import { type CoreActor, requireCoreCapability, resolveCorePrincipal, resolveCoreServiceCtx } from '../authorization'
import { coreFailure, coreReply } from '../contract'
import { publicDomainFailure } from '../domain-errors'
import type { CoreEnvironment } from '../environment'
import { bootstrapDevelopment } from './bootstrap'

const User = Schema.Struct({ id: Schema.String, email: Schema.String, name: Schema.String })
const Workspace = Schema.Struct({ id: Schema.String, name: Schema.String, slug: Schema.String, role: Schema.String })
const Workspaces = Schema.Array(Workspace)

/** These named methods never accept caller-supplied user IDs or roles. */
export function makeApiIdentityHandlers<R>(envSource: Effect.Effect<CoreEnvironment, never, R>) {
  function attempt<A>(operation: (env: CoreEnvironment) => Promise<A>) {
    return Effect.flatMap(envSource, (env) =>
      Effect.tryPromise({ try: () => operation(env), catch: publicDomainFailure }),
    )
  }
  return {
    apiBootstrap: (provided: string | undefined, requestUrl: string) =>
      coreReply(
        'apiBootstrap',
        ApiDevelopmentBootstrap,
        attempt((env) => bootstrapDevelopment(env, provided, requestUrl)),
      ),
    apiAuthenticate: (actor: CoreActor) =>
      coreReply(
        'apiAuthenticate',
        ApiPrincipal,
        attempt((env) => resolveCorePrincipal(actor, env)),
      ),
    apiResolveWorkspace: (actor: CoreActor, target: { kind: 'slug' | 'id'; value: string }) =>
      coreReply(
        'apiResolveWorkspace',
        Workspace,
        attempt(async (env) => {
          await resolveUser(actor, env, 'read')
          const input = Schema.decodeUnknownSync(
            Schema.Struct({ kind: Schema.Literals(['slug', 'id']), value: Schema.String }),
          )(target)
          const row =
            input.kind === 'id'
              ? await env.DB.prepare('SELECT id, name, slug FROM workspaces WHERE id = ?')
                  .bind(input.value)
                  .first<{ id: string; name: string; slug: string }>()
              : await env.DB.prepare('SELECT id, name, slug FROM workspaces WHERE slug = ?')
                  .bind(input.value)
                  .first<{ id: string; name: string; slug: string }>()
          if (!row) throw coreFailure(404, 'Workspace not found')
          const ctx = await resolveCoreServiceCtx(actor, row.id, 'read', env)
          return { ...row, role: ctx.role ?? 'viewer' }
        }),
      ),
    apiListWorkspaces: (actor: CoreActor) =>
      coreReply(
        'apiListWorkspaces',
        ApiResults.apiListWorkspaces,
        attempt(async (env) => {
          const principal = await resolveUser(actor, env, 'read')
          const memberships = await listWorkspaces(env.DB, principal.user.id)
          return principal.tokenWorkspaceId == null
            ? memberships
            : memberships.filter((workspace) => workspace.id === principal.tokenWorkspaceId)
        }),
      ),
    apiUserBootstrap: (actor: CoreActor) =>
      coreReply(
        'apiUserBootstrap',
        Schema.Struct({ user: User, workspaces: Workspaces }),
        attempt(async (env) => {
          const principal = await resolveUser(actor, env, 'read')
          const memberships = await getUserWorkspaces({ db: env.DB, userId: principal.user.id })
          const workspaces =
            principal.tokenWorkspaceId == null
              ? memberships
              : memberships.filter((workspace) => workspace.id === principal.tokenWorkspaceId)
          return { user: principal.user, workspaces }
        }),
      ),
    apiListProjects: (actor: CoreActor, includeArchived: boolean) =>
      coreReply(
        'apiListProjects',
        ApiResults.apiListProjects,
        attempt(async (env) => {
          const principal = await resolveUser(actor, env, 'read')
          const projects = await listProjectsAcrossWorkspaces(principal.user.id, env.DB, includeArchived)
          return principal.tokenWorkspaceId == null
            ? projects
            : projects.filter((project) => project.workspace_id === principal.tokenWorkspaceId)
        }),
      ),
    apiCreateWorkspace: (actor: CoreActor, input: unknown) =>
      coreReply(
        'apiCreateWorkspace',
        ApiResults.apiCreateWorkspace,
        attempt(async (env) => {
          const principal = await resolveUser(actor, env, 'write')
          if (principal.tokenWorkspaceId != null)
            throw coreFailure(403, 'Workspace-scoped credentials cannot create workspaces')
          return createWorkspace(env.DB, principal.user.id, input)
        }),
      ),
    apiCreateUserToken: (actor: CoreActor, input: unknown) =>
      coreReply(
        'apiCreateUserToken',
        ApiResults.apiCreateUserToken,
        attempt(async (env) => {
          const principal = await resolveUser(actor, env, 'write')
          requireInteractive(principal.auth)
          return createUserToken({ db: env.DB, userId: principal.user.id }, input)
        }),
      ),
    apiDeleteUserToken: (actor: CoreActor, id: string) =>
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

async function resolveUser(actor: CoreActor, env: CoreEnvironment, capability: 'read' | 'write') {
  const principal = await resolveCorePrincipal(actor, env)
  requireCoreCapability(principal, capability)
  return principal
}

function requireInteractive(auth: { method: string; kind: string }) {
  if (auth.kind !== 'human' || (auth.method !== 'access' && auth.method !== 'dev')) {
    throw coreFailure(403, 'Personal credentials require a signed-in browser session')
  }
}
