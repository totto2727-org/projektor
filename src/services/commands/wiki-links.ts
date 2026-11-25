import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { String, Array, Iterable, Predicate, Number } from 'effect'
import { flattenError } from 'zod'

import { BackfillWikiLinksInputSchema, ListBrokenWikiLinksInputSchema } from '#contracts/inputs/wiki.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
/*
 * PROJ-496 (R14): a trashed page is treated as gone for link resolution purposes — see
 * resolveTitleTargets/resolveSlugTargets/backlinksForResolvedPage/listBrokenWikiLinks
 * below for the `isNull(schema.wikiPages.deletedAt)` filters this adds.
 */
import { safeDecodeURIComponent, wikiPagePath } from '#contracts/urls.ts'
/*
 * PROJ-485: server-side wiki link graph. Parses [[Target]] / [[Target|label]] wikilinks
 * and same-workspace wiki URLs out of a page's content on every write, resolves each to
 * a page id (or leaves it unresolved for broken-link reporting), and stores the result in
 * `wiki_links` — id-backed so renames never break a link (target_title is kept purely for
 * display/re-resolution, target_page_id is the source of truth).
 *
 * No dependency on services/wiki.ts (avoids a circular import) — page resolution/
 * visibility for a *specific* page stays in wiki.ts, which calls into this file's
 * `backlinksForResolvedPage` after resolving. listBrokenWikiLinks/backfillWikiLinks
 * don't need a single resolved page so they're self-contained here.
 */
import { drizzle, schema } from '#db'

import { hasProjectAccess, isWorkspaceAdmin, visibleProjectPredicate } from './access.ts'
import { ForbiddenError, ValidationError } from './errors.ts'
import { inChunks } from './sql.ts'
import type { ServiceCtx } from './types.ts'

type Orm = ReturnType<typeof drizzle<typeof schema>>

/*
 * Mirrors apps/web/src/utils/markdown.ts's resolveWikilinks regex — same link syntax
 * rules, server-side.
 */
const WIKILINK_RE = /\[\[(?<title>[^\]|]+?)(?:\|[^\]]+?)?\]\]/gu
/*
 * Markdown link syntax `[label](url)` — used to catch same-workspace wiki URLs
 * (`/wiki/:slug`, `/wiki?slug=...`, or the relative `?slug=...` form markdown.ts emits
 * for already-resolved wikilinks).
 */
const MD_LINK_RE = /\[[^\]]*\]\((?<url>[^)\s]+)\)/gu

type ParsedLinkTarget = { kind: 'title'; title: string } | { kind: 'slug'; slug: string }

const extractWikiSlugFromUrl = function extractWikiSlugFromUrl(url: string): string | null {
  /*
   * Only relative, path-rooted URLs are treated as same-workspace links. An absolute
   * URL (http://, https://, //host/...) is never resolved here — we have no reliable
   * request origin at parse time to compare it against, so treating "strip whatever
   * origin is present" as "same workspace" would wrongly index links to other hosts
   * as same-workspace links (even a same-origin absolute URL is written as relative
   * by the app, so this doesn't lose any real link).
   */
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url)) {
    return null
  }
  const pathSlug = url.match(/^\/wiki\/(?<slug>[a-z0-9-]+)\/?$/i)?.groups?.slug
  const raw = pathSlug ?? url.match(/[?&]slug=(?<slug>[^&]+)/u)?.groups?.slug
  if (Predicate.isNullish(raw) || String.isEmpty(raw)) {
    return null
  }
  /*
   * PROJ-510: a malformed percent-escape makes decodeURIComponent throw. This runs
   * mid-reindex, after the content write and the old wiki_links delete have already
   * committed, so an uncaught throw leaves the page's links wiped. An undecodable
   * URL is treated as "not a wiki link" rather than propagating.
   */
  return safeDecodeURIComponent(raw)
}

export const parseWikiLinkTargets = function parseWikiLinkTargets(content: string): ParsedLinkTarget[] {
  const targets: ParsedLinkTarget[] = []
  Iterable.forEach(content.matchAll(WIKILINK_RE), (match) => {
    const title = match.groups?.title.trim() ?? ''
    if (String.isNonEmpty(title)) {
      targets.push({ kind: 'title', title })
    }
  })
  Iterable.forEach(content.matchAll(MD_LINK_RE), (match) => {
    const slug = extractWikiSlugFromUrl(match.groups?.url.trim() ?? '')
    if (Predicate.isNotNullish(slug) && String.isNonEmpty(slug)) {
      targets.push({ kind: 'slug', slug })
    }
  })
  return targets
}

/*
 * PROJ-814/PROJ-818: the single place that decides whether a raw link target's text
 * matches a page's title. PROJ-818 will change this fold (e.g. Unicode-aware
 * normalization) — every title comparison in this file, both initial resolution and
 * lifecycle re-resolution below, routes through here so that ticket only has to touch
 * this one function.
 *
 * PROJ-818: NFC-normalise then lowercase in JS. SQLite's lower() only folds ASCII, so
 * titles are compared through the stored folds (wiki_pages.title_fold,
 * wiki_links.target_fold), which are always computed here — never with SQL lower().
 */
export const foldWikiTitle = function foldWikiTitle(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

const HEAL_BATCH = 200

/**
 * PROJ-818: fill NULL title/target folds left by migration 0063 (it only backfills
 * ASCII-only values, which SQL lower() folds exactly). Bounded per call and a no-op
 * once a workspace is healed (partial indexes on `fold IS NULL` keep the check cheap).
 * Called before title resolution and by backfill_wiki_links.
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @returns {Promise<number>} The number of page or link records repaired in this call.
 */
export const healTitleFolds = async function healTitleFolds(ctx: ServiceCtx): Promise<number> {
  const [pages, links] = await Promise.all([
    ctx.db
      .prepare('SELECT id, title AS t FROM wiki_pages WHERE workspace_id = ? AND title_fold IS NULL LIMIT ?')
      .bind(ctx.workspaceId, HEAL_BATCH)
      .all<{ id: string; t: string }>(),
    ctx.db
      .prepare('SELECT id, target_title AS t FROM wiki_links WHERE workspace_id = ? AND target_fold IS NULL LIMIT ?')
      .bind(ctx.workspaceId, HEAL_BATCH)
      .all<{ id: string; t: string }>(),
  ])
  const statements = [
    ...pages.results.map((result) =>
      ctx.db
        .prepare('UPDATE wiki_pages SET title_fold = ? WHERE id = ? AND workspace_id = ?')
        .bind(foldWikiTitle(result.t), result.id, ctx.workspaceId),
    ),
    ...links.results.map((result) =>
      ctx.db
        .prepare('UPDATE wiki_links SET target_fold = ? WHERE id = ? AND workspace_id = ?')
        .bind(foldWikiTitle(result.t), result.id, ctx.workspaceId),
    ),
  ]
  if (Array.isArrayNonEmpty(statements)) {
    await ctx.db.batch(statements)
  }
  return statements.length
}

/*
 * Resolves all title-kind targets in one query (rather than one round trip per link),
 * matched case-insensitively. Page titles aren't unique like slugs are (PROJ-483 only
 * enforces slug uniqueness); when more than one page shares a (lowercased) title, this
 * picks whichever row the query happens to return first — an arbitrary but stable-ish
 * match, not a documented/guaranteed one. Undocumented behavior, not a bug: titles were
 * never meant to be a stable identifier, slugs are.
 */
const resolveTitleTargets = async function resolveTitleTargets(
  orm: Orm,
  workspaceId: string,
  titles: Readonly<string[]>,
): Promise<Map<string, string>> {
  const byLower = new Map<string, string>()
  if (Array.isReadonlyArrayEmpty(titles)) {
    return byLower
  }
  const lowered = [...new Set(titles.map((title) => foldWikiTitle(title)))]
  const wanted = new Set(lowered)
  const cols = {
    id: schema.wikiPages.id,
    title: schema.wikiPages.title,
    createdAt: schema.wikiPages.createdAt,
  }
  const rows = await inChunks(lowered, (chunk) =>
    orm
      .select(cols)
      .from(schema.wikiPages)
      .where(
        and(
          eq(schema.wikiPages.workspaceId, workspaceId),
          inArray(schema.wikiPages.titleFold, chunk),
          isNull(schema.wikiPages.deletedAt),
        ),
      ),
  )
  /*
   * PROJ-818: pages whose fold hasn't been healed yet (non-ASCII titles from before
   * migration 0063) are invisible to the IN above — fold them here in JS so a link that
   * resolved before the migration still resolves. The set shrinks with every heal.
   */
  const unhealed = await orm
    .select(cols)
    .from(schema.wikiPages)
    .where(
      and(
        eq(schema.wikiPages.workspaceId, workspaceId),
        isNull(schema.wikiPages.titleFold),
        isNull(schema.wikiPages.deletedAt),
      ),
    )
  const candidates = [...rows, ...unhealed.filter((row) => wanted.has(foldWikiTitle(row.title)))].toSorted(
    (left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  )
  /*
   * Duplicate titles: the oldest page wins (created_at, then id) — the same order the
   * set-based lifecycle statements use, so both paths agree.
   */
  Iterable.forEach(candidates, (row) => {
    const key = foldWikiTitle(row.title)
    if (!byLower.has(key)) {
      byLower.set(key, row.id)
    }
  })
  return byLower
}

/*
 * PROJ-858: all slug targets resolve in a fixed number of queries — one slug IN (…),
 * one wiki_redirects IN (…) for the misses, one page load for redirect targets (each
 * chunked under D1's bind limit) — instead of 1–3 sequential queries per link.
 */
const resolveSlugTargets = async function resolveSlugTargets(
  orm: Orm,
  workspaceId: string,
  slugs: Readonly<string[]>,
): Promise<Map<string, { id: string; title: string }>> {
  const bySlug = new Map<string, { id: string; title: string }>()
  const unique = [...new Set(slugs)]
  if (Array.isArrayEmpty(unique)) {
    return bySlug
  }

  const direct = await inChunks(unique, (chunk) =>
    orm
      .select(
        fieldsInOrder([
          ['id', schema.wikiPages.id],
          ['title', schema.wikiPages.title],
          ['slug', schema.wikiPages.slug],
        ]),
      )
      .from(schema.wikiPages)
      .where(
        and(
          eq(schema.wikiPages.workspaceId, workspaceId),
          inArray(schema.wikiPages.slug, chunk),
          isNull(schema.wikiPages.deletedAt),
        ),
      ),
  )
  Iterable.forEach(direct, (row) => {
    bySlug.set(row.slug, { id: row.id, title: row.title })
  })

  // PROJ-483 redirects: an old slug still resolves to its page.
  const missing = unique.filter((slug) => !bySlug.has(slug))
  if (Array.isArrayEmpty(missing)) {
    return bySlug
  }
  const redirects = await inChunks(missing, (chunk) =>
    orm
      .select({ oldSlug: schema.wikiRedirects.oldSlug, pageId: schema.wikiRedirects.pageId })
      .from(schema.wikiRedirects)
      .where(and(eq(schema.wikiRedirects.workspaceId, workspaceId), inArray(schema.wikiRedirects.oldSlug, chunk))),
  )
  if (Array.isArrayEmpty(redirects)) {
    return bySlug
  }

  const targetIds = [...new Set(redirects.map((redirect) => redirect.pageId))]
  const targets = await inChunks(targetIds, (chunk) =>
    orm
      .select({ id: schema.wikiPages.id, title: schema.wikiPages.title })
      .from(schema.wikiPages)
      .where(
        and(
          inArray(schema.wikiPages.id, chunk),
          eq(schema.wikiPages.workspaceId, workspaceId),
          /*
           * PROJ-496: same "trashed = gone" rule as resolveWikiPageByRedirect in
           * services/wiki.ts — a link to a page's old slug doesn't resolve while the
           * page is in the trash.
           */
          isNull(schema.wikiPages.deletedAt),
        ),
      ),
  )
  const pageById = new Map(targets.map((target) => [target.id, target]))
  Iterable.forEach(redirects, (redirect) => {
    const page = pageById.get(redirect.pageId)
    if (page && !bySlug.has(redirect.oldSlug)) {
      bySlug.set(redirect.oldSlug, page)
    }
  })
  return bySlug
}

interface ResolvedLink {
  targetPageId: string | null
  targetTitle: string
  targetText: string
  targetKind: 'title' | 'slug'
}

const isTitleTarget = function isTitleTarget(
  target: ParsedLinkTarget,
): target is Extract<ParsedLinkTarget, { kind: 'title' }> {
  return target.kind === 'title'
}
const isSlugTarget = function isSlugTarget(
  target: ParsedLinkTarget,
): target is Extract<ParsedLinkTarget, { kind: 'slug' }> {
  return target.kind === 'slug'
}

/*
 * Turns one page's parsed targets into its resolved wiki_links rows using ALREADY-FETCHED
 * title/slug lookup maps — no I/O. Split out from resolveLinkTargets so PROJ-815's
 * backfill can resolve every page in a chunk from ONE shared pair of maps (one
 * resolveTitleTargets + one resolveSlugTargets call for the whole chunk) instead of a
 * pair per page.
 */
const resolveTargetsFromMaps = function resolveTargetsFromMaps(
  targets: Readonly<ParsedLinkTarget[]>,
  titleMatches: ReadonlyMap<string, string>,
  slugMatches: ReadonlyMap<string, { id: string; title: string }>,
): ResolvedLink[] {
  /*
   * Dedupe by resolved page id (or the raw unresolved key) so a page linking to the
   * same target multiple times only gets one wiki_links row.
   */
  const resolved = new Map<string, ResolvedLink>()
  Iterable.forEach(targets, (target) => {
    if (isTitleTarget(target)) {
      const targetPageId = titleMatches.get(foldWikiTitle(target.title)) ?? null
      const key = targetPageId ?? `title:${foldWikiTitle(target.title)}`
      if (!resolved.has(key)) {
        resolved.set(key, {
          targetPageId,
          targetTitle: target.title,
          targetText: target.title,
          targetKind: 'title',
        })
      }
    } else if (isSlugTarget(target)) {
      const page = slugMatches.get(target.slug)
      const key = page?.id ?? `slug:${target.slug.toLowerCase()}`
      if (!resolved.has(key)) {
        resolved.set(key, {
          targetPageId: page?.id ?? null,
          targetTitle: page?.title ?? target.slug,
          targetText: target.slug,
          targetKind: 'slug',
        })
      }
    }
  })
  return [...resolved.values()]
}

const resolveLinkTargets = async function resolveLinkTargets(
  orm: Orm,
  workspaceId: string,
  targets: Readonly<ParsedLinkTarget[]>,
): Promise<ResolvedLink[]> {
  const [titleMatches, slugMatches] = await Promise.all([
    resolveTitleTargets(
      orm,
      workspaceId,
      targets.filter(isTitleTarget).map((target) => target.title),
    ),
    resolveSlugTargets(
      orm,
      workspaceId,
      targets.filter(isSlugTarget).map((target) => target.slug),
    ),
  ])
  return resolveTargetsFromMaps(targets, titleMatches, slugMatches)
}

/*
 * PROJ-815: resolves link targets for MANY pages' content with exactly one
 * resolveTitleTargets + one resolveSlugTargets call covering the union of every page's
 * targets — not one pair per page — then fans the shared maps back out per page in
 * memory. Query count for the whole batch stays flat as the page count grows (each of
 * those two calls is itself already chunked under D1's bound-param cap by inChunks).
 */
const resolveLinkTargetsForPages = async function resolveLinkTargetsForPages(
  orm: Orm,
  workspaceId: string,
  pages: Readonly<{ id: string; targets: Readonly<ParsedLinkTarget[]> }[]>,
): Promise<Map<string, ResolvedLink[]>> {
  const allTargets = pages.flatMap((page) => page.targets)
  const [titleMatches, slugMatches] = await Promise.all([
    resolveTitleTargets(
      orm,
      workspaceId,
      allTargets.filter(isTitleTarget).map((target) => target.title),
    ),
    resolveSlugTargets(
      orm,
      workspaceId,
      allTargets.filter(isSlugTarget).map((target) => target.slug),
    ),
  ])
  const byPage = new Map<string, ResolvedLink[]>()
  Iterable.forEach(pages, (page) => {
    byPage.set(page.id, resolveTargetsFromMaps(page.targets, titleMatches, slugMatches))
  })
  return byPage
}

/*
 * D1 caps bound params at 100; each row binds 9 params (id, workspaceId, sourcePageId,
 * targetPageId, targetTitle, targetFold, targetText, targetKind, createdAt) — unlike
 * services/sql.ts#inChunks (calibrated for single-param-per-item IN-list queries, not
 * multi-column inserts).
 */
// 9 columns × 11 = 99 bound params (D1 cap: 100)
const LINK_INSERT_CHUNK_SIZE = 11

/*
 * The write half of buildWikiLinksReindexStatements, split out so PROJ-815's backfill can
 * build every page's statements from a resolution already computed for the whole chunk
 * (resolveLinkTargetsForPages) instead of re-resolving per page.
 */
const buildLinkWriteStatements = function buildLinkWriteStatements(
  ctx: ServiceCtx,
  sourcePageId: string,
  resolved: Readonly<ResolvedLink[]>,
): D1PreparedStatement[] {
  const now = currentEpochSeconds()
  const rows = resolved.map((link) => ({
    id: crypto.randomUUID(),
    workspaceId: ctx.workspaceId,
    sourcePageId,
    targetPageId: link.targetPageId,
    targetTitle: link.targetTitle,
    targetFold: foldWikiTitle(link.targetTitle),
    targetText: link.targetText,
    targetKind: link.targetKind,
    createdAt: now,
  }))

  const statements: D1PreparedStatement[] = [
    ctx.db
      .prepare('DELETE FROM wiki_links WHERE source_page_id = ? AND workspace_id = ?')
      .bind(sourcePageId, ctx.workspaceId),
  ]
  for (let index = 0; index < rows.length; index += LINK_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + LINK_INSERT_CHUNK_SIZE)
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
    const params = chunk.flatMap((row) => [
      row.id,
      row.workspaceId,
      row.sourcePageId,
      row.targetPageId,
      row.targetTitle,
      row.targetFold,
      row.targetText,
      row.targetKind,
      row.createdAt,
    ])
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO wiki_links (id, workspace_id, source_page_id, target_page_id, target_title,
						target_fold, target_text, target_kind, created_at) VALUES ${placeholders}`,
        )
        .bind(...params),
    )
  }
  return statements
}

/**
 * Builds (without executing) the DELETE + chunked re-INSERT statements that recompute a
 * page's outgoing wiki_links rows from its current content — the write half of
 * reindexWikiLinks, split out so services/wiki.ts can fold these statements into the same
 * db.batch() as the page's content write, revision insert, and FTS reindex (PROJ-511).
 * All resolution (parsing + the resolveLinkTargets reads) happens BEFORE this returns, so
 * by the time these statements exist there is nothing left to throw between them and the
 * delete — the whole write becomes one atomic D1 batch when passed to ctx.db.batch().
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {Orm} orm The Drizzle connection for resolving links.
 * @param {string} sourcePageId The ID of the page whose links are being indexed.
 * @param {string} content The source page's Markdown content.
 * @returns {Promise<D1PreparedStatement[]>} The bound delete and insertion statements in execution order.
 */
export const buildWikiLinksReindexStatements = async function buildWikiLinksReindexStatements(
  ctx: ServiceCtx,
  orm: Orm,
  sourcePageId: string,
  content: string,
): Promise<D1PreparedStatement[]> {
  const targets = parseWikiLinkTargets(content)
  // PROJ-818: title matching reads the stored folds — heal any NULLs first.
  await healTitleFolds(ctx)
  const resolved = Array.isArrayNonEmpty(targets) ? await resolveLinkTargets(orm, ctx.workspaceId, targets) : []
  return buildLinkWriteStatements(ctx, sourcePageId, resolved)
}

/**
 * Recompute a page's outgoing wiki_links rows from its current content: delete-then-
 * reinsert, mirroring services/wiki.ts's reindexWikiFts. Call after every content write
 * (create or update) — never partially, since a stale row would misreport backlinks.
 *
 * Runs the statements from buildWikiLinksReindexStatements as their own atomic db.batch —
 * used by callers (e.g. backfillWikiLinks) that don't fold link reindexing into a larger
 * page-write batch themselves. services/wiki.ts's createWikiPage/updateWikiPage/
 * patchWikiPage call buildWikiLinksReindexStatements directly instead, to include these
 * statements in the same batch as the content write/revision/FTS reindex (PROJ-511).
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {Orm} orm The Drizzle connection for resolving links.
 * @param {string} sourcePageId The ID of the page whose links are being indexed.
 * @param {string} content The source page's Markdown content.
 */
export const reindexWikiLinks = async function reindexWikiLinks(
  ctx: ServiceCtx,
  orm: Orm,
  sourcePageId: string,
  content: string,
): Promise<void> {
  const statements = await buildWikiLinksReindexStatements(ctx, orm, sourcePageId, content)
  await ctx.db.batch(statements)
}

export interface BackfillWikiLinksCursor {
  updatedAt: number
  id: string
}

export interface BackfillWikiLinksResult {
  processed: number
  nextCursor: BackfillWikiLinksCursor | null
  /** @deprecated use `processed` — kept for existing callers during the PROJ-815 rollout. */
  pagesProcessed: number
}

/**
 * Recompute wiki_links for existing pages in the workspace, one page-budget-sized chunk
 * per call. D1 migrations are pure SQL and can't run this parsing logic, so it's exposed
 * as an idempotent (delete-then-reinsert per page, safe to re-run), owner/admin-gated
 * action instead — see mcp/wiki.ts's backfill_wiki_links tool / routes/wiki.ts's REST
 * equivalent.
 *
 * PROJ-815:
 *  - Trashed pages (deleted_at IS NOT NULL) are skipped — trash's links aren't a
 *    maintenance concern (mirrors listBrokenWikiLinks' rationale).
 *  - Reads and writes are batched across the WHOLE page chunk: one page-select query, one
 *    shared resolveTitleTargets + one shared resolveSlugTargets call for every page's
 *    targets combined (resolveLinkTargetsForPages — PROJ-858's batching, extended from
 *    one page to many), and one ctx.db.batch() carrying every page's DELETE+INSERT
 *    statements. Query count stays flat as the page count grows within a chunk, instead
 *    of growing with it.
 *  - `cursor` (a page id/updated_at pair) and `pageBudget` make this incremental and
 *    resumable: callers loop, passing back `nextCursor`, until it comes back null.
 *  - `updatedSince` limits the scope to pages touched at/after that time.
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {unknown} [input] The cursor, page budget and optional update-time filter.
 * @returns {Promise<BackfillWikiLinksResult>} The processed page count and next cursor, when available.
 */
export const backfillWikiLinks = async function backfillWikiLinks(
  ctx: ServiceCtx,
  input?: unknown,
): Promise<BackfillWikiLinksResult> {
  if (!isWorkspaceAdmin(ctx.role)) {
    throw new ForbiddenError('Insufficient permissions')
  }
  const parsed = BackfillWikiLinksInputSchema.safeParse(input ?? {})
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { cursor, pageBudget, updatedSince } = parsed.data
  // PROJ-818: drain unhealed folds (bounded) so this backfill resolves against them.
  let healRounds = 0
  while (healRounds < 20 && (await healTitleFolds(ctx)) > 0) {
    healRounds = Number.increment(healRounds)
  }

  const orm = drizzle(ctx.db, { schema })
  const conditions = [
    eq(schema.wikiPages.workspaceId, ctx.workspaceId),
    // PROJ-815: trashed pages are skipped.
    isNull(schema.wikiPages.deletedAt),
  ]
  if (Predicate.isNotNullish(updatedSince)) {
    conditions.push(sql`${schema.wikiPages.updatedAt} >= ${updatedSince}`)
  }
  if (cursor) {
    /*
     * Resume strictly after the (updatedAt, id) pair the previous call stopped at —
     * matches the ORDER BY below, so no page is skipped or repeated across calls.
     */
    conditions.push(
      sql`(${schema.wikiPages.updatedAt} > ${cursor.updatedAt}
				OR (${schema.wikiPages.updatedAt} = ${cursor.updatedAt} AND ${schema.wikiPages.id} > ${cursor.id}))`,
    )
  }

  const pages = await orm
    .select(
      fieldsInOrder([
        ['id', schema.wikiPages.id],
        ['content', schema.wikiPages.content],
        ['updatedAt', schema.wikiPages.updatedAt],
      ]),
    )
    .from(schema.wikiPages)
    .where(and(...conditions))
    .orderBy(asc(schema.wikiPages.updatedAt), asc(schema.wikiPages.id))
    .limit(pageBudget)

  if (!Array.isArrayNonEmpty(pages)) {
    return { processed: 0, nextCursor: null, pagesProcessed: 0 }
  }

  const parsedPages = pages.map((page) => ({ id: page.id, targets: parseWikiLinkTargets(page.content) }))
  const resolvedByPage = await resolveLinkTargetsForPages(orm, ctx.workspaceId, parsedPages)

  const statements: D1PreparedStatement[] = []
  Iterable.forEach(parsedPages, (page) => {
    statements.push(...buildLinkWriteStatements(ctx, page.id, resolvedByPage.get(page.id) ?? []))
  })
  /*
   * One batch for the whole chunk — each individual statement already respects D1's
   * per-statement bound-param cap (buildLinkWriteStatements/LINK_INSERT_CHUNK_SIZE), and
   * db.batch() itself has no such cap, only a single round trip.
   */
  if (Array.isArrayNonEmpty(statements)) {
    await ctx.db.batch(statements)
  }

  const last = Array.lastNonEmpty(pages)
  // A short page (fewer rows than requested) means we've reached the end of the scope.
  const nextCursor = pages.length < pageBudget ? null : { updatedAt: last.updatedAt, id: last.id }
  return { processed: pages.length, nextCursor, pagesProcessed: pages.length }
}

/*
 * Called from services/wiki.ts's deleteWikiPage so a deleted page's outgoing link rows
 * don't linger (ON DELETE CASCADE on source_page_id already guarantees this at the DB
 * level for D1 connections that enforce FKs, but PROJ-407 established that isn't
 * guaranteed for every connection — mirrors deleteWikiPageAttachments's rationale).
 */
export const deleteWikiLinksForPages = async function deleteWikiLinksForPages(
  ctx: ServiceCtx,
  pageIds: string[],
): Promise<void> {
  await inChunks(pageIds, async (chunk) => {
    const placeholders = chunk.map(() => '?').join(',')
    await ctx.db
      .prepare(`DELETE FROM wiki_links WHERE source_page_id IN (${placeholders}) AND workspace_id = ?`)
      .bind(...chunk, ctx.workspaceId)
      .run()
    return []
  })
}

/*
 * Called from services/wiki.ts's deleteWikiPage alongside deleteWikiLinksForPages —
 * the same app-level-mirrors-the-FK rationale (PROJ-407), but for the *incoming* side.
 * ON DELETE SET NULL on target_page_id already guarantees this at the DB level for
 * connections that enforce FKs; this is the defensive fallback for connections that
 * don't, so a deleted page's id never lingers as a dangling target_page_id (which
 * would make the link invisible to list_broken_wiki_links, since that only looks for
 * target_page_id IS NULL). Only nulls target_page_id — target_title is left untouched
 * so the link still shows up as broken with its original display text.
 */
export const clearIncomingLinkTargets = async function clearIncomingLinkTargets(
  ctx: ServiceCtx,
  pageIds: string[],
): Promise<void> {
  await inChunks(pageIds, async (chunk) => {
    const placeholders = chunk.map(() => '?').join(',')
    await ctx.db
      .prepare(
        `UPDATE wiki_links SET target_page_id = NULL WHERE target_page_id IN (${placeholders}) AND workspace_id = ?`,
      )
      .bind(...chunk, ctx.workspaceId)
      .run()
    return []
  })
}

/*
 * PROJ-814: builds (without executing) the set-based UPDATE that resolves OTHER pages'
 * unresolved links whose raw target text names this page by its (current) title or slug
 * — e.g. a page linked via [[Onboarding]] before "Onboarding" existed becomes resolved
 * the moment it's created, without the linking page being re-saved. Used on create,
 * rename and restore; meant to be folded into the same db.batch() as the page write where
 * the caller already builds one (create, rename) — restore executes it directly since it
 * isn't otherwise batched. Title matching is case-folded via foldWikiTitle (the ONE place
 * PROJ-818 will change); slug matching is exact, mirroring resolveSlugTargets.
 */
export const buildResolveIncomingLinksStatement = function buildResolveIncomingLinksStatement(
  ctx: ServiceCtx,
  page: Readonly<{ id: string; title: string; slug: string }>,
): D1PreparedStatement {
  /*
   * Each link matches the way it was written: [[Title]] links by folded title, URL links
   * by slug. Legacy rows (target_kind NULL, pre-0063) keep the old either-way match.
   * A link whose target is in the trash is claimable too (PROJ-814 review: trash no
   * longer clears links, so restore stays lossless).
   */
  return ctx.db
    .prepare(
      `UPDATE wiki_links SET target_page_id = ?1
			 WHERE workspace_id = ?2
			   AND (target_page_id IS NULL OR target_page_id IN (
			     SELECT id FROM wiki_pages WHERE workspace_id = ?2 AND deleted_at IS NOT NULL))
			   AND (
			     (target_kind = 'title' AND target_fold = ?3)
			     OR (target_kind = 'slug' AND target_text = ?4)
			     OR (target_kind IS NULL AND (target_fold = ?3 OR target_title = ?4))
			   )`,
    )
    .bind(page.id, ctx.workspaceId, foldWikiTitle(page.title), page.slug)
}

/*
 * The oldest live page in the workspace that a wiki_links row (the UPDATE's own row)
 * would resolve to — shared by rename and purge re-pointing so duplicates resolve the
 * same way resolveTitleTargets does (created_at, then id).
 */
const repointSubquery = function repointSubquery(workspaceParam: string): string {
  return `SELECT p.id FROM wiki_pages p
		WHERE p.workspace_id = ${workspaceParam} AND p.deleted_at IS NULL
		  AND (
		    (COALESCE(wiki_links.target_kind, 'title') = 'title' AND p.title_fold = wiki_links.target_fold)
		    OR (wiki_links.target_kind = 'slug' AND p.slug = wiki_links.target_text)
		  )
		ORDER BY p.created_at, p.id LIMIT 1`
}

/*
 * PROJ-814: on rename (title and/or slug), links that had resolved to this page BY ITS
 * OLD title/slug become unresolved again if their raw target text no longer matches the
 * NEW title/slug — e.g. a link's raw text is still "[[OldName]]"; once this page is no
 * longer named that, a different (or no) page should be able to claim that text. Disjoint
 * from buildResolveIncomingLinksStatement (that one only touches target_page_id IS NULL,
 * this one only touches target_page_id = page.id), so the two can run in either order in
 * the same batch.
 */
export const buildUnresolveStaleIncomingLinksStatement = function buildUnresolveStaleIncomingLinksStatement(
  ctx: ServiceCtx,
  page: Readonly<{ id: string; title: string; slug: string }>,
  old: Readonly<{ title: string; slug: string }>,
): D1PreparedStatement {
  /*
   * Only [[Title]] links move: a URL/slug link keeps pointing at the page through a
   * title change, and through a slug change too (the old slug becomes a redirect).
   * Legacy rows (target_kind NULL) are left alone, as before PROJ-814. A title link
   * that no longer matches is re-pointed to the oldest other live page with that
   * title, else unresolved.
   */
  return ctx.db
    .prepare(
      `UPDATE wiki_links SET target_page_id = (${repointSubquery('?1')})
			 WHERE workspace_id = ?1 AND target_page_id = ?2
			   AND target_kind = 'title' AND target_fold = ?3 AND target_fold <> ?4`,
    )
    .bind(ctx.workspaceId, page.id, foldWikiTitle(old.title), foldWikiTitle(page.title))
}

/**
 * PROJ-814: on purge, links that pointed at the purged pages are re-pointed to another
 * live page they still match (duplicate title, same slug re-used), else unresolved.
 * Run BEFORE the pages are deleted (their FK SET NULL would clear target_page_id first).
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {string[]} pageIds The IDs of the pages about to be purged.
 */
export const repointIncomingLinks = async function repointIncomingLinks(
  ctx: ServiceCtx,
  pageIds: string[],
): Promise<void> {
  await inChunks(pageIds, async (chunk) => {
    const placeholders = chunk.map((_page, index) => `?${index + 2}`).join(',')
    await ctx.db
      .prepare(
        `UPDATE wiki_links SET target_page_id = (${repointSubquery('?1')})
				 WHERE workspace_id = ?1 AND target_page_id IN (${placeholders})`,
      )
      .bind(ctx.workspaceId, ...chunk)
      .run()
    return []
  })
}

/*
 * PROJ-485: count of distinct pages that link to any page in `pageIds`, for delete
 * warnings ("N pages link here"). Must be read BEFORE the delete runs — target_page_id
 * is ON DELETE SET NULL, so the count would read as 0 afterwards.
 */
export const countBacklinkSources = async function countBacklinkSources(
  ctx: ServiceCtx,
  pageIds: string[],
): Promise<number> {
  if (Array.isArrayEmpty(pageIds)) {
    return 0
  }
  const orm = drizzle(ctx.db, { schema })
  /*
   * PROJ-818: only count linking pages the caller can see — the count must not reveal
   * pages in projects hidden from them.
   */
  const visible = visibleProjectPredicate(ctx, schema.wikiPages.projectId)
  const rows = await inChunks(pageIds, (chunk) =>
    orm
      .select({ sourcePageId: schema.wikiLinks.sourcePageId })
      .from(schema.wikiLinks)
      .innerJoin(schema.wikiPages, eq(schema.wikiPages.id, schema.wikiLinks.sourcePageId))
      .where(
        and(
          eq(schema.wikiLinks.workspaceId, ctx.workspaceId),
          inArray(schema.wikiLinks.targetPageId, chunk),
          visible ? or(isNull(schema.wikiPages.projectId), visible) : undefined,
        ),
      )
      .groupBy(schema.wikiLinks.sourcePageId),
  )
  /*
   * Exclude self-links (a page linking to itself isn't "another page" linking here).
   * Dedup across chunks too, since a source page could link to targets that land in
   * different chunks and otherwise be counted more than once.
   */
  const distinctSources = new Set(rows.map((row) => row.sourcePageId).filter((id) => !pageIds.includes(id)))
  return distinctSources.size
}

/*
 * PROJ-485: best-effort citing context for a backlink — the raw text surrounding the
 * first occurrence of the link syntax in the source page's current content. Returns
 * null rather than guessing if the exact text can't be located (e.g. content changed
 * since the link was indexed).
 */
const extractSnippet = function extractSnippet(content: string, targetTitle: string): string | null {
  const marker = `[[${targetTitle.toLowerCase()}`
  const idx = content.toLowerCase().indexOf(marker)
  if (idx === -1) {
    return null
  }
  const SNIPPET_RADIUS = 60
  const start = Math.max(0, idx - SNIPPET_RADIUS)
  const end = Math.min(content.length, idx + marker.length + SNIPPET_RADIUS)
  const text = content.slice(start, end).replaceAll(/\s+/gu, ' ').trim()
  return `${start > 0 ? '…' : ''}${text}${end < content.length ? '…' : ''}`
}

export interface WikiBacklink {
  linkId: string
  pageId: string
  slug: string
  title: string
  url: string
  snippet: string | null
}

// Resolves which of `rows` (all project-scoped) the caller has an effective grant on.
const visibleSourcePageIds = async function visibleSourcePageIds(
  ctx: ServiceCtx,
  rows: Readonly<{ pageId: string; projectId: string | null }[]>,
): Promise<string[]> {
  if (Array.isReadonlyArrayEmpty(rows)) {
    return []
  }
  const uniqueProjectIds = [
    ...new Set(
      rows.map((row) => row.projectId).filter((projectId): projectId is string => Predicate.isNotNullish(projectId)),
    ),
  ]
  const grantedProjectIds = new Set<string>()
  for (const projectId of uniqueProjectIds) {
    if (await hasProjectAccess(ctx, projectId)) {
      grantedProjectIds.add(projectId)
    }
  }
  return rows
    .filter((row) => Predicate.isNotNullish(row.projectId) && grantedProjectIds.has(row.projectId))
    .map((row) => row.pageId)
}

/**
 * Pages that link to an already-resolved+visibility-checked page, via target_page_id
 * (id-backed — a rename of the target never breaks this). Called by
 * services/wiki.ts#getWikiBacklinks after it resolves idOrSlug and checks the caller
 * can see the target page itself.
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {Readonly<{id: string}>} page The target page after the caller's visibility check.
 * @returns {Promise<WikiBacklink[]>} The visible links from live pages to the target page.
 */
export const backlinksForResolvedPage = async function backlinksForResolvedPage(
  ctx: ServiceCtx,
  page: Readonly<{ id: string }>,
): Promise<WikiBacklink[]> {
  const orm = drizzle(ctx.db, { schema })
  const rows = await orm
    .select({
      linkId: schema.wikiLinks.id,
      targetTitle: schema.wikiLinks.targetTitle,
      pageId: schema.wikiPages.id,
      slug: schema.wikiPages.slug,
      title: schema.wikiPages.title,
      content: schema.wikiPages.content,
      projectId: schema.wikiPages.projectId,
    })
    .from(schema.wikiLinks)
    .innerJoin(schema.wikiPages, eq(schema.wikiPages.id, schema.wikiLinks.sourcePageId))
    .where(
      and(
        eq(schema.wikiLinks.workspaceId, ctx.workspaceId),
        eq(schema.wikiLinks.targetPageId, page.id),
        // PROJ-496: a trashed page's outgoing links don't count as backlinks anymore.
        isNull(schema.wikiPages.deletedAt),
      ),
    )

  /*
   * PROJ-311: a backlink from a project-scoped page the caller can't see shouldn't
   * leak that page's existence.
   */
  const visibleSourceIds = new Set(
    isWorkspaceAdmin(ctx.role)
      ? rows.map((row) => row.pageId)
      : await visibleSourcePageIds(
          ctx,
          rows.filter((row) => Predicate.isNotNullish(row.projectId)),
        ),
  )
  const visible = rows.filter((row) => Predicate.isNullish(row.projectId) || visibleSourceIds.has(row.pageId))

  return visible.map((row) => ({
    linkId: row.linkId,
    pageId: row.pageId,
    slug: row.slug,
    title: row.title,
    url: wikiPagePath(row.slug),
    snippet: extractSnippet(row.content, row.targetTitle),
  }))
}

export interface BrokenWikiLink {
  linkId: string
  sourcePageId: string
  sourceSlug: string
  sourceTitle: string
  targetTitle: string
}

/**
 * All unresolved (target_page_id null) wiki_links in the workspace, optionally scoped to a project.
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {unknown} input The request containing an optional source project filter.
 * @returns {Promise<BrokenWikiLink[]>} The visible links whose targets are missing, trashed or hidden.
 */
export const listBrokenWikiLinks = async function listBrokenWikiLinks(
  ctx: ServiceCtx,
  input: unknown,
): Promise<BrokenWikiLink[]> {
  const parsed = ListBrokenWikiLinksInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { projectId } = parsed.data

  const orm = drizzle(ctx.db, { schema })
  /*
   * PROJ-818: a link whose target lives in a project the caller can't see is reported
   * as broken, exactly as if no such page existed — otherwise "is this link broken?"
   * answers "does a page with this title exist in a project hidden from me?".
   * (Resolution itself is shared, stored data and stays visibility-agnostic; every read
   * of it is filtered for the caller instead: here, backlinks, backlink counts.)
   */
  const targetVisible = visibleProjectPredicate(ctx, sql`tp.project_id`)
  const targetHidden = targetVisible
    ? sql`EXISTS (SELECT 1 FROM wiki_pages tp WHERE tp.id = ${schema.wikiLinks.targetPageId}
				AND tp.project_id IS NOT NULL AND NOT ${targetVisible})`
    : sql`0`
  const conditions = [
    eq(schema.wikiLinks.workspaceId, ctx.workspaceId),
    /*
     * PROJ-496: a link is "broken" both when its target was hard-cleared (targetPageId
     * IS NULL, e.g. after purge) AND when its target still resolves to an id but that
     * page is now trashed — target_page_id isn't cleared until purge time anymore, so
     * without this second clause a link to a trashed-but-not-yet-purged page would
     * silently stop being reported as broken.
     */
    or(
      isNull(schema.wikiLinks.targetPageId),
      sql`EXISTS (SELECT 1 FROM wiki_pages tp WHERE tp.id = ${schema.wikiLinks.targetPageId}
				AND tp.deleted_at IS NOT NULL)`,
      targetHidden,
    ),
    /*
     * PROJ-496: a trashed source page's broken links aren't a maintenance concern
     * anymore — they'll be purged along with the page.
     */
    isNull(schema.wikiPages.deletedAt),
  ]
  if (Predicate.isNotNullish(projectId) && String.isNonEmpty(projectId)) {
    conditions.push(eq(schema.wikiPages.projectId, projectId))
  }

  /*
   * PROJ-311: same visibility filter as listWikiPages — hide project-scoped source
   * pages the caller isn't granted, workspace-level pages stay visible to everyone.
   */
  const visible = visibleProjectPredicate(ctx, schema.wikiPages.projectId)
  if (visible) {
    const cond = or(isNull(schema.wikiPages.projectId), visible)
    if (cond) {
      conditions.push(cond)
    }
  }

  const rows = await orm
    .select(
      fieldsInOrder([
        ['linkId', schema.wikiLinks.id],
        ['sourcePageId', schema.wikiPages.id],
        ['sourceSlug', schema.wikiPages.slug],
        ['sourceTitle', schema.wikiPages.title],
        ['targetTitle', schema.wikiLinks.targetTitle],
        ['targetText', schema.wikiLinks.targetText],
        ['hidden', sql<number>`${targetHidden}`],
      ]),
    )
    .from(schema.wikiLinks)
    .innerJoin(schema.wikiPages, eq(schema.wikiPages.id, schema.wikiLinks.sourcePageId))
    .where(and(...conditions))

  // For a hidden target, show the link as written, never the hidden page's own title
  // (a slug link's target_title is the resolved page's title).
  return rows.map(({ targetText, hidden, ...columns }) => ({
    ...columns,
    /*
     * A legacy resolved row has no target_text, and its target_title may be the hidden
     * page's own title — show nothing rather than leak it.
     */
    targetTitle: hidden ? (targetText ?? '') : columns.targetTitle,
  }))
}
