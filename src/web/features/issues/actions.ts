'use server'
import { Iterable, Effect, Schema } from 'effect'

import { HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_BAD_GATEWAY } from '#contracts/http-status.ts'
import { ReviewStatusSchema } from '#contracts/review-targets.ts'
import { EFFRONT } from '@/effront.ts'
import { actionFailure } from '@/function-result.ts'
import { RequestServices } from '@/request.ts'
import { runBrowserCommand as runCommand } from '@/server/browser-command.ts'
import { requireDataWorkspace } from '@/server/data-context.ts'
import { ApiError, ScopeError } from '@/server/errors.ts'
import { resolveFunctionContext } from '@/server/function-context.ts'
import type { FunctionContext } from '@/server/function-context.ts'
import { checkSameOriginMutation } from '@/server/mutation.ts'

import {
  CreateIssueSchema,
  IssueIdentitySchema,
  IssuePageInputSchema,
  IssuePatchSchema,
  OkSchema,
  SelectorFields,
} from './action-schemas.ts'
import { comments, files, links, issues, createShareToken, sprints } from './commands.ts'
import {
  readDataAttachments,
  readDataComments,
  readDataIssue,
  readDataIssuePage,
  readDataLinks,
  searchDataIssues,
  searchDataWikiAttachments,
} from './data.ts'

const MIN_REQUIRED_INPUT_LENGTH = 1

const decodeCreatedIssue = Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String, number: Schema.Number }))
const decodeIssueCommandOk = Schema.decodeUnknownEffect(OkSchema)

const dataWorkspaceId = function dataWorkspaceId(context: FunctionContext): Effect.Effect<string, ScopeError> {
  return Effect.try({
    catch: () => new ScopeError(HTTP_FORBIDDEN, 'Selected workspace is not accessible.'),
    try: () =>
      requireDataWorkspace(
        context.scope,
        context.scope.workspaces.find((workspace) => workspace.slug === context.workspaceSlug)?.id,
      ).id,
  })
}

/** Entity references are resolved under the authorized membership, then checked against the authorized catalog. */
const authorizedIssue = function authorizedIssue(context: FunctionContext, issueId: string) {
  return Effect.gen(function* () {
    return yield* readDataIssue(context.scope, yield* dataWorkspaceId(context), issueId, context.projectId)
  })
}

const AttachmentReviewStatusInput = Schema.Struct({
  ...SelectorFields,
  issueId: Schema.String.check(Schema.isMinLength(MIN_REQUIRED_INPUT_LENGTH)),
  attachmentId: Schema.String.check(Schema.isMinLength(MIN_REQUIRED_INPUT_LENGTH)),
  status: Schema.NullOr(ReviewStatusSchema),
})

export const setAttachmentReviewStatus = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        const value = yield* runCommand(ctx, (command) =>
          files.setAttachmentReviewStatus(command, {
            issueId: input.issueId,
            attachmentId: input.attachmentId,
            status: input.status,
          }),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: AttachmentReviewStatusInput,
})

export const createIssue = EFFRONT.ServerFn.make({
  handler: (_previous, input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, {
          requireProject: true,
          requireWorkspace: true,
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
        const value = yield* decodeCreatedIssue(created).pipe(
          Effect.mapError(
            (cause) => new ApiError('schema', HTTP_BAD_GATEWAY, 'The operation returned an invalid result.', cause),
          ),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: [Schema.Unknown, Schema.fromFormData(CreateIssueSchema)],
})
export const updateIssue = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        if (input.patch.parentId) {
          yield* authorizedIssue(ctx, input.patch.parentId)
        }
        const updated = yield* runCommand(ctx, (command) => issues.updateIssue(command, input.issueId, input.patch))
        const value = yield* decodeIssueCommandOk(updated).pipe(
          Effect.mapError(
            (cause) => new ApiError('schema', HTTP_BAD_GATEWAY, 'The operation returned an invalid result.', cause),
          ),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({ ...IssueIdentitySchema.fields, patch: IssuePatchSchema }),
})
export const readIssue = EFFRONT.ServerFn.make({
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
        ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
      }),
    ),
  input: IssueIdentitySchema,
})
export const readIssuePage = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const params = new URLSearchParams()
      if (ctx.projectId) {
        params.set('project', ctx.projectId)
      }
      Iterable.forEach(
        [
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
        ] as const,
        (name) => {
          if (input[name]) {
            params.set(name, input[name])
          }
        },
      )
      params.set('limit', String(input.limit ?? 30))
      if (input.includeRollups === true) {
        params.set('includeRollups', '1')
      }
      const value = yield* readDataIssuePage(ctx.scope, yield* dataWorkspaceId(ctx), params)
      return { ok: true as const, value }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
      }),
    ),
  input: IssuePageInputSchema,
})
export const searchIssues = EFFRONT.ServerFn.make({
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
        ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
      }),
    ),
  input: Schema.Struct({ ...SelectorFields, query: Schema.String }),
})
export const readComments = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readDataComments(ctx.scope, yield* dataWorkspaceId(ctx), input.issueId, ctx.projectId)
      return { ok: true as const, value }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
      }),
    ),
  input: IssueIdentitySchema,
})
const AddCommentInput = Schema.Struct({
  ...IssueIdentitySchema.fields,
  body: Schema.String.check(Schema.isMinLength(MIN_REQUIRED_INPUT_LENGTH)),
})

export const addComment = EFFRONT.ServerFn.make({
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
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: AddCommentInput,
})
const EditCommentInput = Schema.Struct({
  ...IssueIdentitySchema.fields,
  commentId: Schema.String,
  body: Schema.String.check(Schema.isMinLength(MIN_REQUIRED_INPUT_LENGTH)),
})

export const editComment = EFFRONT.ServerFn.make({
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
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: EditCommentInput,
})
export const deleteComment = EFFRONT.ServerFn.make({
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
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({ ...IssueIdentitySchema.fields, commentId: Schema.String }),
})
export const readLinks = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readDataLinks(ctx.scope, yield* dataWorkspaceId(ctx), input.issueId, ctx.projectId)
      return { ok: true as const, value }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
      }),
    ),
  input: IssueIdentitySchema,
})
export const addIssueLink = EFFRONT.ServerFn.make({
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
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({
    ...IssueIdentitySchema.fields,
    targetIssueId: Schema.String,
    type: Schema.Literals(['blocks', 'blocked_by', 'relates_to', 'duplicates']),
  }),
})
export const deleteIssueLink = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        const issueLinks = yield* readDataLinks(ctx.scope, yield* dataWorkspaceId(ctx), input.issueId, ctx.projectId)
        if (!issueLinks.some((entry) => entry.id === input.linkId)) {
          return yield* new ScopeError(HTTP_NOT_FOUND, 'Link not found on this issue.')
        }
        const deleted = yield* runCommand(ctx, (command) => links.deleteLink(command, { id: input.linkId }))
        const value = yield* decodeIssueCommandOk(deleted).pipe(
          Effect.mapError(
            (cause) => new ApiError('schema', HTTP_BAD_GATEWAY, 'The operation returned an invalid result.', cause),
          ),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({ ...IssueIdentitySchema.fields, linkId: Schema.String }),
})
export const shareIssue = EFFRONT.ServerFn.make({
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
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: IssueIdentitySchema,
})
export const readAttachments = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* readDataAttachments(ctx.scope, yield* dataWorkspaceId(ctx), input.issueId, ctx.projectId)
      return { ok: true as const, value }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
      }),
    ),
  input: IssueIdentitySchema,
})
const MAX_ATTACHMENT_LINK_LABEL_LENGTH = 200

const WikiAttachmentLink = Schema.Struct({ kind: Schema.Literal('wiki_ref'), wikiPageId: Schema.String })

const UrlAttachmentKind = Schema.Literal('url')

const AttachmentLinkLabel = Schema.optional(Schema.String.check(Schema.isMaxLength(MAX_ATTACHMENT_LINK_LABEL_LENGTH)))

const UrlAttachmentLink = Schema.Struct({
  kind: UrlAttachmentKind,
  url: Schema.URLFromString,
  label: AttachmentLinkLabel,
})

const AttachmentLinkInput = Schema.Struct({
  ...IssueIdentitySchema.fields,
  link: Schema.Union([WikiAttachmentLink, UrlAttachmentLink]),
})

export const addAttachmentLink = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        yield* authorizedIssue(ctx, input.issueId)
        const value = yield* runCommand(ctx, (command) =>
          files.createLinkAttachment(command, {
            ...input.link,
            ...(input.link.kind === 'url' ? { url: input.link.url.href } : {}),
            entityType: 'issue',
            entityId: input.issueId,
          }),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: AttachmentLinkInput,
})
export const deleteAttachment = EFFRONT.ServerFn.make({
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
        if (!attachments.some((entry) => entry.id === input.attachmentId)) {
          return yield* new ScopeError(HTTP_NOT_FOUND, 'Attachment not found on this issue.')
        }
        yield* runCommand(ctx, (command) => files.deleteStoredAttachment(command, input.attachmentId))
        const value = { ok: true as const }
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: Schema.Struct({ ...IssueIdentitySchema.fields, attachmentId: Schema.String }),
})
export const searchWikiAttachments = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
      const value = yield* searchDataWikiAttachments(ctx.scope, yield* dataWorkspaceId(ctx), input.query)
      return { ok: true as const, value: [...value] }
    }).pipe(
      Effect.catchTags({
        ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
      }),
    ),
  input: Schema.Struct({ ...SelectorFields, query: Schema.String }),
})
const SprintUpdatePatch = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(MIN_REQUIRED_INPUT_LENGTH)),
  goal: Schema.NullOr(Schema.String),
  status: Schema.Literals(['planned', 'active', 'completed']),
  startDate: Schema.NullOr(Schema.Number),
  endDate: Schema.NullOr(Schema.Number),
})

const UpdateSprintInput = Schema.Struct({
  ...SelectorFields,
  sprintId: Schema.String,
  patch: SprintUpdatePatch,
})

export const updateSprint = EFFRONT.ServerFn.make({
  handler: (input) =>
    Effect.gen(function* () {
      const services = yield* RequestServices
      return yield* Effect.gen(function* () {
        yield* checkSameOriginMutation(services.request)
        const ctx = yield* resolveFunctionContext(input, { requireWorkspace: true })
        const updated = yield* runCommand(ctx, (command) => sprints.updateSprint(command, input.sprintId, input.patch))
        const value = yield* decodeIssueCommandOk(updated).pipe(
          Effect.mapError(
            (cause) => new ApiError('schema', HTTP_BAD_GATEWAY, 'The operation returned an invalid result.', cause),
          ),
        )
        return { ok: true as const, value }
      }).pipe(
        Effect.catchTags({
          ApiError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
          ScopeError: (error) => Effect.succeed(actionFailure(error.status, error.message)),
        }),
        Effect.ensuring(services.invalidate),
      )
    }),
  input: UpdateSprintInput,
})
