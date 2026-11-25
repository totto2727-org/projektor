import { Effect, Schema } from 'effect'

import { coreResult } from '@/core.ts'
import type { CoreResult } from '@/core.ts'
import { files } from '@/features/issues/commands.ts'
import type { RequestServices } from '@/request.ts'
import { runBrowserCommand } from '@/server/browser-command.ts'
import type { BrowserCommandClient } from '@/server/browser-command.ts'
import type { FunctionContext } from '@/server/function-context.ts'

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
} from './schemas.ts'

type WikiReadResult<A> = CoreResult<A, RequestServices>

export const wikiCommands = {
  createWikiPage: ({ core, proof }: BrowserCommandClient, input: unknown): CoreResult<typeof Created.Type> =>
    coreResult(Created, core.webCreateWikiPage(proof, input)),
  updateWikiPage: ({ core, proof }: BrowserCommandClient, slug: string, input: unknown): CoreResult<typeof Ok.Type> =>
    coreResult(Ok, core.webUpdateWikiPage(proof, slug, input)),
  publishWikiPage: (
    { core, proof }: BrowserCommandClient,
    slug: string,
    input: unknown,
  ): CoreResult<typeof Published.Type> => coreResult(Published, core.webPublishWikiPage(proof, slug, input)),
  verifyWikiPage: ({ core, proof }: BrowserCommandClient, slug: string): CoreResult<typeof Verified.Type> =>
    coreResult(Verified, core.webVerifyWikiPage(proof, slug)),
  deleteWikiPage: (
    { core, proof }: BrowserCommandClient,
    slug: string,
    input: unknown,
  ): CoreResult<typeof Deleted.Type> => coreResult(Deleted, core.webDeleteWikiPage(proof, slug, input)),
  undeleteWikiPage: ({ core, proof }: BrowserCommandClient, id: string): CoreResult<typeof Restored.Type> =>
    coreResult(Restored, core.webUndeleteWikiPage(proof, id)),
  restoreWikiRevision: (
    { core, proof }: BrowserCommandClient,
    slug: string,
    revisionId: string,
    baseRevisionId: string | null,
  ): CoreResult<typeof Ok.Type> => coreResult(Ok, core.webRestoreWikiRevision(proof, slug, revisionId, baseRevisionId)),
}
export const wikiDraftCommands = {
  saveWikiDraft: (
    { core, proof }: BrowserCommandClient,
    slug: string,
    input: unknown,
  ): CoreResult<typeof SavedDraft.Type> => coreResult(SavedDraft, core.webSaveWikiDraft(proof, slug, input)),
  discardWikiDraft: (
    { core, proof }: BrowserCommandClient,
    slug: string,
    input: unknown,
  ): CoreResult<typeof DraftRevision.Type> => coreResult(DraftRevision, core.webDiscardWikiDraft(proof, slug, input)),
}
export const deleteStoredAttachment = files.deleteStoredAttachment
export const readWikiPage = (context: FunctionContext, slug: string): WikiReadResult<typeof Page.Type> =>
  runBrowserCommand(context, ({ core, proof }) => coreResult(Page, core.webWikiPage(proof, slug)))
export const readWikiDraftState = (context: FunctionContext, slug: string): WikiReadResult<typeof DraftState.Type> =>
  runBrowserCommand(context, ({ core, proof }) => coreResult(DraftState, core.webWikiDraft(proof, slug)))
export const readWikiDraft = (
  context: FunctionContext,
  slug: string,
): WikiReadResult<(typeof DraftState.Type)['draft']> =>
  readWikiDraftState(context, slug).pipe(Effect.map((state) => state.draft))
export const readWikiDiff = (
  context: FunctionContext,
  slug: string,
  revisionId: string,
): WikiReadResult<Readonly<{ diff: string }>> =>
  runBrowserCommand(context, ({ core, proof }) =>
    coreResult(Schema.Struct({ diff: Schema.String }), core.webWikiDiff(proof, slug, revisionId)),
  )
