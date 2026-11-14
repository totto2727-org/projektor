import {
  CommandIdSchema,
  CommandOkSchema,
  CreatedIssueSchema,
  CreatedLinkAttachmentSchema,
  ShareTokenSchema,
} from '../../../core/web/command-contract'
import { coreResult } from '../../core'
import type { BrowserCommandClient } from '../../server/browser-command'

export const issues = {
  createIssue: ({ core, proof }: BrowserCommandClient, input: unknown) =>
    coreResult(CreatedIssueSchema, core.webCreateIssue(proof, input)),
  updateIssue: ({ core, proof }: BrowserCommandClient, id: string, input: unknown) =>
    coreResult(CommandOkSchema, core.webUpdateIssue(proof, id, input)),
}
export const comments = {
  addComment: ({ core, proof }: BrowserCommandClient, input: unknown) =>
    coreResult(CommandIdSchema, core.webAddComment(proof, input)),
  updateComment: ({ core, proof }: BrowserCommandClient, input: unknown) =>
    coreResult(CommandOkSchema, core.webUpdateComment(proof, input)),
  deleteComment: ({ core, proof }: BrowserCommandClient, input: unknown) =>
    coreResult(CommandOkSchema, core.webDeleteComment(proof, input)),
}
export const links = {
  createLink: ({ core, proof }: BrowserCommandClient, input: unknown) =>
    coreResult(CommandIdSchema, core.webCreateIssueLink(proof, input)),
  deleteLink: ({ core, proof }: BrowserCommandClient, input: unknown) =>
    coreResult(CommandOkSchema, core.webDeleteIssueLink(proof, input)),
}
export const files = {
  createLinkAttachment: ({ core, proof }: BrowserCommandClient, input: unknown) =>
    coreResult(CreatedLinkAttachmentSchema, core.webCreateLinkAttachment(proof, input)),
  deleteStoredAttachment: ({ core, proof }: BrowserCommandClient, id: string) =>
    coreResult(CommandOkSchema, core.webDeleteStoredAttachment(proof, id)),
}
export const sprints = {
  updateSprint: ({ core, proof }: BrowserCommandClient, id: string, input: unknown) =>
    coreResult(CommandOkSchema, core.webUpdateSprint(proof, id, input)),
}
export const createShareToken = ({ core, proof }: BrowserCommandClient, id: string) =>
  coreResult(ShareTokenSchema, core.webCreateShareToken(proof, id))
