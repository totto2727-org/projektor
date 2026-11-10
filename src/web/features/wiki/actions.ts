'use server'

import { Effect, Schema } from 'effect'

import { EFFRONT } from '../../effront'
import { RequestServices } from '../../request'
import { runBrowserCommand as runCommand } from '../../server/browser-command'
import { dataError } from '../../server/data-context'
import { FunctionSelectorSchema, resolveFunctionContext } from '../../server/function-context'
import { checkSameOriginMutation } from '../../server/mutation'
import {
  deleteStoredAttachment,
  wikiCommands,
  wikiDraftCommands,
  readWikiPage,
  readWikiDraft,
  readWikiDiff,
} from './data'
import { EditFields } from './form-schemas'
import { Created, Deleted, Ok, Restored, SavedDraft, Verified } from './schemas'

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
      !(value.content !== undefined && value.templateSlug !== undefined) || 'Choose template or content, not both.',
  ),
)

export const getWikiPage = EFFRONT.ServerFn.make({
  input: Reference,
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readWikiPage(ctx, input.slug)
      return { ok: true, value } as const
    }).pipe(
      Effect.catchTags({
        ApiError: (e) =>
          Effect.succeed({
            ok: false,
            status: e.status,
            message: e.message,
            ...(e.details ? { details: e.details } : {}),
          } as const),
        ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
      }),
    ),
})

export const getWikiRevisionDiff = EFFRONT.ServerFn.make({
  input: RevisionReference,
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readWikiDiff(ctx, input.slug, input.revisionId)
      return { ok: true, value } as const
    }).pipe(
      Effect.catchTags({
        ApiError: (e) =>
          Effect.succeed({
            ok: false,
            status: e.status,
            message: e.message,
            ...(e.details ? { details: e.details } : {}),
          } as const),
        ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
      }),
    ),
})

export const getWikiDraft = EFFRONT.ServerFn.make({
  input: Reference,
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readWikiDraft(ctx, input.slug)
      return { ok: true, value } as const
    }).pipe(
      Effect.catchTags({
        ApiError: (e) =>
          Effect.succeed({
            ok: false,
            status: e.status,
            message: e.message,
            ...(e.details ? { details: e.details } : {}),
          } as const),
        ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
      }),
    ),
})

export const createWikiPage = EFFRONT.ServerFn.make({
  input: Create,
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
        ).pipe(Effect.flatMap((value) => Schema.decodeUnknownEffect(Created)(value).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) =>
            Effect.succeed({
              ok: false,
              status: e.status,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const duplicateWikiPage = EFFRONT.ServerFn.make({
  input: Reference,
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
        ).pipe(Effect.flatMap((value) => Schema.decodeUnknownEffect(Created)(value).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) =>
            Effect.succeed({
              ok: false,
              status: e.status,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const saveWikiPage = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...Reference.fields, ...EditFields.fields }),
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
            ...(input.baseRevisionId !== undefined ? { baseRevisionId: input.baseRevisionId } : {}),
          }),
        ).pipe(Effect.flatMap((value) => Schema.decodeUnknownEffect(Ok)(value).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) =>
            Effect.succeed({
              ok: false,
              status: e.status,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const saveWikiDraft = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...Reference.fields, ...EditFields.fields }),
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
          }),
        ).pipe(
          Effect.flatMap((value) => Schema.decodeUnknownEffect(SavedDraft)(value).pipe(Effect.mapError(dataError))),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) =>
            Effect.succeed({
              ok: false,
              status: e.status,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const discardWikiDraft = EFFRONT.ServerFn.make({
  input: Reference,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) => wikiDraftCommands.discardWikiDraft(command, input.slug)).pipe(
          Effect.flatMap((value) => Schema.decodeUnknownEffect(Ok)(value).pipe(Effect.mapError(dataError))),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) =>
            Effect.succeed({
              ok: false,
              status: e.status,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const moveWikiPage = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...Reference.fields, parentId: Schema.NullOr(Schema.String) }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) =>
          wikiCommands.updateWikiPage(command, input.slug, { parentId: input.parentId }),
        ).pipe(Effect.flatMap((value) => Schema.decodeUnknownEffect(Ok)(value).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) =>
            Effect.succeed({
              ok: false,
              status: e.status,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const verifyWikiPage = EFFRONT.ServerFn.make({
  input: Reference,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) => wikiCommands.verifyWikiPage(command, input.slug)).pipe(
          Effect.flatMap((value) => Schema.decodeUnknownEffect(Verified)(value).pipe(Effect.mapError(dataError))),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) =>
            Effect.succeed({
              ok: false,
              status: e.status,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const trashWikiPage = EFFRONT.ServerFn.make({
  input: Reference,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) =>
          wikiCommands.deleteWikiPage(command, input.slug, { cascade: true }),
        ).pipe(Effect.flatMap((value) => Schema.decodeUnknownEffect(Deleted)(value).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) =>
            Effect.succeed({
              ok: false,
              status: e.status,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const restoreTrashedWikiPage = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...FunctionSelectorSchema.fields, pageId: identifier }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) => wikiCommands.undeleteWikiPage(command, input.pageId)).pipe(
          Effect.flatMap((value) => Schema.decodeUnknownEffect(Restored)(value).pipe(Effect.mapError(dataError))),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) =>
            Effect.succeed({
              ok: false,
              status: e.status,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const restoreWikiRevision = EFFRONT.ServerFn.make({
  input: Schema.Struct({
    ...RevisionReference.fields,
    baseRevisionId: Schema.NullOr(Schema.String),
  }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) =>
          wikiCommands.restoreWikiRevision(command, input.slug, input.revisionId, input.baseRevisionId),
        ).pipe(Effect.flatMap((value) => Schema.decodeUnknownEffect(Ok)(value).pipe(Effect.mapError(dataError))))
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) =>
            Effect.succeed({
              ok: false,
              status: e.status,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})

export const deleteWikiAttachment = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...FunctionSelectorSchema.fields, attachmentId: identifier }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const value = yield* runCommand(ctx, (command) => deleteStoredAttachment(command, input.attachmentId)).pipe(
          Effect.flatMap((value) => Schema.decodeUnknownEffect(Ok)(value).pipe(Effect.mapError(dataError))),
        )
        return { ok: true, value } as const
      }).pipe(
        Effect.catchTags({
          ApiError: (e) =>
            Effect.succeed({
              ok: false,
              status: e.status,
              message: e.message,
              ...(e.details ? { details: e.details } : {}),
            } as const),
          ScopeError: (e) => Effect.succeed({ ok: false, status: e.status, message: e.message } as const),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
})
