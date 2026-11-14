'use server'

import { Effect, Schema } from 'effect'

import { EFFRONT } from '../../effront'
import { RequestServices } from '../../request'
import { runBrowserCommand as runCommand } from '../../server/browser-command'
import { ScopeError } from '../../server/errors'
import { resolveFunctionContext } from '../../server/function-context'
import { checkSameOriginMutation } from '../../server/mutation'
import { groupCommands, revokeConnectorGrant, workspaceCommands } from './data'
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
        const value = yield* runCommand(context, (ctx) => revokeConnectorGrant(ctx, input.connectorId))
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
