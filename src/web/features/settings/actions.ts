'use server'

import { Effect, Schema } from 'effect'

import { HTTP_FORBIDDEN } from '#contracts/http-status.ts'
import { EFFRONT } from '@/effront.ts'
import { RequestServices } from '@/request.ts'
import { runBrowserCommand as runCommand } from '@/server/browser-command.ts'
import { ScopeError } from '@/server/errors.ts'
import { resolveFunctionContext } from '@/server/function-context.ts'
import { checkSameOriginMutation } from '@/server/mutation.ts'

import { groupCommands, revokeConnectorGrant, workspaceCommands } from './data.ts'
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
} from './input-schemas.ts'

export const createGroup = EFFRONT.ServerFn.make({
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: [Schema.Unknown, Schema.fromFormData(CreateGroupInputSchema)] as const,
})
export const renameGroup = EFFRONT.ServerFn.make({
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: [Schema.Unknown, Schema.fromFormData(RenameGroupInputSchema)] as const,
})
export const describeGroup = EFFRONT.ServerFn.make({
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: [Schema.Unknown, Schema.fromFormData(GroupDescriptionInputSchema)] as const,
})
export const deleteGroup = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: GroupIdentitySchema,
})
export const addGroupMember = EFFRONT.ServerFn.make({
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: [Schema.Unknown, Schema.fromFormData(GroupMemberInputSchema)] as const,
})
export const removeGroupMember = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: GroupMemberInputSchema,
})
export const setGroupGrant = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(
          { workspaceSlug: input.workspaceSlug },
          { requireWorkspace: true },
        )
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: GroupGrantInputSchema,
})
/** Native add-grant form. Inline role changes still use the rich setGroupGrant control. */
export const createGroupGrant = EFFRONT.ServerFn.make({
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(
          { workspaceSlug: input.workspaceSlug },
          { requireWorkspace: true },
        )
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: [Schema.Unknown, Schema.fromFormData(GroupGrantInputSchema)] as const,
})
export const removeGroupGrant = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(
          { workspaceSlug: input.workspaceSlug },
          { requireWorkspace: true },
        )
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: GroupProjectIdentitySchema,
})
export const createToken = EFFRONT.ServerFn.make({
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: [Schema.Unknown, Schema.fromFormData(CreateTokenInputSchema)] as const,
})
export const revokeToken = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: TokenIdentitySchema,
})
export const disconnectConnector = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const context = yield* resolveFunctionContext(input, { requireWorkspace: true })
        if (!context.workspaceSlug) {
          return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
        }
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
  input: ConnectorIdentitySchema,
})
