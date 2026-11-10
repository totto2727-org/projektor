import { Effect, Schema } from 'effect'

import type { ServiceCtx } from '#commands/types'
import * as wiki from '#commands/wiki'
import * as drafts from '#commands/wiki-drafts'
import * as data from '#services/wiki'

import { ApiError } from '../../contracts/errors'
import { Created, Deleted, Draft, Ok, Page, Restored, SavedDraft, Verified } from '../../contracts/web-schemas/wiki'
import { coreFailure, coreReply } from '../contract'
import type { CoreEnvironment } from '../environment'
import { browserCommand } from './command'
import type { BrowserCommand } from './command-contract'
import { pageFreshness, readAuthorizedWikiPage } from './wiki-policy'

export const WikiDiffSchema = Schema.Struct({ diff: Schema.String })

export const makeWikiCommandHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => {
  function mutation<S extends Schema.Top, A>(
    name: string,
    schema: S,
    proof: BrowserCommand,
    operation: (ctx: ServiceCtx) => Promise<A>,
  ) {
    return Effect.flatMap(envSource, (env) => coreReply(name, schema, browserCommand(env, proof, operation)))
  }
  function read<S extends Schema.Top, A, E>(
    name: string,
    schema: S,
    proof: BrowserCommand,
    operation: (env: CoreEnvironment, scope: import('./scope').RequestScope) => Effect.Effect<A, E>,
  ) {
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
    webWikiPage: (proof: BrowserCommand, slug: string) =>
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
    webWikiDiff: (proof: BrowserCommand, slug: string, revisionId: string) =>
      read('webWikiDiff', WikiDiffSchema, proof, (env, scope) =>
        Effect.gen(function* () {
          const { workspace, page } = yield* readAuthorizedWikiPage(env.DB, scope, slug)
          const revision = yield* data.getWikiRevision(env.DB, workspace.id, page.id, revisionId)
          if (!revision) return yield* new ApiError('http', 404, 'Revision not found.')
          return { diff: data.buildUnifiedDiff(revision.content, page.content) }
        }),
      ),
    webWikiDraft: (proof: BrowserCommand, slug: string) =>
      read('webWikiDraft', Draft, proof, (env, scope) =>
        Effect.gen(function* () {
          const { workspace, page } = yield* readAuthorizedWikiPage(env.DB, scope, slug)
          return yield* data.getWikiDraft(env.DB, workspace.id, page.id, scope.user.id)
        }),
      ),
    webCreateWikiPage: (proof: BrowserCommand, input: unknown) =>
      mutation('webCreateWikiPage', Created, proof, (ctx) => wiki.createWikiPage(ctx, input)),
    webUpdateWikiPage: (proof: BrowserCommand, slug: string, input: unknown) =>
      mutation('webUpdateWikiPage', Ok, proof, (ctx) => wiki.updateWikiPage(ctx, slug, input)),
    webPublishWikiPage: (proof: BrowserCommand, slug: string, input: unknown) =>
      mutation('webPublishWikiPage', Ok, proof, async (ctx) => {
        const result = await wiki.updateWikiPage(ctx, slug, input)
        await drafts.discardWikiDraft(ctx, slug).catch(() => {
          console.error('[core] wiki draft cleanup failed after publication')
        })
        return result
      }),
    webSaveWikiDraft: (proof: BrowserCommand, slug: string, input: unknown) =>
      mutation('webSaveWikiDraft', SavedDraft, proof, (ctx) => drafts.saveWikiDraft(ctx, slug, input)),
    webDiscardWikiDraft: (proof: BrowserCommand, slug: string) =>
      mutation('webDiscardWikiDraft', Ok, proof, (ctx) => drafts.discardWikiDraft(ctx, slug)),
    webVerifyWikiPage: (proof: BrowserCommand, slug: string) =>
      mutation('webVerifyWikiPage', Verified, proof, (ctx) => wiki.verifyWikiPage(ctx, slug)),
    webDeleteWikiPage: (proof: BrowserCommand, slug: string, input: unknown) =>
      mutation('webDeleteWikiPage', Deleted, proof, (ctx) => wiki.deleteWikiPage(ctx, slug, input)),
    webUndeleteWikiPage: (proof: BrowserCommand, id: string) =>
      mutation('webUndeleteWikiPage', Restored, proof, (ctx) => wiki.undeleteWikiPage(ctx, id)),
    webRestoreWikiRevision: (proof: BrowserCommand, slug: string, revisionId: string, baseRevisionId: string | null) =>
      mutation('webRestoreWikiRevision', Ok, proof, async (ctx) => {
        const page = await Effect.runPromise(data.findWikiPage(ctx.db, ctx.workspaceId, slug))
        if (!page) throw coreFailure(404, 'Wiki page not found.')
        const revision = await Effect.runPromise(data.getWikiRevision(ctx.db, ctx.workspaceId, page.id, revisionId))
        if (!revision) throw coreFailure(404, 'Revision not found.')
        return wiki.updateWikiPage(ctx, slug, {
          content: revision.content,
          baseRevisionId,
          summary: `Restored from revision dated ${new Date(revision.created_at * 1000).toISOString()}`,
        })
      }),
  }
}

import { requireDataWorkspace } from '../../contracts/web-data'
import { loadBrowserScope, publicWebFailure } from './authentication'
import { checked } from './issue-data'
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
