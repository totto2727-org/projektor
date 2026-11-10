import { and, eq, inArray, isNull } from 'drizzle-orm'

// PROJ-495 (R13): server-side per-user drafts, replacing the PROJ-227 localStorage
// autosave so an in-progress edit survives a device switch.
//
// No dependency on services/wiki.ts (avoids a circular import — wiki.ts calls into
// this file's deleteWikiDraftsForPages on delete). Page resolution + visibility checks
// are duplicated in miniature here rather than imported, mirroring
// services/wiki-watchers.ts's resolveWatchTarget precedent.
import { drizzle, schema } from '#db'

import {
  SaveWikiDraftInputSchema,
  VersionedWikiDraftInputSchema,
  WikiDraftRevisionInputSchema,
} from '../../contracts/inputs/wiki'
import { assertProjectAccess } from './access'
import { ConflictError, NotFoundError, ValidationError } from './errors'
import { inChunks } from './sql'
import type { ServiceCtx } from './types'
import { idFirst, idOrSlugMatch } from './wiki-lookup'

type ResolvedDraftTarget = {
  id: string
  slug: string
}

// PROJ-495: same id-or-slug + redirect-fallback resolution as services/wiki.ts's
// resolvePageByIdOrSlug, plus the same project-visibility check — duplicated (not
// imported) to avoid a circular import, see module comment above.
async function resolveDraftTarget(ctx: ServiceCtx, idOrSlug: string): Promise<ResolvedDraftTarget> {
  const orm = drizzle(ctx.db, { schema })
  const direct = await orm
    .select({
      id: schema.wikiPages.id,
      slug: schema.wikiPages.slug,
      projectId: schema.wikiPages.projectId,
    })
    .from(schema.wikiPages)
    .where(
      and(
        idOrSlugMatch(idOrSlug),
        eq(schema.wikiPages.workspaceId, ctx.workspaceId),
        // PROJ-496: no drafts on a trashed page — same "trashed = gone" rule as every
        // other page reference entry point (services/wiki.ts).
        isNull(schema.wikiPages.deletedAt),
      ),
    )
    .orderBy(idFirst(idOrSlug))
    .get()

  let page = direct
  if (!page) {
    const redirect = await orm
      .select({ pageId: schema.wikiRedirects.pageId })
      .from(schema.wikiRedirects)
      .where(and(eq(schema.wikiRedirects.workspaceId, ctx.workspaceId), eq(schema.wikiRedirects.oldSlug, idOrSlug)))
      .get()
    if (redirect) {
      page = await orm
        .select({
          id: schema.wikiPages.id,
          slug: schema.wikiPages.slug,
          projectId: schema.wikiPages.projectId,
        })
        .from(schema.wikiPages)
        .where(
          and(
            eq(schema.wikiPages.id, redirect.pageId),
            eq(schema.wikiPages.workspaceId, ctx.workspaceId),
            isNull(schema.wikiPages.deletedAt),
          ),
        )
        .get()
    }
  }
  if (!page) throw new NotFoundError('Wiki page not found')

  if (page.projectId !== null) {
    await assertProjectAccess(ctx, page.projectId, 'read', {
      notFoundMessage: 'Wiki page not found',
      projectLoadedFromWorkspaceRow: true,
    })
  }
  return { id: page.id, slug: page.slug }
}

// PROJ-495: returns null (not 404) when the caller has no draft for this page — "no
// draft yet" is the expected common case, not an error.
export async function getWikiDraft(ctx: ServiceCtx, idOrSlug: string) {
  const page = await resolveDraftTarget(ctx, idOrSlug)
  const orm = drizzle(ctx.db, { schema })
  const row = await orm
    .select({
      title: schema.wikiDrafts.title,
      content: schema.wikiDrafts.content,
      baseRevisionId: schema.wikiDrafts.baseRevisionId,
      updatedAt: schema.wikiDrafts.updatedAt,
    })
    .from(schema.wikiDrafts)
    .where(
      and(
        eq(schema.wikiDrafts.workspaceId, ctx.workspaceId),
        eq(schema.wikiDrafts.userId, ctx.userId),
        eq(schema.wikiDrafts.pageId, page.id),
      ),
    )
    .get()
  return row ?? null
}

// The head and scratch snapshot are read together, including after a discard removed
// the scratch row. Only Core calls this after authorizing the page and current user.
export async function readWikiDraftState(db: D1Database, workspaceId: string, pageId: string, userId: string) {
  const row = await db
    .prepare(`
    SELECT h.revision, d.title, d.content, d.base_revision_id AS baseRevisionId, d.updated_at AS updatedAt
    FROM wiki_pages p
    LEFT JOIN wiki_draft_heads h ON h.workspace_id = p.workspace_id AND h.page_id = p.id AND h.user_id = ?
    LEFT JOIN wiki_drafts d ON d.workspace_id = p.workspace_id AND d.page_id = p.id AND d.user_id = ?
    WHERE p.workspace_id = ? AND p.id = ?
  `)
    .bind(userId, userId, workspaceId, pageId)
    .first<{
      revision: string | null
      title: string | null
      content: string | null
      baseRevisionId: string | null
      updatedAt: number | null
    }>()
  return {
    revision: row?.revision ?? null,
    draft:
      row && row.title !== null && row.content !== null && row.updatedAt !== null
        ? { title: row.title, content: row.content, baseRevisionId: row.baseRevisionId, updatedAt: row.updatedAt }
        : null,
  }
}

function advanceHead(ctx: ServiceCtx, pageId: string, expected: string | null | undefined, revision: string) {
  const key = [ctx.workspaceId, ctx.userId, pageId]
  if (expected === undefined) {
    // Existing REST/MCP callers remain last-write-wins, but invalidate any older
    // versioned browser request rather than bypassing the head.
    return ctx.db
      .prepare(`INSERT INTO wiki_draft_heads(workspace_id,user_id,page_id,revision) VALUES (?,?,?,?)
      ON CONFLICT(workspace_id,user_id,page_id) DO UPDATE SET revision = excluded.revision RETURNING revision`)
      .bind(...key, revision)
  }
  if (expected === null) {
    return ctx.db
      .prepare(`INSERT INTO wiki_draft_heads(workspace_id,user_id,page_id,revision) VALUES (?,?,?,?)
      ON CONFLICT(workspace_id,user_id,page_id) DO NOTHING RETURNING revision`)
      .bind(...key, revision)
  }
  return ctx.db
    .prepare(`UPDATE wiki_draft_heads SET revision = ?
    WHERE workspace_id = ? AND user_id = ? AND page_id = ? AND revision = ? RETURNING revision`)
    .bind(revision, ...key, expected)
}

function requireAdvanced(result: D1Result, revision: string) {
  if (
    !result.results.some(
      (row) => typeof row === 'object' && row !== null && 'revision' in row && row.revision === revision,
    )
  ) {
    throw new ConflictError('The saved draft changed. Reload its current state before saving again.')
  }
}

export async function saveWikiDraft(ctx: ServiceCtx, idOrSlug: string, input: unknown) {
  const parsed = SaveWikiDraftInputSchema.safeParse(input)
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())
  const page = await resolveDraftTarget(ctx, idOrSlug)
  const revision = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const results = await ctx.db.batch([
    advanceHead(ctx, page.id, parsed.data.expectedDraftRevision, revision),
    ctx.db
      .prepare(`INSERT INTO wiki_drafts(id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM wiki_draft_heads WHERE workspace_id = ? AND user_id = ? AND page_id = ? AND revision = ?
      ) ON CONFLICT(workspace_id,user_id,page_id) DO UPDATE SET
        title = excluded.title, content = excluded.content, base_revision_id = excluded.base_revision_id, updated_at = excluded.updated_at`)
      .bind(
        crypto.randomUUID(),
        ctx.workspaceId,
        ctx.userId,
        page.id,
        parsed.data.title,
        parsed.data.content,
        parsed.data.baseRevisionId ?? null,
        now,
        ctx.workspaceId,
        ctx.userId,
        page.id,
        revision,
      ),
  ])
  requireAdvanced(results[0], revision)
  return { ok: true as const, pageId: page.id, updatedAt: now, revision }
}

async function discardResolvedDraft(ctx: ServiceCtx, pageId: string, expected: string | null | undefined) {
  const revision = crypto.randomUUID()
  const results = await ctx.db.batch([
    advanceHead(ctx, pageId, expected, revision),
    ctx.db
      .prepare(`DELETE FROM wiki_drafts WHERE workspace_id = ? AND user_id = ? AND page_id = ? AND EXISTS (
      SELECT 1 FROM wiki_draft_heads WHERE workspace_id = ? AND user_id = ? AND page_id = ? AND revision = ?
    )`)
      .bind(ctx.workspaceId, ctx.userId, pageId, ctx.workspaceId, ctx.userId, pageId, revision),
  ])
  requireAdvanced(results[0], revision)
  return { ok: true as const, revision }
}

export async function discardWikiDraft(ctx: ServiceCtx, idOrSlug: string, input?: unknown) {
  let expected: string | null | undefined
  if (input !== undefined) {
    const parsed = WikiDraftRevisionInputSchema.safeParse(input)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())
    expected = parsed.data.expectedDraftRevision
  }
  const page = await resolveDraftTarget(ctx, idOrSlug)
  return discardResolvedDraft(ctx, page.id, expected)
}

// Publication invalidates older writers first, without deleting recoverable text
// if the page update fails. A newly accepted draft must survive its later cleanup.
export async function beginWikiDraftPublish(ctx: ServiceCtx, idOrSlug: string, input: unknown) {
  const parsed = VersionedWikiDraftInputSchema.safeParse(input)
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())
  const page = await resolveDraftTarget(ctx, idOrSlug)
  const revision = crypto.randomUUID()
  const result = await advanceHead(ctx, page.id, parsed.data.expectedDraftRevision, revision).all()
  requireAdvanced(result, revision)
  return { pageId: page.id, revision, input: parsed.data }
}

export async function finishWikiDraftPublish(ctx: ServiceCtx, pageId: string, reservedRevision: string) {
  const page = await resolveDraftTarget(ctx, pageId)
  try {
    const result = await discardResolvedDraft(ctx, page.id, reservedRevision)
    return { ok: true as const, draftRevision: result.revision }
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error
    // Another editor has advanced the head. Publication succeeded, but this
    // caller must reconcile that draft rather than overwrite it automatically.
    return { ok: true as const, draftRevision: null }
  }
}

// PROJ-495: app-level mirror of wiki_drafts.page_id's ON DELETE CASCADE, called from
// services/wiki.ts#purgeExpiredWikiPages (PROJ-496: draft cleanup moved from delete
// time to purge time) — same belt-and-braces precedent as
// wiki-watchers.ts#deleteWikiWatchersForPages (PROJ-407: D1 doesn't guarantee FK
// enforcement on every connection).
export async function deleteWikiDraftsForPages(ctx: ServiceCtx, pageIds: string[]): Promise<void> {
  if (pageIds.length === 0) return
  const orm = drizzle(ctx.db, { schema })
  await inChunks(pageIds, async (chunk) => {
    await orm
      .delete(schema.wikiDrafts)
      .where(and(eq(schema.wikiDrafts.workspaceId, ctx.workspaceId), inArray(schema.wikiDrafts.pageId, chunk)))
    await orm
      .delete(schema.wikiDraftHeads)
      .where(and(eq(schema.wikiDraftHeads.workspaceId, ctx.workspaceId), inArray(schema.wikiDraftHeads.pageId, chunk)))
    return []
  })
}
