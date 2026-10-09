'use server'

import { and, eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import * as groupCommands from '#commands/groups'
import { revokeConnectorGrant } from '#commands/oauth'
import * as workspaceCommands from '#commands/workspaces'
import { schema } from '#db'
import { oauthApi } from '#services/oauth-provider'
import { listProjects } from '#services/projects'

import { EFFRONT } from '../../effront'
import { RequestServices } from '../../request'
import { runCommand } from '../../server/command-context'
import { dataError, visibleProjectPredicate } from '../../server/data-context'
import { ScopeError } from '../../server/errors'
import { resolveFunctionContext } from '../../server/function-context'
import { checkSameOriginMutation } from '../../server/mutation'
import type { RequestScope } from '../../server/request-context'
import {
  ConnectorIdentitySchema,
  CreateGroupInputSchema,
  CreateTokenInputSchema,
  GroupDescriptionInputSchema,
  GroupGrantInputSchema,
  GroupIdentitySchema,
  GroupMemberInputSchema,
  GroupProjectIdentitySchema,
  RenameGroupInputSchema,
  TokenIdentitySchema,
} from './input-schemas'

/** Grant targets are explicit IDs, including archived projects outside the active page catalog. */
function authorizeGrantProject(db: Parameters<typeof listProjects>[0], scope: RequestScope, projectId: string) {
  return Effect.gen(function* () {
    if (scope.selection.kind !== 'workspace')
      return yield* new ScopeError(404, 'Project not found in the selected workspace.')
    const workspaceId = scope.selection.workspace.id
    const visibility = yield* Effect.try({
      try: () =>
        and(visibleProjectPredicate(scope, workspaceId, schema.projects.id), eq(schema.projects.id, projectId)),
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
    })
    const [project] = yield* listProjects(db, workspaceId, { includeArchived: true, visibility }).pipe(
      Effect.mapError(dataError),
    )
    if (!project) return yield* new ScopeError(404, 'Project not found in the selected workspace.')
  })
}

export const createGroup = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(CreateGroupInputSchema)] as const,
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        const value = yield* runCommand(context, (ctx) =>
          groupCommands.createGroup(ctx, { name: input.name.trim() }),
        ).pipe(Effect.map(({ id }) => ({ id })))
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const renameGroup = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(RenameGroupInputSchema)] as const,
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        const value = yield* runCommand(context, (ctx) =>
          groupCommands.updateGroup(ctx, input.groupId, { name: input.name.trim() }),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const describeGroup = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(GroupDescriptionInputSchema)] as const,
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        const value = yield* runCommand(context, (ctx) =>
          groupCommands.updateGroup(ctx, input.groupId, { description: input.description.trim() || null }),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const deleteGroup = EFFRONT.ServerFn.make({
  input: GroupIdentitySchema,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        const value = yield* runCommand(context, (ctx) => groupCommands.deleteGroup(ctx, input.groupId))
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const addGroupMember = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(GroupMemberInputSchema)] as const,
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        const value = yield* runCommand(context, (ctx) =>
          groupCommands.addGroupMember(ctx, input.groupId, { userId: input.userId }),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const removeGroupMember = EFFRONT.ServerFn.make({
  input: GroupMemberInputSchema,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        const value = yield* runCommand(context, (ctx) =>
          groupCommands.removeGroupMember(ctx, input.groupId, input.userId),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const setGroupGrant = EFFRONT.ServerFn.make({
  input: GroupGrantInputSchema,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(
          { workspaceSlug: input.workspaceSlug },
          { requireWorkspace: true },
        )
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        yield* authorizeGrantProject(services.db, context.scope, input.projectId)
        const value = yield* runCommand(context, (ctx) =>
          groupCommands.setGroupGrant(ctx, input.groupId, { projectId: input.projectId, role: input.role }),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
/** Native add-grant form. Inline role changes still use the rich setGroupGrant control. */
export const createGroupGrant = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(GroupGrantInputSchema)] as const,
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(
          { workspaceSlug: input.workspaceSlug },
          { requireWorkspace: true },
        )
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        yield* authorizeGrantProject(services.db, context.scope, input.projectId)
        const value = yield* runCommand(context, (ctx) =>
          groupCommands.setGroupGrant(ctx, input.groupId, { projectId: input.projectId, role: input.role }),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const removeGroupGrant = EFFRONT.ServerFn.make({
  input: GroupProjectIdentitySchema,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(
          { workspaceSlug: input.workspaceSlug },
          { requireWorkspace: true },
        )
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        yield* authorizeGrantProject(services.db, context.scope, input.projectId)
        const value = yield* runCommand(context, (ctx) =>
          groupCommands.removeGroupGrant(ctx, input.groupId, input.projectId),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const createToken = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(CreateTokenInputSchema)] as const,
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        const value = yield* runCommand(context, (ctx) =>
          workspaceCommands.createToken(ctx, {
            name: input.name.trim(),
            scopes: input.scope === 'read' ? ['read'] : ['read', 'write'],
            ...(input.expiry ? { expiresInDays: Number(input.expiry) } : {}),
          }),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const revokeToken = EFFRONT.ServerFn.make({
  input: TokenIdentitySchema,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        const value = yield* runCommand(context, (ctx) => workspaceCommands.revokeToken(ctx, input.tokenId))
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
export const disconnectConnector = EFFRONT.ServerFn.make({
  input: ConnectorIdentitySchema,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) return yield* new ScopeError(403, 'Select an accessible workspace.')
        const value = yield* runCommand(context, (ctx) =>
          revokeConnectorGrant(oauthApi(services.env), ctx.userId, ctx.workspaceId, input.connectorId),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
          ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
