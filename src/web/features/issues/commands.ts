import {
  CommandIdSchema,
  CommandOkSchema,
  CreatedIssueSchema,
  CreatedLinkAttachmentSchema,
  ShareTokenSchema,
} from '#core/web/command-contract.ts'
import { coreResult } from '@/core.ts'
import type { CoreResult } from '@/core.ts'
import type { BrowserCommandClient } from '@/server/browser-command.ts'

export const issues = {
  createIssue: ({ core, proof }: BrowserCommandClient, input: unknown): CoreResult<typeof CreatedIssueSchema.Type> =>
    coreResult(CreatedIssueSchema, core.webCreateIssue(proof, input)),
  updateIssue: (
    { core, proof }: BrowserCommandClient,
    id: string,
    input: unknown,
  ): CoreResult<typeof CommandOkSchema.Type> => coreResult(CommandOkSchema, core.webUpdateIssue(proof, id, input)),
}
export const comments = {
  addComment: ({ core, proof }: BrowserCommandClient, input: unknown): CoreResult<typeof CommandIdSchema.Type> =>
    coreResult(CommandIdSchema, core.webAddComment(proof, input)),
  updateComment: ({ core, proof }: BrowserCommandClient, input: unknown): CoreResult<typeof CommandOkSchema.Type> =>
    coreResult(CommandOkSchema, core.webUpdateComment(proof, input)),
  deleteComment: ({ core, proof }: BrowserCommandClient, input: unknown): CoreResult<typeof CommandOkSchema.Type> =>
    coreResult(CommandOkSchema, core.webDeleteComment(proof, input)),
}
export const links = {
  createLink: ({ core, proof }: BrowserCommandClient, input: unknown): CoreResult<typeof CommandIdSchema.Type> =>
    coreResult(CommandIdSchema, core.webCreateIssueLink(proof, input)),
  deleteLink: ({ core, proof }: BrowserCommandClient, input: unknown): CoreResult<typeof CommandOkSchema.Type> =>
    coreResult(CommandOkSchema, core.webDeleteIssueLink(proof, input)),
}
export const files = {
  setAttachmentReviewStatus: (
    { core, proof }: BrowserCommandClient,
    input: unknown,
  ): CoreResult<typeof CommandOkSchema.Type> =>
    coreResult(CommandOkSchema, core.webSetAttachmentReviewStatus(proof, input)),
  createLinkAttachment: (
    { core, proof }: BrowserCommandClient,
    input: unknown,
  ): CoreResult<typeof CreatedLinkAttachmentSchema.Type> =>
    coreResult(CreatedLinkAttachmentSchema, core.webCreateLinkAttachment(proof, input)),
  deleteStoredAttachment: (
    { core, proof }: BrowserCommandClient,
    id: string,
  ): CoreResult<typeof CommandOkSchema.Type> => coreResult(CommandOkSchema, core.webDeleteStoredAttachment(proof, id)),
}
export const sprints = {
  updateSprint: (
    { core, proof }: BrowserCommandClient,
    id: string,
    input: unknown,
  ): CoreResult<typeof CommandOkSchema.Type> => coreResult(CommandOkSchema, core.webUpdateSprint(proof, id, input)),
}
export const createShareToken = (
  { core, proof }: BrowserCommandClient,
  id: string,
): CoreResult<typeof ShareTokenSchema.Type> => coreResult(ShareTokenSchema, core.webCreateShareToken(proof, id))
