'use server'
import { Effect, Schema } from 'effect'

import * as comments from '#commands/comments'
import * as files from '#commands/files'
import * as links from '#commands/issue-links'
import * as issues from '#commands/issues'
import { createShareToken } from '#commands/share'
import * as sprints from '#commands/sprints'

import { EFFRONT } from '../../effront'
import { RequestServices } from '../../request'
import { runCommand } from '../../server/command-context'
import { requireDataWorkspace } from '../../server/data-context'
import { ApiError, ScopeError } from '../../server/errors'
import { type FunctionContext, resolveFunctionContext } from '../../server/function-context'
import { checkSameOriginMutation } from '../../server/mutation'
import {
  CreateIssueSchema,
  IssueIdentitySchema,
  IssuePageInputSchema,
  IssuePatchSchema,
  OkSchema,
  SelectorFields,
} from './action-schemas'
import {
  readDataAttachments,
  readDataComments,
  readDataIssue,
  readDataIssuePage,
  readDataLinks,
  searchDataIssues,
  searchDataWikiAttachments,
} from './data'

/** Entity references are resolved under the authorized membership, then checked against the authorized catalog. */
function authorizedIssue(context: FunctionContext, issueId: string) {
  return Effect.gen(function* () {
    return yield* readDataIssue(context.scope, yield* dataWorkspaceId(context), issueId, context.projectId)
  })
}

function dataWorkspaceId(context: FunctionContext) {
  return Effect.try({
    try: () =>
      requireDataWorkspace(
        context.scope,
        context.scope.workspaces.find((workspace) => workspace.slug === context.workspaceSlug)?.id,
      ).id,
    catch: () => new ScopeError(403, 'Selected workspace is not accessible.'),
  })
}

export const createIssue = EFFRONT.ServerFn.make({
  input: [Schema.Unknown, Schema.fromFormData(CreateIssueSchema)],
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, {
          requireWorkspace: true,
          requireProject: true,
        })
        const body = {
          projectId: ctx.projectId ?? input.projectId,
          title: input.title.trim(),
          ...(input.body ? { body: input.body } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.statusId ? { statusId: input.statusId } : {}),
          ...(input.typeId ? { typeId: input.typeId } : {}),
        }
        const created = yield* runCommand(ctx, (command) => issues.createIssue(command, body))
        const value = yield* Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String, number: Schema.Number }))(
          created,
        ).pipe(
          Effect.mapError((cause) => new ApiError('schema', 502, 'The operation returned an invalid result.', cause)),
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
export const updateIssue = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...IssueIdentitySchema.fields, patch: IssuePatchSchema }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        if (input.patch.parentId) yield* authorizedIssue(ctx, input.patch.parentId)
        const updated = yield* runCommand(ctx, (command) => issues.updateIssue(command, input.issueId, input.patch))
        const value = yield* Schema.decodeUnknownEffect(OkSchema)(updated).pipe(
          Effect.mapError((cause) => new ApiError('schema', 502, 'The operation returned an invalid result.', cause)),
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
export const readIssue = EFFRONT.ServerFn.make({
  input: IssueIdentitySchema,
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      return {
        ok: true as const,
        value: {
          ...(yield* readDataIssue(ctx.scope, yield* dataWorkspaceId(ctx), input.issueId, ctx.projectId)),
          workspaceSlug: ctx.workspaceSlug,
        },
      }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
      }),
    ),
})
export const readIssuePage = EFFRONT.ServerFn.make({
  input: IssuePageInputSchema,
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const params = new URLSearchParams()
      if (ctx.projectId) params.set('project', ctx.projectId)
      for (const name of [
        'statusIds',
        'priorities',
        'typeId',
        'parentId',
        'noParent',
        'excludeTypeIds',
        'sprintId',
        'completedAfter',
        'completedBefore',
        'updatedAfter',
        'updatedBefore',
        'cursor',
      ] as const)
        if (input[name]) params.set(name, input[name])
      params.set('limit', String(input.limit ?? 30))
      if (input.includeRollups) params.set('includeRollups', '1')
      const value = yield* readDataIssuePage(ctx.scope, yield* dataWorkspaceId(ctx), params)
      return { ok: true as const, value }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
      }),
    ),
})
export const searchIssues = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...SelectorFields, query: Schema.String }),
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* searchDataIssues(
        ctx.scope,
        yield* dataWorkspaceId(ctx),
        input.query,
        ctx.projectId ?? undefined,
      )
      return { ok: true as const, value: [...value] }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
      }),
    ),
})
export const readComments = EFFRONT.ServerFn.make({
  input: IssueIdentitySchema,
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readDataComments(ctx.scope, yield* dataWorkspaceId(ctx), input.issueId, ctx.projectId)
      return { ok: true as const, value }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
      }),
    ),
})
export const addComment = EFFRONT.ServerFn.make({
  input: Schema.Struct({
    ...IssueIdentitySchema.fields,
    body: Schema.String.check(Schema.isMinLength(1)),
  }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        const value = yield* runCommand(ctx, (command) =>
          comments.addComment(command, { issueId: input.issueId, body: input.body }),
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
export const editComment = EFFRONT.ServerFn.make({
  input: Schema.Struct({
    ...IssueIdentitySchema.fields,
    commentId: Schema.String,
    body: Schema.String.check(Schema.isMinLength(1)),
  }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        const value = yield* runCommand(ctx, (command) =>
          comments.updateComment(command, { issueId: input.issueId, commentId: input.commentId, body: input.body }),
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
export const deleteComment = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...IssueIdentitySchema.fields, commentId: Schema.String }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        const value = yield* runCommand(ctx, (command) =>
          comments.deleteComment(command, { issueId: input.issueId, commentId: input.commentId }),
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
export const readLinks = EFFRONT.ServerFn.make({
  input: IssueIdentitySchema,
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readDataLinks(ctx.scope, yield* dataWorkspaceId(ctx), input.issueId, ctx.projectId)
      return { ok: true as const, value }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
      }),
    ),
})
export const addIssueLink = EFFRONT.ServerFn.make({
  input: Schema.Struct({
    ...IssueIdentitySchema.fields,
    targetIssueId: Schema.String,
    type: Schema.Literals(['blocks', 'blocked_by', 'relates_to', 'duplicates']),
  }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        yield* authorizedIssue(ctx, input.targetIssueId)
        const value = yield* runCommand(ctx, (command) =>
          links.createLink(command, {
            sourceIssueId: input.issueId,
            targetIssueId: input.targetIssueId,
            type: input.type,
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
export const deleteIssueLink = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...IssueIdentitySchema.fields, linkId: Schema.String }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        const issueLinks = yield* readDataLinks(ctx.scope, yield* dataWorkspaceId(ctx), input.issueId, ctx.projectId)
        if (!issueLinks.some((entry) => entry.id === input.linkId))
          return yield* new ScopeError(404, 'Link not found on this issue.')
        const deleted = yield* runCommand(ctx, (command) => links.deleteLink(command, { id: input.linkId }))
        const value = yield* Schema.decodeUnknownEffect(OkSchema)(deleted).pipe(
          Effect.mapError((cause) => new ApiError('schema', 502, 'The operation returned an invalid result.', cause)),
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
export const shareIssue = EFFRONT.ServerFn.make({
  input: IssueIdentitySchema,
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        const value = yield* runCommand(ctx, (command) => createShareToken(command, input.issueId))
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
export const readAttachments = EFFRONT.ServerFn.make({
  input: IssueIdentitySchema,
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readDataAttachments(ctx.scope, yield* dataWorkspaceId(ctx), input.issueId, ctx.projectId)
      return { ok: true as const, value }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
      }),
    ),
})
export const addAttachmentLink = EFFRONT.ServerFn.make({
  input: Schema.Struct({
    ...IssueIdentitySchema.fields,
    link: Schema.Union([
      Schema.Struct({ kind: Schema.Literal('wiki_ref'), wikiPageId: Schema.String }),
      Schema.Struct({
        kind: Schema.Literal('url'),
        url: Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/i)),
        label: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
      }),
    ]),
  }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        const value = yield* runCommand(ctx, (command) =>
          files.createLinkAttachment(command, { ...input.link, entityType: 'issue', entityId: input.issueId }),
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
export const deleteAttachment = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...IssueIdentitySchema.fields, attachmentId: Schema.String }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const attachments = yield* readDataAttachments(
          ctx.scope,
          yield* dataWorkspaceId(ctx),
          input.issueId,
          ctx.projectId,
        )
        if (!attachments.some((entry) => entry.id === input.attachmentId))
          return yield* new ScopeError(404, 'Attachment not found on this issue.')
        yield* runCommand(ctx, (command) => files.deleteStoredAttachment(command, input.attachmentId))
        const value = { ok: true as const }
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
export const searchWikiAttachments = EFFRONT.ServerFn.make({
  input: Schema.Struct({ ...SelectorFields, query: Schema.String }),
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* searchDataWikiAttachments(ctx.scope, yield* dataWorkspaceId(ctx), input.query)
      return { ok: true as const, value: [...value] }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
        ScopeError: (error) => Effect.succeed({ ok: false as const, status: error.status, message: error.message }),
      }),
    ),
})
export const updateSprint = EFFRONT.ServerFn.make({
  input: Schema.Struct({
    ...SelectorFields,
    sprintId: Schema.String,
    patch: Schema.Struct({
      name: Schema.String.check(Schema.isMinLength(1)),
      goal: Schema.NullOr(Schema.String),
      status: Schema.Literals(['planned', 'active', 'completed']),
      startDate: Schema.NullOr(Schema.Number),
      endDate: Schema.NullOr(Schema.Number),
    }),
  }),
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const updated = yield* runCommand(ctx, (command) => sprints.updateSprint(command, input.sprintId, input.patch))
        const value = yield* Schema.decodeUnknownEffect(OkSchema)(updated).pipe(
          Effect.mapError((cause) => new ApiError('schema', 502, 'The operation returned an invalid result.', cause)),
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
