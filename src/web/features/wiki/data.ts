import { Effect, Schema } from 'effect'

import { coreResult } from '../../core'
import { runBrowserCommand, type BrowserCommandClient } from '../../server/browser-command'
import type { FunctionContext } from '../../server/function-context'
import { files } from '../issues/commands'
import {
  Created,
  Deleted,
  DraftRevision,
  DraftState,
  Ok,
  Page,
  Published,
  Restored,
  SavedDraft,
  Verified,
} from './schemas'

export const wikiCommands = {
  createWikiPage: ({ core, proof }: BrowserCommandClient, input: unknown) =>
    coreResult(Created, core.webCreateWikiPage(proof, input)),
  updateWikiPage: ({ core, proof }: BrowserCommandClient, slug: string, input: unknown) =>
    coreResult(Ok, core.webUpdateWikiPage(proof, slug, input)),
  publishWikiPage: ({ core, proof }: BrowserCommandClient, slug: string, input: unknown) =>
    coreResult(Published, core.webPublishWikiPage(proof, slug, input)),
  verifyWikiPage: ({ core, proof }: BrowserCommandClient, slug: string) =>
    coreResult(Verified, core.webVerifyWikiPage(proof, slug)),
  deleteWikiPage: ({ core, proof }: BrowserCommandClient, slug: string, input: unknown) =>
    coreResult(Deleted, core.webDeleteWikiPage(proof, slug, input)),
  undeleteWikiPage: ({ core, proof }: BrowserCommandClient, id: string) =>
    coreResult(Restored, core.webUndeleteWikiPage(proof, id)),
  restoreWikiRevision: (
    { core, proof }: BrowserCommandClient,
    slug: string,
    revisionId: string,
    baseRevisionId: string | null,
  ) => coreResult(Ok, core.webRestoreWikiRevision(proof, slug, revisionId, baseRevisionId)),
}
export const wikiDraftCommands = {
  saveWikiDraft: ({ core, proof }: BrowserCommandClient, slug: string, input: unknown) =>
    coreResult(SavedDraft, core.webSaveWikiDraft(proof, slug, input)),
  discardWikiDraft: ({ core, proof }: BrowserCommandClient, slug: string, input: unknown) =>
    coreResult(DraftRevision, core.webDiscardWikiDraft(proof, slug, input)),
}
export const deleteStoredAttachment = files.deleteStoredAttachment
export const readWikiPage = (context: FunctionContext, slug: string) =>
  runBrowserCommand(context, ({ core, proof }) => coreResult(Page, core.webWikiPage(proof, slug)))
export const readWikiDraftState = (context: FunctionContext, slug: string) =>
  runBrowserCommand(context, ({ core, proof }) => coreResult(DraftState, core.webWikiDraft(proof, slug)))
export const readWikiDraft = (context: FunctionContext, slug: string) =>
  readWikiDraftState(context, slug).pipe(Effect.map((state) => state.draft))
export const readWikiDiff = (context: FunctionContext, slug: string, revisionId: string) =>
  runBrowserCommand(context, ({ core, proof }) =>
    coreResult(Schema.Struct({ diff: Schema.String }), core.webWikiDiff(proof, slug, revisionId)),
  )
