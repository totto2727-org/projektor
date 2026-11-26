import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SelectResultFields } from 'drizzle-orm/query-builders/select.types'
import { Array, Iterable, Predicate, Number } from 'effect'
import type { Effect } from 'effect'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { drizzle, schema } from '#db'

import { queryEffect } from './errors.ts'
import type { DataQueryError } from './errors.ts'

/** Validated filters. Authorization predicates are supplied by the calling app. */
export interface WikiScopeOptions {
  projectId?: string
  includeWorkspacePages?: boolean
  /** Trusted predicate against wikiPages.projectId. Include workspace pages in the app predicate. */
  visibility?: SQL
}
export interface WikiListOptions extends WikiScopeOptions {
  parentId?: string
  type?: string
  status?: string
  tags?: Readonly<string[]>
  includeTemplates?: boolean
}
export interface WikiPageOptions extends WikiScopeOptions {
  limit: number
  offset: number
}
export interface WikiSearchOptions extends Omit<WikiPageOptions, 'visibility'> {
  updatedSince?: number
  type?: string
  status?: string
  tags?: Readonly<string[]>
  now: number
  /** Trusted app-authored fragment using alias p. Never accept request SQL. */
  visibilitySql?: { sql: string; params: Readonly<unknown[]> }
}

export interface WikiSearchResult {
  id: string
  slug: string
  title: string
  project_id: string | null
  type: string | null
  tags: string[]
  status: string | null
  verified_at: number | null
  verified_by: string | null
  owners: string[]
  verify_interval: number | null
  excerpt: string
  rank: number
}

const summaryColumns = {
  id: schema.wikiPages.id,
  slug: schema.wikiPages.slug,
  title: schema.wikiPages.title,
  parent_id: schema.wikiPages.parentId,
  project_id: schema.wikiPages.projectId,
  updated_at: schema.wikiPages.updatedAt,
  type: schema.wikiPages.type,
  tags: schema.wikiPages.tags,
  status: schema.wikiPages.status,
  verified_at: schema.wikiPages.verifiedAt,
  verified_by: schema.wikiPages.verifiedBy,
  owners: schema.wikiPages.owners,
  verify_interval: schema.wikiPages.verifyInterval,
  is_template: schema.wikiPages.isTemplate,
}
const detailColumns = { ...summaryColumns, content: schema.wikiPages.content }

type WikiPageSummary = SelectResultFields<typeof summaryColumns>
type WikiPageDetail = SelectResultFields<typeof detailColumns>
type WikiPageRow = typeof schema.wikiPages.$inferSelect
type RedirectedWikiPage = WikiPageDetail & { version: WikiPageRow['version'] }
type TrashedWikiPage = Pick<WikiPageSummary, 'id' | 'slug' | 'title' | 'parent_id' | 'project_id'> & {
  deleted_at: WikiPageRow['deletedAt']
}
type StaleWikiPage = Pick<
  WikiPageSummary,
  'id' | 'slug' | 'title' | 'project_id' | 'status' | 'verified_at' | 'verified_by' | 'verify_interval' | 'updated_at'
>

const scopeConditions = function scopeConditions(workspaceId: string, opts: WikiScopeOptions, trash = false): SQL[] {
  const conditions = [
    eq(schema.wikiPages.workspaceId, workspaceId),
    trash ? isNotNull(schema.wikiPages.deletedAt) : isNull(schema.wikiPages.deletedAt),
  ]
  if (isNonEmptyText(opts.projectId)) {
    const scope =
      opts.includeWorkspacePages === true
        ? or(eq(schema.wikiPages.projectId, opts.projectId), isNull(schema.wikiPages.projectId))
        : eq(schema.wikiPages.projectId, opts.projectId)
    if (scope) {
      conditions.push(scope)
    }
  }
  if (opts.visibility) {
    conditions.push(opts.visibility)
  }
  return conditions
}

export const listWikiPages = function listWikiPages(
  db: D1Database,
  workspaceId: string,
  opts: WikiListOptions = {},
): Effect.Effect<WikiPageSummary[], DataQueryError> {
  return queryEffect('listWikiPages', () => {
    const conditions = scopeConditions(workspaceId, opts)
    if (isNonEmptyText(opts.parentId)) {
      conditions.push(eq(schema.wikiPages.parentId, opts.parentId))
    }
    if (isNonEmptyText(opts.type)) {
      conditions.push(eq(schema.wikiPages.type, opts.type))
    }
    if (isNonEmptyText(opts.status)) {
      conditions.push(eq(schema.wikiPages.status, opts.status))
    }
    if (opts.tags?.length) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM json_each(${schema.wikiPages.tags}) WHERE value IN (${sql.join(
          opts.tags.map((tag) => sql`${tag}`),
          sql`, `,
        )}))`,
      )
    }
    if (opts.includeTemplates !== true) {
      conditions.push(eq(schema.wikiPages.isTemplate, false))
    }
    return drizzle(db, { schema })
      .select(summaryColumns)
      .from(schema.wikiPages)
      .where(and(...conditions))
      .orderBy(asc(schema.wikiPages.title))
  })
}

export const listWikiTreeRows = function listWikiTreeRows(
  db: D1Database,
  workspaceId: string,
  opts: WikiScopeOptions = {},
): Effect.Effect<
  Pick<typeof schema.wikiPages.$inferSelect, 'id' | 'slug' | 'title' | 'parentId' | 'projectId' | 'type'>[],
  DataQueryError
> {
  return queryEffect('listWikiTreeRows', () =>
    drizzle(db, { schema })
      .select({
        id: schema.wikiPages.id,
        slug: schema.wikiPages.slug,
        title: schema.wikiPages.title,
        parentId: schema.wikiPages.parentId,
        projectId: schema.wikiPages.projectId,
        type: schema.wikiPages.type,
      })
      .from(schema.wikiPages)
      .where(and(...scopeConditions(workspaceId, opts)))
      .orderBy(asc(schema.wikiPages.title)),
  )
}

/**
 * Live id wins over a colliding slug, then single-hop historical-slug fallback.
 *
 * @param {D1Database} db Database that stores pages and slug redirects.
 * @param {string} workspaceId Workspace that owns the page.
 * @param {string} idOrSlug Page identifier or slug.
 * @returns {Effect.Effect<WikiPageDetail | RedirectedWikiPage | undefined, DataQueryError>} The matching live page, if one exists.
 */
export const findWikiPage = function findWikiPage(
  db: D1Database,
  workspaceId: string,
  idOrSlug: string,
): Effect.Effect<WikiPageDetail | RedirectedWikiPage | undefined, DataQueryError> {
  return queryEffect('findWikiPage', async () => {
    const orm = drizzle(db, { schema })
    const direct = await orm
      .select(detailColumns)
      .from(schema.wikiPages)
      .where(
        and(
          or(eq(schema.wikiPages.id, idOrSlug), eq(schema.wikiPages.slug, idOrSlug)),
          eq(schema.wikiPages.workspaceId, workspaceId),
          isNull(schema.wikiPages.deletedAt),
        ),
      )
      .orderBy(sql`CASE WHEN ${schema.wikiPages.id} = ${idOrSlug} THEN 0 ELSE 1 END`)
      .get()
    if (direct) {
      return direct
    }
    const redirect = await orm
      .select({ pageId: schema.wikiRedirects.pageId })
      .from(schema.wikiRedirects)
      .where(and(eq(schema.wikiRedirects.workspaceId, workspaceId), eq(schema.wikiRedirects.oldSlug, idOrSlug)))
      .get()
    // Existing detail contracts include version only on historical-slug fallback.
    return redirect
      ? orm
          .select({ ...detailColumns, version: schema.wikiPages.version })
          .from(schema.wikiPages)
          .where(
            and(
              eq(schema.wikiPages.id, redirect.pageId),
              eq(schema.wikiPages.workspaceId, workspaceId),
              isNull(schema.wikiPages.deletedAt),
            ),
          )
          .get()
      : undefined
  })
}

export const listWikiTemplates = function listWikiTemplates(
  db: D1Database,
  workspaceId: string,
  opts: WikiScopeOptions = {},
): Effect.Effect<Pick<WikiPageSummary, 'id' | 'slug' | 'title' | 'project_id' | 'type'>[], DataQueryError> {
  return queryEffect('listWikiTemplates', () =>
    drizzle(db, { schema })
      .select({
        id: schema.wikiPages.id,
        slug: schema.wikiPages.slug,
        title: schema.wikiPages.title,
        project_id: schema.wikiPages.projectId,
        type: schema.wikiPages.type,
      })
      .from(schema.wikiPages)
      .where(and(...scopeConditions(workspaceId, opts), eq(schema.wikiPages.isTemplate, true)))
      .orderBy(asc(schema.wikiPages.title)),
  )
}

export const listWikiTrash = function listWikiTrash(
  db: D1Database,
  workspaceId: string,
  opts: WikiPageOptions,
): Effect.Effect<TrashedWikiPage[], DataQueryError> {
  return queryEffect('listWikiTrash', () =>
    drizzle(db, { schema })
      .select({
        id: schema.wikiPages.id,
        slug: schema.wikiPages.slug,
        title: schema.wikiPages.title,
        parent_id: schema.wikiPages.parentId,
        project_id: schema.wikiPages.projectId,
        deleted_at: schema.wikiPages.deletedAt,
      })
      .from(schema.wikiPages)
      .where(and(...scopeConditions(workspaceId, opts, true)))
      .orderBy(desc(schema.wikiPages.deletedAt))
      .limit(opts.limit)
      .offset(opts.offset),
  )
}

export const listStaleWikiPages = function listStaleWikiPages(
  db: D1Database,
  workspaceId: string,
  opts: WikiPageOptions & { now: number },
): Effect.Effect<StaleWikiPage[], DataQueryError> {
  return queryEffect('listStaleWikiPages', () =>
    drizzle(db, { schema })
      .select({
        id: schema.wikiPages.id,
        slug: schema.wikiPages.slug,
        title: schema.wikiPages.title,
        project_id: schema.wikiPages.projectId,
        status: schema.wikiPages.status,
        verified_at: schema.wikiPages.verifiedAt,
        verified_by: schema.wikiPages.verifiedBy,
        verify_interval: schema.wikiPages.verifyInterval,
        updated_at: schema.wikiPages.updatedAt,
      })
      .from(schema.wikiPages)
      .where(
        and(
          ...scopeConditions(workspaceId, opts),
          eq(schema.wikiPages.isTemplate, false),
          sql`(
		${schema.wikiPages.status} IN ('stale', 'deprecated') OR (${schema.wikiPages.verifyInterval} IS NOT NULL AND
		(${schema.wikiPages.verifiedAt} IS NULL OR (${schema.wikiPages.verifiedAt} + ${schema.wikiPages.verifyInterval} * 86400) <= ${opts.now})))`,
        ),
      )
      .orderBy(asc(schema.wikiPages.updatedAt))
      .limit(opts.limit)
      .offset(opts.offset),
  )
}

const revisionColumns = {
  id: schema.wikiRevisions.id,
  title: schema.wikiRevisions.title,
  summary: schema.wikiRevisions.summary,
  author_id: schema.wikiRevisions.authorId,
  created_at: schema.wikiRevisions.createdAt,
}
type WikiRevisionProjection = SelectResultFields<typeof revisionColumns>
type WikiRevisionSummary = WikiRevisionProjection & { author_name: (typeof schema.users.$inferSelect)['name'] | null }
type WikiRevisionDetail = WikiRevisionProjection & { content: (typeof schema.wikiRevisions.$inferSelect)['content'] }
const revisionScope = function revisionScope(workspaceId: string, pageId: string): SQL | undefined {
  return and(
    eq(schema.wikiRevisions.pageId, pageId),
    sql`EXISTS (SELECT 1 FROM wiki_pages WHERE wiki_pages.id = ${schema.wikiRevisions.pageId} AND wiki_pages.workspace_id = ${workspaceId})`,
  )
}
export const listWikiRevisions = function listWikiRevisions(
  db: D1Database,
  workspaceId: string,
  pageId: string,
): Effect.Effect<WikiRevisionSummary[], DataQueryError> {
  return queryEffect('listWikiRevisions', () =>
    drizzle(db, { schema })
      .select({ ...revisionColumns, author_name: schema.users.name })
      .from(schema.wikiRevisions)
      .leftJoin(schema.users, eq(schema.wikiRevisions.authorId, schema.users.id))
      .where(revisionScope(workspaceId, pageId))
      .orderBy(desc(schema.wikiRevisions.createdAt), desc(sql`wiki_revisions.rowid`)),
  )
}
export const getWikiRevision = function getWikiRevision(
  db: D1Database,
  workspaceId: string,
  pageId: string,
  revisionId: string,
): Effect.Effect<WikiRevisionDetail | undefined, DataQueryError> {
  return queryEffect('getWikiRevision', () =>
    drizzle(db, { schema })
      .select({ ...revisionColumns, content: schema.wikiRevisions.content })
      .from(schema.wikiRevisions)
      .where(and(revisionScope(workspaceId, pageId), eq(schema.wikiRevisions.id, revisionId)))
      .get(),
  )
}
export const getLatestWikiRevisionId = function getLatestWikiRevisionId(
  db: D1Database,
  workspaceId: string,
  pageId: string,
): Effect.Effect<string | null, DataQueryError> {
  return queryEffect('getLatestWikiRevisionId', async () => {
    const row = await drizzle(db, { schema })
      .select({ id: schema.wikiRevisions.id })
      .from(schema.wikiRevisions)
      .where(revisionScope(workspaceId, pageId))
      .orderBy(desc(schema.wikiRevisions.createdAt), desc(sql`wiki_revisions.rowid`))
      .get()
    return row?.id ?? null
  })
}

const decodeJsonArrayColumn = function decodeJsonArrayColumn(value: unknown): string[] {
  if (globalThis.Array.isArray(value)) {
    return value as string[]
  }
  if (!Predicate.isString(value)) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(value)
    return globalThis.Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const appendWikiSearchScope = function appendWikiSearchScope(
  clauses: string[],
  params: unknown[],
  opts: WikiSearchOptions,
): void {
  if (isNonEmptyText(opts.projectId)) {
    clauses.push(
      opts.includeWorkspacePages === true ? ' AND (p.project_id = ? OR p.project_id IS NULL)' : ' AND p.project_id = ?',
    )
    params.push(opts.projectId)
  }
  if (opts.visibilitySql) {
    clauses.push(` AND (${opts.visibilitySql.sql})`)
    params.push(...opts.visibilitySql.params)
  }
  if (Predicate.isNotNullish(opts.updatedSince)) {
    clauses.push(' AND p.updated_at >= ?')
    params.push(opts.updatedSince)
  }
}

const appendWikiSearchMetadata = function appendWikiSearchMetadata(
  clauses: string[],
  params: unknown[],
  opts: WikiSearchOptions,
): void {
  if (isNonEmptyText(opts.type)) {
    clauses.push(' AND p.type = ?')
    params.push(opts.type)
  }
  if (isNonEmptyText(opts.status)) {
    clauses.push(' AND p.status = ?')
    params.push(opts.status)
  }
  if (opts.tags?.length) {
    clauses.push(` AND EXISTS (SELECT 1 FROM json_each(p.tags) WHERE value IN (${opts.tags.map(() => '?').join(',')}))`)
    params.push(...opts.tags)
  }
}

/**
 * FTS sanitization and permission decisions belong to the app.
 *
 * @param {D1Database} db Database that stores pages and the search index.
 * @param {string} workspaceId Workspace whose pages to search.
 * @param {string} ftsQuery Search expression after the application validates the syntax.
 * @param {WikiSearchOptions} opts Filters, paging, visibility and the current time.
 * @returns {Effect.Effect<WikiSearchResult[], DataQueryError>} The requested page of search results.
 */
export const searchWiki = function searchWiki(
  db: D1Database,
  workspaceId: string,
  ftsQuery: string,
  opts: WikiSearchOptions,
): Effect.Effect<WikiSearchResult[], DataQueryError> {
  return queryEffect('searchWiki', async () => {
    if (!ftsQuery) {
      return []
    }
    const clauses = [
      `SELECT p.id, p.slug, p.title, p.project_id, p.type, p.tags, p.status, p.verified_at, p.verified_by, p.owners, p.verify_interval,
		 snippet(wiki_fts, -1, '**', '**', '…', 24) as excerpt, bm25(wiki_fts, 0, 0, 10.0, 1.0, 5.0) as rank
		 FROM wiki_fts JOIN wiki_pages p ON p.id = wiki_fts.page_id
		 WHERE wiki_fts MATCH ? AND wiki_fts.workspace_id = ? AND p.workspace_id = ? AND p.is_template = 0 AND p.deleted_at IS NULL`,
    ]
    const params: unknown[] = [ftsQuery, workspaceId, workspaceId]
    appendWikiSearchScope(clauses, params, opts)
    appendWikiSearchMetadata(clauses, params, opts)
    clauses.push(
      ` ORDER BY (CASE WHEN (p.status IN ('stale', 'deprecated') OR (p.verify_interval IS NOT NULL AND p.verified_at IS NOT NULL AND (p.verified_at + p.verify_interval * 86400) <= ?)) THEN 1 ELSE 0 END), bm25(wiki_fts, 0, 0, 10.0, 1.0, 5.0), p.id LIMIT ? OFFSET ?`,
    )
    params.push(opts.now, opts.limit, opts.offset)
    const { results } = await db
      .prepare(clauses.join(''))
      .bind(...params)
      .all<Omit<WikiSearchResult, 'tags' | 'owners'> & { tags: unknown; owners: unknown }>()
    return results.map((row) => ({
      ...row,
      tags: decodeJsonArrayColumn(row.tags),
      owners: decodeJsonArrayColumn(row.owners),
    }))
  })
}

export const getWikiDraft = function getWikiDraft(
  db: D1Database,
  workspaceId: string,
  pageId: string,
  userId: string,
): Effect.Effect<
  Pick<typeof schema.wikiDrafts.$inferSelect, 'title' | 'content' | 'baseRevisionId' | 'updatedAt'> | null,
  DataQueryError
> {
  return queryEffect('getWikiDraft', async () => {
    const row = await drizzle(db, { schema })
      .select({
        title: schema.wikiDrafts.title,
        content: schema.wikiDrafts.content,
        baseRevisionId: schema.wikiDrafts.baseRevisionId,
        updatedAt: schema.wikiDrafts.updatedAt,
      })
      .from(schema.wikiDrafts)
      .where(
        and(
          eq(schema.wikiDrafts.workspaceId, workspaceId),
          eq(schema.wikiDrafts.pageId, pageId),
          eq(schema.wikiDrafts.userId, userId),
        ),
      )
      .get()
    return row ?? null
  })
}

// Bounded LCS preserves the existing wiki conflict/revision diff contract.
const MAX_DIFF_CELLS = 1_000_000
const EMPTY_LCS_LENGTH = 0
const FIRST_LINE_INDEX = 0
const CHANGE_AFTER_FIRST = 1
const DIFF_CONTEXT_EDGES = 2
interface DiffOp {
  type: 'equal' | 'add' | 'remove'
  line: string
}

const buildLcsTable = function buildLcsTable(oldLines: Readonly<string[]>, newLines: Readonly<string[]>): number[][] {
  const oldCount = oldLines.length
  const newCount = newLines.length
  const dp: number[][] = globalThis.Array.from({ length: Number.increment(oldCount) }, () =>
    globalThis.Array.from({ length: Number.increment(newCount) }, () => EMPTY_LCS_LENGTH),
  )
  for (let index = Number.decrement(oldCount); index >= FIRST_LINE_INDEX; index = Number.decrement(index)) {
    for (
      let newIndex = Number.decrement(newCount);
      newIndex >= FIRST_LINE_INDEX;
      newIndex = Number.decrement(newIndex)
    ) {
      dp[index][newIndex] =
        oldLines[index] === newLines[newIndex]
          ? Number.increment(dp[Number.increment(index)][Number.increment(newIndex)])
          : Math.max(dp[Number.increment(index)][newIndex], dp[index][Number.increment(newIndex)])
    }
  }
  return dp
}

const traceLcsDiffOps = function traceLcsDiffOps(
  oldLines: Readonly<string[]>,
  newLines: Readonly<string[]>,
  dp: Readonly<number[][]>,
): DiffOp[] {
  const oldCount = oldLines.length
  const newCount = newLines.length
  const ops: DiffOp[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldCount && newIndex < newCount) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      ops.push({ type: 'equal', line: oldLines[oldIndex] })
      oldIndex = Number.increment(oldIndex)
      newIndex = Number.increment(newIndex)
    } else if (dp[Number.increment(oldIndex)][newIndex] >= dp[oldIndex][Number.increment(newIndex)]) {
      ops.push({ type: 'remove', line: oldLines[oldIndex] })
      oldIndex = Number.increment(oldIndex)
    } else {
      ops.push({ type: 'add', line: newLines[newIndex] })
      newIndex = Number.increment(newIndex)
    }
  }
  while (oldIndex < oldCount) {
    ops.push({ type: 'remove', line: oldLines[oldIndex] })
    oldIndex = Number.increment(oldIndex)
  }
  while (newIndex < newCount) {
    ops.push({ type: 'add', line: newLines[newIndex] })
    newIndex = Number.increment(newIndex)
  }
  return ops
}

const computeLineDiff = function computeLineDiff(oldLines: Readonly<string[]>, newLines: Readonly<string[]>): DiffOp[] {
  if (oldLines.length * newLines.length > MAX_DIFF_CELLS) {
    return [
      ...oldLines.map((line): DiffOp => ({ type: 'remove', line })),
      ...newLines.map((line): DiffOp => ({ type: 'add', line })),
    ]
  }
  return traceLcsDiffOps(oldLines, newLines, buildLcsTable(oldLines, newLines))
}

export const buildUnifiedDiff = function buildUnifiedDiff(baseContent: string, currentContent: string): string {
  if (baseContent === currentContent) {
    return ''
  }
  const ops = computeLineDiff(baseContent.split('\n'), currentContent.split('\n'))
  const CONTEXT = 3
  const changeIdxs = ops.reduce<number[]>((acc, op, idx) => {
    if (op.type !== 'equal') {
      acc.push(idx)
    }
    return acc
  }, [])
  if (Array.isArrayEmpty(changeIdxs)) {
    return ''
  }
  const groups: [number, number][] = []
  let groupStart = changeIdxs[0]
  let groupEnd = changeIdxs[0]
  Iterable.forEach(changeIdxs.slice(CHANGE_AFTER_FIRST), (idx) => {
    if (idx - groupEnd <= CONTEXT * DIFF_CONTEXT_EDGES) {
      groupEnd = idx
    } else {
      groups.push([groupStart, groupEnd])
      groupStart = idx
      groupEnd = idx
    }
  })
  groups.push([groupStart, groupEnd])
  const hunks: string[] = []
  Iterable.forEach(groups, ([gStart, gEnd]) => {
    const sliceStart = Math.max(FIRST_LINE_INDEX, gStart - CONTEXT)
    const sliceEnd = Math.min(Number.decrement(ops.length), gEnd + CONTEXT)
    const slice = ops.slice(sliceStart, Number.increment(sliceEnd))
    let oldStart = 1
    let newStart = 1
    for (let index = 0; index < sliceStart; index = Number.increment(index)) {
      if (ops[index].type !== 'add') {
        oldStart = Number.increment(oldStart)
      }
      if (ops[index].type !== 'remove') {
        newStart = Number.increment(newStart)
      }
    }
    const oldCount = slice.filter((op) => op.type !== 'add').length
    const newCount = slice.filter((op) => op.type !== 'remove').length
    const lines = slice.map((op) => `${op.type === 'add' ? '+' : op.type === 'remove' ? '-' : ' '}${op.line}`)
    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${lines.join('\n')}`)
  })
  return `--- base\n+++ current\n${hunks.join('\n')}`
}
