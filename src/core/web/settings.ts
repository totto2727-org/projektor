import { and, eq } from 'drizzle-orm'
import { Predicate, Effect } from 'effect'
import type { Schema } from 'effect'

import * as groups from '#commands/groups.ts'
import { listConnectorGrants, revokeConnectorGrant } from '#commands/oauth.ts'
import type { ServiceCtx } from '#commands/types.ts'
import * as workspaces from '#commands/workspaces.ts'
import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_NOT_FOUND } from '#contracts/http-status.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import {
  ConnectorsSchema,
  CreatedGroupSchema,
  McpInfoSchema,
  NewTokenSchema,
  SettingsGroupsSchema,
  SettingsOkSchema,
  SettingsTokensSchema,
} from '#contracts/web-schemas/settings.ts'
import type { CoreReply } from '#core/contract.ts'
import { coreFailure, coreReply } from '#core/contract.ts'
import { publicDomainFailure } from '#core/domain-errors.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import { schema } from '#db'
import { apiOrigin } from '#deployment'
import * as groupQueries from '#services/groups.ts'
import { listProjects } from '#services/projects.ts'
import { listWorkspaceMembers, listWorkspaceTokenMetadata } from '#services/workspaces.ts'

import { loadBrowserScope, publicWebFailure } from './authentication.ts'
import { decodeBrowserCommand } from './command-contract.ts'
import type { BrowserCommand } from './command-contract.ts'
import { browserCommand } from './command.ts'
import { requireDataWorkspace, visibleProjectPredicate } from './data-context.ts'
import { checked } from './issue-data.ts'
import { webRead } from './issue-operations.ts'
import type { RequestScope, WebRequest } from './scope.ts'

const admin = (role: string | undefined): boolean => role === 'owner' || role === 'admin'
const readContext = function readContext(env: CoreEnvironment, proof: BrowserCommand) {
  return Effect.gen(function* () {
    const input = yield* decodeBrowserCommand(proof).pipe(
      Effect.mapError(() => coreFailure(HTTP_BAD_REQUEST, 'Invalid browser request.')),
    )
    const scope = yield* loadBrowserScope(
      env,
      input.request,
      fieldsInOrder([
        ['workspaceHint', input.workspaceSlug],
        ['projectHint', ''],
        ['requireWorkspace', true],
      ]),
    )
    const workspace = yield* checked(() => requireDataWorkspace(scope))
    const { auth } = scope
    if (!auth || auth.kind !== 'human' || (auth.method !== 'access' && auth.method !== 'dev')) {
      return yield* coreFailure(HTTP_FORBIDDEN, 'An interactive browser session is required.')
    }
    const ctx: ServiceCtx = {
      db: env.DB,
      kv: env.KV,
      r2: env.R2,
      workspaceId: workspace.id,
      userId: scope.user.id,
      role: workspace.role,
      authKind: 'human',
      auth,
      workspaceHub: env.WORKSPACE_HUB,
    }
    return fieldsInOrder([
      ['ctx', ctx],
      ['workspace', workspace],
      ['scope', scope],
    ])
  })
}
const authorizeGrantProject = function authorizeGrantProject(
  env: CoreEnvironment,
  scope: RequestScope,
  workspaceId: string,
  projectId: string,
) {
  return Effect.gen(function* () {
    const visibility = yield* checked(() =>
      and(visibleProjectPredicate(scope, workspaceId, schema.projects.id), eq(schema.projects.id, projectId)),
    )
    const [project] = yield* listProjects(env.DB, workspaceId, { includeArchived: true, visibility })
    if (!project) {
      return yield* coreFailure(HTTP_NOT_FOUND, 'Project not found in the selected workspace.')
    }
  })
}
export const makeSettingsHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => {
  const mutation = function mutation<S extends Schema.Top, A>(
    name: string,
    codec: S,
    proof: BrowserCommand,
    operation: (ctx: ServiceCtx, env: CoreEnvironment) => Promise<A>,
  ): CoreReply<R, S> {
    return Effect.flatMap(envSource, (env) =>
      coreReply(
        name,
        codec,
        browserCommand(env, proof, async (ctx) => operation(ctx, env)),
      ),
    )
  }
  const grant = function grant(
    name: string,
    proof: BrowserCommand,
    groupId: string,
    projectId: string,
    role?: 'viewer' | 'member' | 'admin',
  ): Effect.Effect<string, never, R> {
    return Effect.flatMap(envSource, (env) =>
      coreReply(
        name,
        SettingsOkSchema,
        Effect.gen(function* () {
          const { scope, workspace } = yield* readContext(env, proof)
          yield* authorizeGrantProject(env, scope, workspace.id, projectId)
          return yield* browserCommand(env, proof, async (ctx) =>
            Predicate.isNullish(role)
              ? groups.removeGroupGrant(ctx, groupId, projectId)
              : groups.setGroupGrant(ctx, groupId, { projectId, role }),
          )
        }).pipe(Effect.mapError(publicWebFailure)),
      ),
    )
  }
  return {
    webSettingsGroups: (request: WebRequest, workspaceId: string): CoreReply<R> =>
      Effect.flatMap(envSource, (env) =>
        coreReply(
          'webSettingsGroups',
          SettingsGroupsSchema,
          webRead(env, request, workspaceId, (scope) =>
            Effect.gen(function* () {
              const workspace = yield* checked(() => requireDataWorkspace(scope, workspaceId))
              const isAdmin = admin(workspace.role)
              const [rows, members] = yield* Effect.all(
                [
                  groupQueries.listGroups(env.DB, workspaceId, isAdmin ? {} : { memberUserId: scope.user.id }),
                  listWorkspaceMembers(env.DB, workspaceId),
                ],
                { concurrency: 2 },
              )
              const [memberGroups, details] = isAdmin
                ? yield* Effect.all(
                    [
                      groupQueries.listMemberGroups(env.DB, workspaceId),
                      Effect.all(
                        rows.map((group) =>
                          Effect.gen(function* () {
                            const [groupMembers, grants] = yield* Effect.all(
                              [
                                groupQueries.listGroupMembers(env.DB, workspaceId, group.id),
                                groupQueries.listGroupGrants(env.DB, workspaceId, group.id),
                              ],
                              { concurrency: 2 },
                            )
                            return { ...group, members: groupMembers, grants }
                          }),
                        ),
                        { concurrency: 4 },
                      ),
                    ],
                    { concurrency: 2 },
                  )
                : [[], []]
              return {
                groups: rows,
                details,
                members: members.map(({ id, email, name, role }) => ({ id, email, name, role })),
                memberGroups,
                projects: scope.projects.filter(
                  (project) => project.workspace_id === workspaceId && project.workspace_slug === workspace.slug,
                ),
                role: workspace.role,
              }
            }),
          ),
        ),
      ),
    webSettingsTokens: (proof: BrowserCommand): CoreReply<R> =>
      Effect.flatMap(envSource, (env) =>
        coreReply(
          'webSettingsTokens',
          SettingsTokensSchema,
          Effect.gen(function* () {
            const { ctx, workspace } = yield* readContext(env, proof)
            const tokens = admin(ctx.role)
              ? yield* listWorkspaceTokenMetadata(env.DB, ctx.workspaceId).pipe(
                  Effect.map((rows) => rows.map((row) => ({ ...row, scopes: JSON.stringify(row.scopes) }))),
                )
              : []
            const grants = yield* Effect.tryPromise({
              catch: publicDomainFailure,
              try: async () => {
                const provider = await import('#services/oauth-provider.ts')
                return listConnectorGrants(provider.oauthApi(env), ctx.userId, ctx.workspaceId)
              },
            })
            const info = yield* Effect.tryPromise({
              catch: publicDomainFailure,
              try: async () => workspaces.getWorkspaceMcpInfo(ctx, workspace, apiOrigin),
            }).pipe(Effect.catch(() => Effect.succeed(null)))
            return fieldsInOrder([
              ['tokens', tokens],
              ['tokensDenied', !admin(ctx.role)],
              ['grants', grants],
              ['connectorsDenied', false],
              ['info', info],
            ])
          }).pipe(Effect.mapError(publicWebFailure)),
        ),
      ),
    webSettingsConnectors: (proof: BrowserCommand): CoreReply<R> =>
      Effect.flatMap(envSource, (env) =>
        coreReply(
          'webSettingsConnectors',
          ConnectorsSchema,
          Effect.gen(function* () {
            const { ctx } = yield* readContext(env, proof)
            return yield* Effect.tryPromise({
              catch: publicDomainFailure,
              try: async () => {
                const provider = await import('#services/oauth-provider.ts')
                return listConnectorGrants(provider.oauthApi(env), ctx.userId, ctx.workspaceId)
              },
            })
          }),
        ),
      ),
    webSettingsMcp: (proof: BrowserCommand): CoreReply<R> =>
      Effect.flatMap(envSource, (env) =>
        coreReply(
          'webSettingsMcp',
          McpInfoSchema,
          Effect.gen(function* () {
            const { ctx, workspace } = yield* readContext(env, proof)
            return yield* Effect.tryPromise({
              catch: publicDomainFailure,
              try: async () => workspaces.getWorkspaceMcpInfo(ctx, workspace, apiOrigin),
            })
          }),
        ),
      ),
    webCreateGroup: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      mutation('webCreateGroup', CreatedGroupSchema, proof, async (ctx) => groups.createGroup(ctx, input)),
    webUpdateGroup: (proof: BrowserCommand, groupId: string, input: unknown): CoreReply<R> =>
      mutation('webUpdateGroup', SettingsOkSchema, proof, async (ctx) => groups.updateGroup(ctx, groupId, input)),
    webDeleteGroup: (proof: BrowserCommand, groupId: string): CoreReply<R> =>
      mutation('webDeleteGroup', SettingsOkSchema, proof, async (ctx) => groups.deleteGroup(ctx, groupId)),
    webAddGroupMember: (proof: BrowserCommand, groupId: string, input: unknown): CoreReply<R> =>
      mutation('webAddGroupMember', SettingsOkSchema, proof, async (ctx) => groups.addGroupMember(ctx, groupId, input)),
    webRemoveGroupMember: (proof: BrowserCommand, groupId: string, userId: string): CoreReply<R> =>
      mutation('webRemoveGroupMember', SettingsOkSchema, proof, async (ctx) =>
        groups.removeGroupMember(ctx, groupId, userId),
      ),
    webSetGroupGrant: (
      proof: BrowserCommand,
      groupId: string,
      projectId: string,
      role: 'viewer' | 'member' | 'admin',
    ): CoreReply<R> => grant('webSetGroupGrant', proof, groupId, projectId, role),
    webRemoveGroupGrant: (proof: BrowserCommand, groupId: string, projectId: string): CoreReply<R> =>
      grant('webRemoveGroupGrant', proof, groupId, projectId),
    webCreateToken: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      mutation('webCreateToken', NewTokenSchema, proof, async (ctx) => workspaces.createToken(ctx, input)),
    webRevokeToken: (proof: BrowserCommand, tokenId: string): CoreReply<R> =>
      mutation('webRevokeToken', SettingsOkSchema, proof, async (ctx) => workspaces.revokeToken(ctx, tokenId)),
    webDisconnectConnector: (proof: BrowserCommand, connectorId: string): CoreReply<R> =>
      mutation('webDisconnectConnector', SettingsOkSchema, proof, async (ctx, env) => {
        const provider = await import('#services/oauth-provider.ts')
        return revokeConnectorGrant(provider.oauthApi(env), ctx.userId, ctx.workspaceId, connectorId)
      }),
  }
}
