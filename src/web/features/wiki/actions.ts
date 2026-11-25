'use server'

import { Predicate, Effect, Schema } from 'effect'

import { isWikiRevisionSpecified } from '#contracts/wiki-revision.ts'
import { EFFRONT } from '@/effront.ts'
import { actionFailure } from '@/function-result.ts'
import { RequestServices } from '@/request.ts'
import { runBrowserCommand as runCommand } from '@/server/browser-command.ts'
import { dataError } from '@/server/data-context.ts'
import { FunctionSelectorSchema, resolveFunctionContext } from '@/server/function-context.ts'
import { checkSameOriginMutation } from '@/server/mutation.ts'

import {
  deleteStoredAttachment,
  wikiCommands,
  wikiDraftCommands,
  readWikiPage,
  readWikiDraft,
  readWikiDraftState,
  readWikiDiff,
} from './data.ts'
import { EditFields } from './form-schemas.ts'
import {
  Created,
  Deleted,
  DraftPrecondition,
  DraftRevision,
  Ok,
  Published,
  Restored,
  SavedDraft,
  Verified,
} from './schemas.ts'

const decodeCreatedWikiPage = Schema.decodeUnknownEffect(Created)
const decodePublishedWikiPage = Schema.decodeUnknownEffect(Published)
const decodeSavedWikiDraft = Schema.decodeUnknownEffect(SavedDraft)
const decodeWikiDraftRevision = Schema.decodeUnknownEffect(DraftRevision)
const decodeWikiCommandOk = Schema.decodeUnknownEffect(Ok)
const decodeVerifiedWikiPage = Schema.decodeUnknownEffect(Verified)
const decodeDeletedWikiPage = Schema.decodeUnknownEffect(Deleted)
const decodeRestoredWikiPage = Schema.decodeUnknownEffect(Restored)

const identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
const Reference = Schema.Struct({ ...FunctionSelectorSchema.fields, slug: identifier })
const RevisionReference = Schema.Struct({ ...Reference.fields, revisionId: identifier })
const Create = Schema.Struct({
  ...FunctionSelectorSchema.fields,
  title: EditFields.fields.title,
  slug: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200), Schema.isPattern(/^[a-z0-9-]+$/)),
  content: Schema.optional(EditFields.fields.content),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  templateSlug: Schema.optional(identifier),
}).check(
  Schema.makeFilter(
    (value) =>
      !(Predicate.isNotNullish(value.content) && Predicate.isNotNullish(value.templateSlug)) ||
      'Choose template or content, not both.',
  ),
)

export const getWikiPage = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readWikiPage(ctx, input.slug)
      return { ok: true, value } as const
    }).pipe(
      Effect.catchTags({
        ApiError: (error) =>
          Effect.succeed({
            ok: false,
            status: error.status,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          } as const),
        ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
      }),
    ),
  input: Reference,
})

export const getWikiRevisionDiff = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readWikiDiff(ctx, input.slug, input.revisionId)
      return { ok: true, value } as const
    }).pipe(
      Effect.catchTags({
        ApiError: (error) =>
          Effect.succeed({
            ok: false,
            status: error.status,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          } as const),
        ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
      }),
    ),
  input: RevisionReference,
})

export const getWikiDraft = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readWikiDraft(ctx, input.slug)
      return { ok: true, value } as const
    }).pipe(
      Effect.catchTags({
        ApiError: (error) =>
          Effect.succeed({
            ok: false,
            status: error.status,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          } as const),
        ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
      }),
    ),
  input: Reference,
})

export const getWikiDraftState = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readWikiDraftState(ctx, input.slug)
      return { ok: true, value } as const
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
      }),
    ),
  input: Reference,
})

export const createWikiPage = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) =>
          wikiCommands.createWikiPage(command, {
            title: input.title,
            slug: input.slug,
            ...(input.templateSlug ? { templateSlug: input.templateSlug } : { content: input.content ?? '' }),
            ...(input.parentId ? { parentId: input.parentId } : {}),
            ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
          }),
        ).pipe(Effect.flatMap((commandResult) => decodeCreatedWikiPage(commandResult).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed({
              ok: false,
              status: error.status,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            } as const),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Create,
})

export const duplicateWikiPage = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const page = yield* readWikiPage(ctx, input.slug)
        const value = yield* runCommand(ctx, (command) =>
          wikiCommands.createWikiPage(command, {
            title: `${page.title} (copy)`,
            slug: `${page.slug}-copy-${crypto.randomUUID().slice(0, 8)}`,
            content: page.content,
            ...(page.parent_id ? { parentId: page.parent_id } : {}),
            ...(page.project_id ? { projectId: page.project_id } : {}),
          }),
        ).pipe(Effect.flatMap((commandResult) => decodeCreatedWikiPage(commandResult).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed({
              ok: false,
              status: error.status,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            } as const),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Reference,
})

export const saveWikiPage = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) =>
          wikiCommands.publishWikiPage(command, input.slug, {
            title: input.title,
            content: input.content,
            expectedDraftRevision: input.expectedDraftRevision,
            ...(isWikiRevisionSpecified(input.baseRevisionId) ? { baseRevisionId: input.baseRevisionId } : {}),
          }),
        ).pipe(
          Effect.flatMap((commandResult) => decodePublishedWikiPage(commandResult).pipe(Effect.mapError(dataError))),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed({
              ok: false,
              status: error.status,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            } as const),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({ ...Reference.fields, ...EditFields.fields, ...DraftPrecondition.fields }),
})

export const saveWikiDraft = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) =>
          wikiDraftCommands.saveWikiDraft(command, input.slug, {
            title: input.title,
            content: input.content,
            baseRevisionId: input.baseRevisionId ?? null,
            expectedDraftRevision: input.expectedDraftRevision,
          }),
        ).pipe(Effect.flatMap((commandResult) => decodeSavedWikiDraft(commandResult).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed({
              ok: false,
              status: error.status,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            } as const),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({ ...Reference.fields, ...EditFields.fields, ...DraftPrecondition.fields }),
})

export const discardWikiDraft = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) =>
          wikiDraftCommands.discardWikiDraft(command, input.slug, {
            expectedDraftRevision: input.expectedDraftRevision,
          }),
        ).pipe(
          Effect.flatMap((commandResult) => decodeWikiDraftRevision(commandResult).pipe(Effect.mapError(dataError))),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed({
              ok: false,
              status: error.status,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            } as const),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({ ...Reference.fields, ...DraftPrecondition.fields }),
})

export const moveWikiPage = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) =>
          wikiCommands.updateWikiPage(command, input.slug, { parentId: input.parentId }),
        ).pipe(Effect.flatMap((commandResult) => decodeWikiCommandOk(commandResult).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed({
              ok: false,
              status: error.status,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            } as const),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({ ...Reference.fields, parentId: Schema.NullOr(Schema.String) }),
})

export const verifyWikiPage = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) => wikiCommands.verifyWikiPage(command, input.slug)).pipe(
          Effect.flatMap((commandResult) => decodeVerifiedWikiPage(commandResult).pipe(Effect.mapError(dataError))),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed({
              ok: false,
              status: error.status,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            } as const),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Reference,
})

export const trashWikiPage = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) =>
          wikiCommands.deleteWikiPage(command, input.slug, { cascade: true }),
        ).pipe(Effect.flatMap((commandResult) => decodeDeletedWikiPage(commandResult).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed({
              ok: false,
              status: error.status,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            } as const),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Reference,
})

export const restoreTrashedWikiPage = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) => wikiCommands.undeleteWikiPage(command, input.pageId)).pipe(
          Effect.flatMap((commandResult) => decodeRestoredWikiPage(commandResult).pipe(Effect.mapError(dataError))),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed({
              ok: false,
              status: error.status,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            } as const),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({ ...FunctionSelectorSchema.fields, pageId: identifier }),
})

export const restoreWikiRevision = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) =>
          wikiCommands.restoreWikiRevision(command, input.slug, input.revisionId, input.baseRevisionId),
        ).pipe(Effect.flatMap((commandResult) => decodeWikiCommandOk(commandResult).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed({
              ok: false,
              status: error.status,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            } as const),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({
    ...RevisionReference.fields,
    baseRevisionId: Schema.NullOr(Schema.String),
  }),
})

export const deleteWikiAttachment = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) => deleteStoredAttachment(command, input.attachmentId)).pipe(
          Effect.flatMap((commandResult) => decodeWikiCommandOk(commandResult).pipe(Effect.mapError(dataError))),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (error) =>
            Effect.succeed({
              ok: false,
              status: error.status,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            } as const),
          ScopeError: (scopeError) => Effect.succeed(actionFailure(scopeError.status, scopeError.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({ ...FunctionSelectorSchema.fields, attachmentId: identifier }),
})
