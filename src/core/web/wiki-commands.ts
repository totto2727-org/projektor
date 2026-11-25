import { Effect, Schema } from 'effect'

import type { ServiceCtx } from '#commands/types.ts'
import * as drafts from '#commands/wiki-drafts.ts'
import * as wiki from '#commands/wiki.ts'
import { ApiError } from '#contracts/errors.ts'
import { HTTP_BAD_REQUEST, HTTP_INTERNAL_SERVER_ERROR, HTTP_NOT_FOUND } from '#contracts/http-status.ts'
import { VersionedWikiDraftInputSchema, WikiDraftRevisionInputSchema } from '#contracts/inputs/wiki.ts'
import { MILLISECONDS_PER_SECOND } from '#contracts/time.ts'
import {
  Created,
  Deleted,
  DraftState,
  DraftRevision,
  Ok,
  Page,
  Published,
  Restored,
  SavedDraft,
  Verified,
} from '#contracts/web-schemas/wiki.ts'
import type { CoreReply } from '#core/contract.ts'
import { coreFailure, coreReply } from '#core/contract.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import * as data from '#services/wiki.ts'

import type { BrowserCommand } from './command-contract.ts'
import { browserCommand } from './command.ts'
import { pageFreshness, readAuthorizedWikiPage } from './wiki-policy.ts'

export const WikiDiffSchema = Schema.Struct({ diff: Schema.String })

export const makeWikiCommandHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => {
  const mutation = function mutation<S extends Schema.Top, A>(
    name: string,
    schema: S,
    proof: BrowserCommand,
    operation: (ctx: ServiceCtx) => Promise<A>,
  ): CoreReply<R, S> {
    return Effect.flatMap(envSource, (env) => coreReply(name, schema, browserCommand(env, proof, operation)))
  }
  const read = function read<S extends Schema.Top, A, E>(
    name: string,
    schema: S,
    proof: BrowserCommand,
    operation: (env: CoreEnvironment, scope: import('./scope').RequestScope) => Effect.Effect<A, E>,
  ): CoreReply<R, S> {
    return Effect.flatMap(envSource, (env) =>
      coreReply(
        name,
        schema,
        Effect.gen(function* () {
          const scope = yield* importScope(env, proof)
          return yield* operation(env, scope).pipe(Effect.mapError(publicWebFailure))
        }),
      ),
    )
  }
  return {
    webWikiPage: (proof: BrowserCommand, slug: string): CoreReply<R> =>
      read('webWikiPage', Page, proof, (env, scope) =>
        Effect.gen(function* () {
          const { workspace, page } = yield* readAuthorizedWikiPage(env.DB, scope, slug)
          return {
            ...page,
            revisionId: yield* data.getLatestWikiRevisionId(env.DB, workspace.id, page.id),
            freshness: pageFreshness(page),
          }
        }),
      ),
    webWikiDiff: (proof: BrowserCommand, slug: string, revisionId: string): CoreReply<R> =>
      read('webWikiDiff', WikiDiffSchema, proof, (env, scope) =>
        Effect.gen(function* () {
          const { workspace, page } = yield* readAuthorizedWikiPage(env.DB, scope, slug)
          const revision = yield* data.getWikiRevision(env.DB, workspace.id, page.id, revisionId)
          if (!revision) {
            return yield* new ApiError('http', HTTP_NOT_FOUND, 'Revision not found.')
          }
          return { diff: data.buildUnifiedDiff(revision.content, page.content) }
        }),
      ),
    webWikiDraft: (proof: BrowserCommand, slug: string): CoreReply<R> =>
      read('webWikiDraft', DraftState, proof, (env, scope) =>
        Effect.gen(function* () {
          const { workspace, page } = yield* readAuthorizedWikiPage(env.DB, scope, slug)
          return yield* Effect.tryPromise({
            catch: (cause) =>
              new ApiError('network', HTTP_INTERNAL_SERVER_ERROR, 'Could not read the saved draft.', cause),
            try: async () => drafts.readWikiDraftState(env.DB, workspace.id, page.id, scope.user.id),
          })
        }),
      ),
    webCreateWikiPage: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      mutation('webCreateWikiPage', Created, proof, async (ctx) => wiki.createWikiPage(ctx, input)),
    webUpdateWikiPage: (proof: BrowserCommand, slug: string, input: unknown): CoreReply<R> =>
      mutation('webUpdateWikiPage', Ok, proof, async (ctx) => wiki.updateWikiPage(ctx, slug, input)),
    webPublishWikiPage: (proof: BrowserCommand, slug: string, input: unknown): CoreReply<R> =>
      mutation('webPublishWikiPage', Published, proof, async (ctx) => {
        const reserved = await drafts.beginWikiDraftPublish(ctx, slug, input)
        await wiki.updateWikiPage(ctx, slug, reserved.input)
        return drafts.finishWikiDraftPublish(ctx, reserved.pageId, reserved.revision).catch((cause: unknown) => {
          console.error('[core] wiki draft cleanup failed after publication', cause)
          return { ok: true as const, draftRevision: null }
        })
      }),
    webSaveWikiDraft: (proof: BrowserCommand, slug: string, input: unknown): CoreReply<R> =>
      mutation('webSaveWikiDraft', SavedDraft, proof, async (ctx) => {
        const parsed = VersionedWikiDraftInputSchema.safeParse(input)
        if (!parsed.success) {
          throw coreFailure(HTTP_BAD_REQUEST, 'A draft revision precondition is required.')
        }
        return drafts.saveWikiDraft(ctx, slug, parsed.data)
      }),
    webDiscardWikiDraft: (proof: BrowserCommand, slug: string, input: unknown): CoreReply<R> =>
      mutation('webDiscardWikiDraft', DraftRevision, proof, async (ctx) => {
        const parsed = WikiDraftRevisionInputSchema.safeParse(input)
        if (!parsed.success) {
          throw coreFailure(HTTP_BAD_REQUEST, 'A draft revision precondition is required.')
        }
        return drafts.discardWikiDraft(ctx, slug, parsed.data)
      }),
    webVerifyWikiPage: (proof: BrowserCommand, slug: string): CoreReply<R> =>
      mutation('webVerifyWikiPage', Verified, proof, async (ctx) => wiki.verifyWikiPage(ctx, slug)),
    webDeleteWikiPage: (proof: BrowserCommand, slug: string, input: unknown): CoreReply<R> =>
      mutation('webDeleteWikiPage', Deleted, proof, async (ctx) => wiki.deleteWikiPage(ctx, slug, input)),
    webUndeleteWikiPage: (proof: BrowserCommand, id: string): CoreReply<R> =>
      mutation('webUndeleteWikiPage', Restored, proof, async (ctx) => wiki.undeleteWikiPage(ctx, id)),
    webRestoreWikiRevision: (
      proof: BrowserCommand,
      slug: string,
      revisionId: string,
      baseRevisionId: string | null,
    ): CoreReply<R> =>
      mutation('webRestoreWikiRevision', Ok, proof, async (ctx) => {
        const page = await Effect.runPromise(data.findWikiPage(ctx.db, ctx.workspaceId, slug))
        if (!page) {
          throw coreFailure(HTTP_NOT_FOUND, 'Wiki page not found.')
        }
        const revision = await Effect.runPromise(data.getWikiRevision(ctx.db, ctx.workspaceId, page.id, revisionId))
        if (!revision) {
          throw coreFailure(HTTP_NOT_FOUND, 'Revision not found.')
        }
        return wiki.updateWikiPage(ctx, slug, {
          content: revision.content,
          baseRevisionId,
          summary: `Restored from revision dated ${new Date(revision.created_at * MILLISECONDS_PER_SECOND).toISOString()}`,
        })
      }),
  }
}

import { requireDataWorkspace } from '#contracts/web-data.ts'

import { loadBrowserScope, publicWebFailure } from './authentication.ts'
import { checked } from './issue-data.ts'
function importScope(env: CoreEnvironment, proof: BrowserCommand) {
  return Effect.gen(function* () {
    const scope = yield* loadBrowserScope(env, proof.request, {
      workspaceHint: proof.workspaceSlug,
      projectHint: proof.projectId ?? '',
      requireWorkspace: true,
    })
    yield* checked(() => requireDataWorkspace(scope))
    return scope
  })
}
