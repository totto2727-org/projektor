import { Effect, Schema } from 'effect'

import * as comments from '#commands/comments'
import * as files from '#commands/files'
import * as links from '#commands/issue-links'
import * as issues from '#commands/issues'
import { createShareToken } from '#commands/share'
import * as sprints from '#commands/sprints'
import type { ServiceCtx } from '#commands/types'

import { coreReply } from '../contract'
import type { CoreEnvironment } from '../environment'
import { browserCommand } from './command'
import {
  CommandIdSchema,
  CommandOkSchema,
  CreatedIssueSchema,
  CreatedLinkAttachmentSchema,
  ShareTokenSchema,
  type BrowserCommand,
} from './command-contract'

export const makeIssueCommandHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => {
  function reply<S extends Schema.Top, A>(
    name: string,
    schema: S,
    proof: BrowserCommand,
    operation: (ctx: ServiceCtx) => Promise<A>,
  ) {
    return Effect.flatMap(envSource, (env) => coreReply(name, schema, browserCommand(env, proof, operation)))
  }
  return {
    webCreateIssue: (proof: BrowserCommand, input: unknown) =>
      reply('webCreateIssue', CreatedIssueSchema, proof, (ctx) => issues.createIssue(ctx, input)),
    webUpdateIssue: (proof: BrowserCommand, id: string, input: unknown) =>
      reply('webUpdateIssue', CommandOkSchema, proof, (ctx) => issues.updateIssue(ctx, id, input)),
    webAddComment: (proof: BrowserCommand, input: unknown) =>
      reply('webAddComment', CommandIdSchema, proof, (ctx) => comments.addComment(ctx, input)),
    webUpdateComment: (proof: BrowserCommand, input: unknown) =>
      reply('webUpdateComment', CommandOkSchema, proof, (ctx) => comments.updateComment(ctx, input)),
    webDeleteComment: (proof: BrowserCommand, input: unknown) =>
      reply('webDeleteComment', CommandOkSchema, proof, (ctx) => comments.deleteComment(ctx, input)),
    webCreateIssueLink: (proof: BrowserCommand, input: unknown) =>
      reply('webCreateIssueLink', CommandIdSchema, proof, (ctx) => links.createLink(ctx, input)),
    webDeleteIssueLink: (proof: BrowserCommand, input: unknown) =>
      reply('webDeleteIssueLink', CommandOkSchema, proof, (ctx) => links.deleteLink(ctx, input)),
    webCreateShareToken: (proof: BrowserCommand, issueId: string) =>
      reply('webCreateShareToken', ShareTokenSchema, proof, (ctx) => createShareToken(ctx, issueId)),
    webCreateLinkAttachment: (proof: BrowserCommand, input: unknown) =>
      reply('webCreateLinkAttachment', CreatedLinkAttachmentSchema, proof, (ctx) =>
        files.createLinkAttachment(ctx, input),
      ),
    webDeleteStoredAttachment: (proof: BrowserCommand, id: string) =>
      reply('webDeleteStoredAttachment', CommandOkSchema, proof, async (ctx) => {
        await files.deleteStoredAttachment(ctx, id)
        return { ok: true }
      }),
    webSetAttachmentReviewStatus: (proof: BrowserCommand, input: unknown) =>
      reply('webSetAttachmentReviewStatus', CommandOkSchema, proof, (ctx) =>
        files.setAttachmentReviewStatus(ctx, input),
      ),
    webUpdateSprint: (proof: BrowserCommand, id: string, input: unknown) =>
      reply('webUpdateSprint', CommandOkSchema, proof, (ctx) => sprints.updateSprint(ctx, id, input)),
  }
}
