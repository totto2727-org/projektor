import { and, eq, inArray } from 'drizzle-orm'
import { Array, Predicate } from 'effect'
import { flattenError } from 'zod'

import {
  SaveWikiDraftInputSchema,
  VersionedWikiDraftInputSchema,
  WikiDraftRevisionInputSchema,
} from '#contracts/inputs/wiki.ts'
import { JSON_NULL } from '#contracts/json-null.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { isWikiRevisionSpecified } from '#contracts/wiki-revision.ts'
/*
 * PROJ-495 (R13): server-side per-user drafts, replacing the PROJ-227 localStorage
 * autosave so an in-progress edit survives a device switch.
 *
 * Page resolution lives in wiki-draft-target.ts. Wiki deletion uses the cleanup
 * command in this module, so the draft lookup stays independent of Wiki commands.
 */
import { drizzle, schema } from '#db'
import { SQL_NULL } from '#db/sql-null.ts'

import { ConflictError, ValidationError, validationIssues } from './errors.ts'
import { inChunks } from './sql.ts'
import type { ServiceCtx } from './types.ts'
import { resolveDraftTarget } from './wiki-draft-target.ts'

type WikiDraft = Pick<typeof schema.wikiDrafts.$inferSelect, 'title' | 'content' | 'baseRevisionId' | 'updatedAt'>
type DraftRevision = ReturnType<typeof crypto.randomUUID>

interface DraftState {
  revision: string | null
  draft: WikiDraft | null
}

interface ChangedDraft {
  ok: true
  revision: DraftRevision
}

interface SavedDraft extends ChangedDraft {
  pageId: string
  updatedAt: number
}

interface ReservedDraft {
  pageId: string
  revision: DraftRevision
  input: ReturnType<typeof VersionedWikiDraftInputSchema.parse>
}

type PublishedDraft = { ok: true; draftRevision: DraftRevision } | { ok: true; draftRevision: null }

/*
 * PROJ-495: returns null (not 404) when the caller has no draft for this page — "no
 * draft yet" is the expected common case, not an error.
 */
export const getWikiDraft = async function getWikiDraft(ctx: ServiceCtx, idOrSlug: string): Promise<WikiDraft | null> {
  const page = await resolveDraftTarget(ctx, idOrSlug)
  const orm = drizzle(ctx.db, { schema })
  const row = await orm
    .select(
      fieldsInOrder([
        ['title', schema.wikiDrafts.title],
        ['content', schema.wikiDrafts.content],
        ['baseRevisionId', schema.wikiDrafts.baseRevisionId],
        ['updatedAt', schema.wikiDrafts.updatedAt],
      ]),
    )
    .from(schema.wikiDrafts)
    .where(
      and(
        eq(schema.wikiDrafts.workspaceId, ctx.workspaceId),
        eq(schema.wikiDrafts.userId, ctx.userId),
        eq(schema.wikiDrafts.pageId, page.id),
      ),
    )
    .get()
  return row ?? JSON_NULL
}

/*
 * The head and scratch snapshot are read together, including after a discard removed
 * the scratch row. Only Core calls this after authorizing the page and current user.
 */
export const readWikiDraftState = async function readWikiDraftState(
  db: D1Database,
  workspaceId: string,
  pageId: string,
  userId: string,
): Promise<DraftState> {
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
  return fieldsInOrder([
    ['revision', row?.revision ?? JSON_NULL],
    [
      'draft',
      row &&
      Predicate.isNotNullish(row.title) &&
      Predicate.isNotNullish(row.content) &&
      Predicate.isNotNullish(row.updatedAt)
        ? fieldsInOrder([
            ['title', row.title],
            ['content', row.content],
            ['baseRevisionId', row.baseRevisionId],
            ['updatedAt', row.updatedAt],
          ])
        : JSON_NULL,
    ],
  ])
}

const advanceHead = function advanceHead(
  ctx: ServiceCtx,
  pageId: string,
  expected: string | null | undefined,
  revision: string,
): D1PreparedStatement {
  const key = [ctx.workspaceId, ctx.userId, pageId]
  if (!isWikiRevisionSpecified(expected)) {
    /*
     * Existing REST/MCP callers remain last-write-wins, but invalidate any older
     * versioned browser request rather than bypassing the head.
     */
    return ctx.db
      .prepare(`INSERT INTO wiki_draft_heads(workspace_id,user_id,page_id,revision) VALUES (?,?,?,?)
      ON CONFLICT(workspace_id,user_id,page_id) DO UPDATE SET revision = excluded.revision RETURNING revision`)
      .bind(...key, revision)
  }
  if (Predicate.isNullish(expected)) {
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

const requireAdvanced = function requireAdvanced(result: D1Result, revision: string): void {
  if (!result.results.some((row) => Predicate.isObjectOrArray(row) && 'revision' in row && row.revision === revision)) {
    throw new ConflictError('The saved draft changed. Reload its current state before saving again.')
  }
}

export const saveWikiDraft = async function saveWikiDraft(
  ctx: ServiceCtx,
  idOrSlug: string,
  input: unknown,
): Promise<SavedDraft> {
  const parsed = SaveWikiDraftInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const page = await resolveDraftTarget(ctx, idOrSlug)
  const revision = crypto.randomUUID()
  const now = currentEpochSeconds()
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
        parsed.data.baseRevisionId ?? SQL_NULL,
        now,
        ctx.workspaceId,
        ctx.userId,
        page.id,
        revision,
      ),
  ])
  requireAdvanced(results[0], revision)
  return fieldsInOrder([
    ['ok', true as const],
    ['pageId', page.id],
    ['updatedAt', now],
    ['revision', revision],
  ])
}

const discardResolvedDraft = async function discardResolvedDraft(
  ctx: ServiceCtx,
  pageId: string,
  expected: string | null | undefined,
): Promise<ChangedDraft> {
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

const DiscardDraftInput = WikiDraftRevisionInputSchema.optional()

const expectedDraftRevision = function expectedDraftRevision(input: unknown): string | null | undefined {
  const parsed = DiscardDraftInput.safeParse(input)
  if (!parsed.success) {
    const { formErrors, fieldErrors } = flattenError(parsed.error)
    throw new ValidationError(validationIssues(formErrors, fieldErrors ?? {}))
  }
  return parsed.data?.expectedDraftRevision
}

export const discardWikiDraft = async function discardWikiDraft(
  ctx: ServiceCtx,
  idOrSlug: string,
  input?: unknown,
): Promise<ChangedDraft> {
  const expected = expectedDraftRevision(input)
  const page = await resolveDraftTarget(ctx, idOrSlug)
  return discardResolvedDraft(ctx, page.id, expected)
}

/*
 * Publication invalidates older writers first, without deleting recoverable text
 * if the page update fails. A newly accepted draft must survive its later cleanup.
 */
export const beginWikiDraftPublish = async function beginWikiDraftPublish(
  ctx: ServiceCtx,
  idOrSlug: string,
  input: unknown,
): Promise<ReservedDraft> {
  const parsed = VersionedWikiDraftInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const page = await resolveDraftTarget(ctx, idOrSlug)
  const revision = crypto.randomUUID()
  const result = await advanceHead(ctx, page.id, parsed.data.expectedDraftRevision, revision).all()
  requireAdvanced(result, revision)
  return fieldsInOrder([
    ['pageId', page.id],
    ['revision', revision],
    ['input', parsed.data],
  ])
}

export const finishWikiDraftPublish = async function finishWikiDraftPublish(
  ctx: ServiceCtx,
  pageId: string,
  reservedRevision: string,
): Promise<PublishedDraft> {
  const page = await resolveDraftTarget(ctx, pageId)
  try {
    const result = await discardResolvedDraft(ctx, page.id, reservedRevision)
    return fieldsInOrder([
      ['ok', true as const],
      ['draftRevision', result.revision],
    ])
  } catch (error) {
    if (!(error instanceof ConflictError)) {
      throw error
    }
    /*
     * Another editor has advanced the head. Publication succeeded, but this
     * caller must reconcile that draft rather than overwrite it automatically.
     */
    return fieldsInOrder([
      ['ok', true as const],
      ['draftRevision', JSON_NULL],
    ])
  }
}

/*
 * PROJ-495: app-level mirror of wiki_drafts.page_id's ON DELETE CASCADE, called from
 * services/wiki.ts#purgeExpiredWikiPages (PROJ-496: draft cleanup moved from delete
 * time to purge time) — same belt-and-braces precedent as
 * wiki-watchers.ts#deleteWikiWatchersForPages (PROJ-407: D1 doesn't guarantee FK
 * enforcement on every connection).
 */
export const deleteWikiDraftsForPages = async function deleteWikiDraftsForPages(
  ctx: ServiceCtx,
  pageIds: string[],
): Promise<void> {
  if (Array.isArrayEmpty(pageIds)) {
    return
  }
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
