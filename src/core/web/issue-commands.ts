import { Effect } from 'effect'
import type { Schema } from 'effect'

import * as comments from '#commands/comments.ts'
import * as files from '#commands/files.ts'
import * as links from '#commands/issue-links.ts'
import * as issues from '#commands/issues.ts'
import { createShareToken } from '#commands/share.ts'
import * as sprints from '#commands/sprints.ts'
import type { ServiceCtx } from '#commands/types.ts'
import type { CoreReply } from '#core/contract.ts'
import { coreReply } from '#core/contract.ts'
import type { CoreEnvironment } from '#core/environment.ts'

import {
  CommandIdSchema,
  CommandOkSchema,
  CreatedIssueSchema,
  CreatedLinkAttachmentSchema,
  ShareTokenSchema,
} from './command-contract.ts'
import type { BrowserCommand } from './command-contract.ts'
import { browserCommand } from './command.ts'

interface IssueCommandHandlers<R> {
  webCreateIssue: (proof: BrowserCommand, input: unknown) => CoreReply<R>
  webUpdateIssue: (proof: BrowserCommand, id: string, input: unknown) => CoreReply<R>
  webAddComment: (proof: BrowserCommand, input: unknown) => CoreReply<R>
  webUpdateComment: (proof: BrowserCommand, input: unknown) => CoreReply<R>
  webDeleteComment: (proof: BrowserCommand, input: unknown) => CoreReply<R>
  webCreateIssueLink: (proof: BrowserCommand, input: unknown) => CoreReply<R>
  webDeleteIssueLink: (proof: BrowserCommand, input: unknown) => CoreReply<R>
  webCreateShareToken: (proof: BrowserCommand, issueId: string) => CoreReply<R>
  webCreateLinkAttachment: (proof: BrowserCommand, input: unknown) => CoreReply<R>
  webDeleteStoredAttachment: (proof: BrowserCommand, id: string) => CoreReply<R>
  webSetAttachmentReviewStatus: (proof: BrowserCommand, input: unknown) => CoreReply<R>
  webUpdateSprint: (proof: BrowserCommand, id: string, input: unknown) => CoreReply<R>
}

export const makeIssueCommandHandlers = <R>(
  envSource: Effect.Effect<CoreEnvironment, never, R>,
): IssueCommandHandlers<R> => {
  const reply = function reply<S extends Schema.Top, A>(
    name: string,
    schema: S,
    proof: BrowserCommand,
    operation: (ctx: ServiceCtx) => Promise<A>,
  ): CoreReply<R, S> {
    return Effect.flatMap(envSource, (env) => coreReply(name, schema, browserCommand(env, proof, operation)))
  }
  return {
    webCreateIssue: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      reply('webCreateIssue', CreatedIssueSchema, proof, async (ctx) => issues.createIssue(ctx, input)),
    webUpdateIssue: (proof: BrowserCommand, id: string, input: unknown): CoreReply<R> =>
      reply('webUpdateIssue', CommandOkSchema, proof, async (ctx) => issues.updateIssue(ctx, id, input)),
    webAddComment: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      reply('webAddComment', CommandIdSchema, proof, async (ctx) => comments.addComment(ctx, input)),
    webUpdateComment: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      reply('webUpdateComment', CommandOkSchema, proof, async (ctx) => comments.updateComment(ctx, input)),
    webDeleteComment: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      reply('webDeleteComment', CommandOkSchema, proof, async (ctx) => comments.deleteComment(ctx, input)),
    webCreateIssueLink: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      reply('webCreateIssueLink', CommandIdSchema, proof, async (ctx) => links.createLink(ctx, input)),
    webDeleteIssueLink: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      reply('webDeleteIssueLink', CommandOkSchema, proof, async (ctx) => links.deleteLink(ctx, input)),
    webCreateShareToken: (proof: BrowserCommand, issueId: string): CoreReply<R> =>
      reply('webCreateShareToken', ShareTokenSchema, proof, async (ctx) => createShareToken(ctx, issueId)),
    webCreateLinkAttachment: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      reply('webCreateLinkAttachment', CreatedLinkAttachmentSchema, proof, async (ctx) =>
        files.createLinkAttachment(ctx, input),
      ),
    webDeleteStoredAttachment: (proof: BrowserCommand, id: string): CoreReply<R> =>
      reply('webDeleteStoredAttachment', CommandOkSchema, proof, async (ctx) => {
        await files.deleteStoredAttachment(ctx, id)
        return { ok: true }
      }),
    webSetAttachmentReviewStatus: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      reply('webSetAttachmentReviewStatus', CommandOkSchema, proof, async (ctx) =>
        files.setAttachmentReviewStatus(ctx, input),
      ),
    webUpdateSprint: (proof: BrowserCommand, id: string, input: unknown): CoreReply<R> =>
      reply('webUpdateSprint', CommandOkSchema, proof, async (ctx) => sprints.updateSprint(ctx, id, input)),
  }
}
