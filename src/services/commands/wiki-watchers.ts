import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { String, Array, Iterable, Predicate, Number } from 'effect'
import { flattenError } from 'zod'

import {
  ListWikiChangesInputSchema,
  ListWikiNotificationsInputSchema,
  MarkWikiNotificationsReadInputSchema,
  WatchWikiPageInputSchema,
} from '#contracts/inputs/wiki.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { wikiPagePath } from '#contracts/urls.ts'
/*
 * PROJ-493 (R11): watch/unwatch per page or subtree, a per-user notification list, and
 * list_wiki_changes — cheap delta polling for agents.
 *
 * No dependency on services/wiki.ts (avoids a circular import — wiki.ts calls into this
 * file's notifyWikiWatchers on every write). Page resolution + visibility checks are
 * duplicated in miniature here rather than imported, mirroring services/wiki-links.ts's
 * resolveSlugTargets precedent.
 */
import { drizzle, schema } from '#db'
import { SQL_NULL } from '#db/sql-null.ts'

import { assertProjectAccess, hasProjectAccess, usersWithProjectReadAccess } from './access.ts'
import { NotFoundError, ValidationError } from './errors.ts'
import { inChunks } from './sql.ts'
import type { ServiceCtx } from './types.ts'
import { idFirst, idOrSlugMatch, WIKI_MAX_NESTING_DEPTH } from './wiki-lookup.ts'

type Orm = ReturnType<typeof drizzle<typeof schema>>

interface ResolvedWatchTarget {
  id: string
  slug: string
  title: string
  projectId: string | null
  parentId: string | null
}

/*
 * PROJ-493: same id-or-slug + redirect-fallback resolution as services/wiki.ts's
 * resolvePageByIdOrSlug, plus the same project-visibility check as assertWikiPageVisible —
 * duplicated (not imported) to avoid a circular import, see module comment above.
 */
const resolveWatchTarget = async function resolveWatchTarget(
  ctx: ServiceCtx,
  idOrSlug: string,
): Promise<ResolvedWatchTarget> {
  const orm = drizzle(ctx.db, { schema })
  const direct = await orm
    .select(
      fieldsInOrder([
        ['id', schema.wikiPages.id],
        ['slug', schema.wikiPages.slug],
        ['title', schema.wikiPages.title],
        ['projectId', schema.wikiPages.projectId],
        ['parentId', schema.wikiPages.parentId],
      ]),
    )
    .from(schema.wikiPages)
    .where(
      and(
        idOrSlugMatch(idOrSlug),
        eq(schema.wikiPages.workspaceId, ctx.workspaceId),
        /*
         * PROJ-496: a trashed page can't be (un)watched — same "trashed = gone" rule
         * as every other page reference entry point (services/wiki.ts).
         */
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
        .select(
          fieldsInOrder([
            ['id', schema.wikiPages.id],
            ['slug', schema.wikiPages.slug],
            ['title', schema.wikiPages.title],
            ['projectId', schema.wikiPages.projectId],
            ['parentId', schema.wikiPages.parentId],
          ]),
        )
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
  if (!page) {
    throw new NotFoundError('Wiki page not found')
  }

  if (Predicate.isNotNullish(page.projectId)) {
    await assertProjectAccess(ctx, page.projectId, 'read', {
      notFoundMessage: 'Wiki page not found',
      projectLoadedFromWorkspaceRow: true,
    })
  }
  return page
}

export const watchWikiPage = async function watchWikiPage(
  ctx: ServiceCtx,
  idOrSlug: string,
  input: unknown,
): Promise<{ ok: boolean; pageId: string; subtree: boolean; url: string }> {
  const parsed = WatchWikiPageInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const page = await resolveWatchTarget(ctx, idOrSlug)

  const orm = drizzle(ctx.db, { schema })
  const now = currentEpochSeconds()
  await orm
    .insert(schema.wikiWatchers)
    .values(
      fieldsInOrder([
        ['id', crypto.randomUUID()],
        ['workspaceId', ctx.workspaceId],
        ['userId', ctx.userId],
        ['pageId', page.id],
        ['subtree', parsed.data.subtree],
        ['createdAt', now],
      ]),
    )
    .onConflictDoUpdate({
      target: [schema.wikiWatchers.workspaceId, schema.wikiWatchers.userId, schema.wikiWatchers.pageId],
      set: { subtree: parsed.data.subtree },
    })

  return { ok: true, pageId: page.id, subtree: parsed.data.subtree, url: wikiPagePath(page.slug) }
}

export const unwatchWikiPage = async function unwatchWikiPage(
  ctx: ServiceCtx,
  idOrSlug: string,
): Promise<{ ok: boolean }> {
  const page = await resolveWatchTarget(ctx, idOrSlug)
  const orm = drizzle(ctx.db, { schema })
  await orm
    .delete(schema.wikiWatchers)
    .where(
      and(
        eq(schema.wikiWatchers.workspaceId, ctx.workspaceId),
        eq(schema.wikiWatchers.userId, ctx.userId),
        eq(schema.wikiWatchers.pageId, page.id),
      ),
    )
  return { ok: true }
}

export const listWikiWatches = async function listWikiWatches(ctx: ServiceCtx) {
  const orm = drizzle(ctx.db, { schema })
  const rows = await orm
    .select(
      fieldsInOrder([
        ['id', schema.wikiWatchers.id],
        ['pageId', schema.wikiWatchers.pageId],
        ['subtree', schema.wikiWatchers.subtree],
        ['createdAt', schema.wikiWatchers.createdAt],
        ['slug', schema.wikiPages.slug],
        ['title', schema.wikiPages.title],
      ]),
    )
    .from(schema.wikiWatchers)
    .innerJoin(schema.wikiPages, eq(schema.wikiPages.id, schema.wikiWatchers.pageId))
    .where(
      and(
        eq(schema.wikiWatchers.workspaceId, ctx.workspaceId),
        eq(schema.wikiWatchers.userId, ctx.userId),
        /*
         * PROJ-496: a watch row on a page that's since been trashed lingers until
         * purge (deleteWikiWatchersForPages now only runs at purge time) — filtered
         * out here so the caller's watch list doesn't show a page they can't open.
         */
        isNull(schema.wikiPages.deletedAt),
      ),
    )
    .orderBy(desc(schema.wikiWatchers.createdAt))

  return rows.map((row) => ({ ...row, url: wikiPagePath(row.slug) }))
}

/*
 * PROJ-493/PROJ-820: walks UP from `pageId` through parent_id, bounded by the wiki's
 * own max nesting depth (WIKI_MAX_NESTING_DEPTH — services/wiki.ts's
 * validateParentDepth) plus one for headroom. Takes `parentId` explicitly (rather than
 * re-reading pageId's own row) so callers can use it for a page that's about to be
 * created (parentId known, pageId's row doesn't exist yet) or one that's mid-delete
 * (parentId captured before the row is removed).
 */
const resolveAncestorChain = async function resolveAncestorChain(
  db: D1Database,
  pageId: string,
  parentId: string | null,
  workspaceId: string,
): Promise<string[]> {
  const chain = [pageId]
  let cur = parentId
  let depth = 0
  while (Predicate.isNotNullish(cur) && String.isNonEmpty(cur) && depth < Number.increment(WIKI_MAX_NESTING_DEPTH)) {
    chain.push(cur)
    const row = await db
      .prepare('SELECT parent_id FROM wiki_pages WHERE id = ? AND workspace_id = ?')
      .bind(cur, workspaceId)
      .first<{ parent_id: string | null }>()
    if (!row?.parent_id) {
      break
    }
    cur = row.parent_id
    depth = Number.increment(depth)
  }
  return chain
}

const ACTION_LABEL: Record<'created' | 'updated' | 'deleted', string> = {
  created: 'Created',
  deleted: 'Deleted',
  updated: 'Updated',
}

/*
 * PROJ-493: called from services/wiki.ts after every create/update/patch/delete write
 * (not called at all when the affected page is currently flagged `is_template` — R9
 * template pages are scaffolding, not content watchers signed up to be notified about;
 * see the PR description for this reasoned call). A watch on page P matches a change to
 * page X when either P === X (a direct watch, regardless of its subtree flag) or P is a
 * PROPER ancestor of X and the watch has subtree=true. The actor is never notified of
 * their own change.
 */
export const notifyWikiWatchers = async function notifyWikiWatchers(
  ctx: ServiceCtx,
  opts: Readonly<{
    pageId: string
    parentId: string | null
    slug: string
    title: string
    action: 'created' | 'updated' | 'deleted'
  }>,
): Promise<void> {
  const ancestorIds = await resolveAncestorChain(ctx.db, opts.pageId, opts.parentId, ctx.workspaceId)
  const orm = drizzle(ctx.db, { schema })
  const rows = await orm
    .select({ userId: schema.wikiWatchers.userId })
    .from(schema.wikiWatchers)
    .where(
      and(
        eq(schema.wikiWatchers.workspaceId, ctx.workspaceId),
        inArray(schema.wikiWatchers.pageId, ancestorIds),
        or(eq(schema.wikiWatchers.pageId, opts.pageId), eq(schema.wikiWatchers.subtree, true)),
      ),
    )

  const userIds = [...new Set(rows.map((row) => row.userId))].filter((id) => id !== ctx.userId)
  if (Array.isArrayEmpty(userIds)) {
    return
  }

  await insertNotifications(
    ctx,
    orm,
    userIds.map((userId) => ({
      userId,
      pageId: opts.pageId,
      slug: opts.slug,
      title: opts.title,
      action: opts.action,
    })),
  )
}

/*
 * PROJ-821: a watch row outlives the watcher's access — a removed member, or one whose
 * group lost its grant on the page's project, must not keep receiving notifications
 * (which carry the page title). Access is checked per recipient at send time; watch
 * rows themselves are left alone, so restoring access restores notifications.
 */
const filterRecipientsWithAccess = async function filterRecipientsWithAccess<
  E extends { userId: string; pageId: string },
>(ctx: ServiceCtx, orm: Orm, entries: Readonly<E[]>): Promise<E[]> {
  const pageIds = [...new Set(entries.map((entry) => entry.pageId))]
  // Trashed pages are included on purpose: "deleted" notifications are sent for them.
  const pages = await inChunks(pageIds, (chunk) =>
    orm
      .select({ id: schema.wikiPages.id, projectId: schema.wikiPages.projectId })
      .from(schema.wikiPages)
      .where(and(eq(schema.wikiPages.workspaceId, ctx.workspaceId), inArray(schema.wikiPages.id, chunk))),
  )
  const projectOf = new Map(pages.map(({ id, projectId }) => [id, projectId ?? undefined]))

  const usersByProject = new Map<string | undefined, Set<string>>()
  Iterable.forEach(entries, (entry) => {
    if (!projectOf.has(entry.pageId)) {
      // Page not in this workspace — never deliver
      return
    }
    const projectId = projectOf.get(entry.pageId)
    const users = usersByProject.get(projectId) ?? new Set<string>()
    users.add(entry.userId)
    usersByProject.set(projectId, users)
  })
  const allowedByProject = new Map<string | undefined, Set<string>>()
  for (const [projectId, users] of usersByProject) {
    allowedByProject.set(projectId, await usersWithProjectReadAccess(ctx, projectId, [...users]))
  }

  return entries.filter((entry) => {
    if (!projectOf.has(entry.pageId)) {
      return false
    }
    return allowedByProject.get(projectOf.get(entry.pageId))?.has(entry.userId) ?? false
  })
}

async function insertNotifications(
  ctx: ServiceCtx,
  orm: Orm,
  entries: Readonly<
    {
      userId: string
      pageId: string
      slug: string
      title: string
      action: 'created' | 'updated' | 'deleted'
    }[]
  >,
): Promise<void> {
  if (Array.isReadonlyArrayEmpty(entries)) {
    return
  }
  const deliverable = await filterRecipientsWithAccess(ctx, orm, entries)
  if (Array.isArrayEmpty(deliverable)) {
    return
  }
  const now = currentEpochSeconds()
  const values = deliverable.map((e) => ({
    id: crypto.randomUUID(),
    workspaceId: ctx.workspaceId,
    userId: e.userId,
    pageId: e.pageId,
    pageSlug: e.slug,
    pageTitle: e.title,
    action: e.action,
    actorId: ctx.userId,
    summary: `${ACTION_LABEL[e.action]}: ${e.title}`,
    createdAt: now,
    readAt: SQL_NULL,
  }))

  /*
   * Each row binds 11 params; 8 rows/insert stays comfortably under D1's 100-param cap
   * (services/sql.ts#inChunks is calibrated for single-param-per-item IN-lists, not
   * multi-column inserts — same rationale as wiki-links.ts's LINK_INSERT_CHUNK_SIZE).
   */
  const NOTIFICATION_INSERT_CHUNK_SIZE = 8
  for (let index = 0; index < values.length; index += NOTIFICATION_INSERT_CHUNK_SIZE) {
    await orm.insert(schema.wikiNotifications).values(values.slice(index, index + NOTIFICATION_INSERT_CHUNK_SIZE))
  }
}

/*
 * PROJ-493: a cascade delete also removes every descendant page. Watchers rooted at (or
 * above) the cascade root already got the single root-level notification, but a watcher
 * whose watch row points AT one of the descendants matches only that descendant — without
 * this they'd be told nothing at all and then have their watch row removed underneath
 * them. One notification per (watcher, deleted descendant they watched).
 *
 * PROJ-496 follow-up: also used by undeleteWikiPage's cascade-restore path (action:
 * "updated") so a descendant watcher hears about the restore too, mirroring the delete
 * side — otherwise they'd get a "deleted" event with no matching "restored" one.
 */
export const notifyCascadeDescendantWatchers = async function notifyCascadeDescendantWatchers(
  ctx: ServiceCtx,
  descendants: Readonly<{ id: string; slug: string; title: string; isTemplate: boolean }[]>,
  action: 'created' | 'updated' | 'deleted' = 'deleted',
): Promise<void> {
  const pages = descendants.filter((p) => !p.isTemplate)
  if (Array.isArrayEmpty(pages)) {
    return
  }

  const orm = drizzle(ctx.db, { schema })
  const rows = await inChunks(
    pages.map((page) => page.id),
    (chunk) =>
      orm
        .select(
          fieldsInOrder([
            ['userId', schema.wikiWatchers.userId],
            ['pageId', schema.wikiWatchers.pageId],
          ]),
        )
        .from(schema.wikiWatchers)
        .where(and(eq(schema.wikiWatchers.workspaceId, ctx.workspaceId), inArray(schema.wikiWatchers.pageId, chunk))),
  )

  const byId = new Map(pages.map((page) => [page.id, page]))
  const entries = rows
    .filter((row) => row.userId !== ctx.userId)
    .flatMap((row) => {
      const page = byId.get(row.pageId)
      if (!page) {
        return []
      }
      return [
        {
          userId: row.userId,
          pageId: page.id,
          slug: page.slug,
          title: page.title,
          action,
        },
      ]
    })

  await insertNotifications(ctx, orm, entries)
}

/*
 * PROJ-493: mirror wiki_watchers.page_id's ON DELETE CASCADE at the app level, same
 * PROJ-407 precedent as deleteWikiPageAttachments/deleteWikiLinksForPages — D1 does not
 * guarantee FK enforcement on every connection, so leaning on the FK alone would leave
 * watch rows pointing at pages that no longer exist.
 */
export const deleteWikiWatchersForPages = async function deleteWikiWatchersForPages(
  ctx: ServiceCtx,
  pageIds: string[],
): Promise<void> {
  if (Array.isArrayEmpty(pageIds)) {
    return
  }
  const orm = drizzle(ctx.db, { schema })
  await inChunks(pageIds, async (chunk) => {
    await orm
      .delete(schema.wikiWatchers)
      .where(and(eq(schema.wikiWatchers.workspaceId, ctx.workspaceId), inArray(schema.wikiWatchers.pageId, chunk)))
    return []
  })
}

export const listWikiNotifications = async function listWikiNotifications(ctx: ServiceCtx, input: unknown) {
  const parsed = ListWikiNotificationsInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { unreadOnly, limit, offset } = parsed.data

  const orm = drizzle(ctx.db, { schema })
  const conditions = [
    eq(schema.wikiNotifications.workspaceId, ctx.workspaceId),
    eq(schema.wikiNotifications.userId, ctx.userId),
  ]
  if (unreadOnly) {
    conditions.push(isNull(schema.wikiNotifications.readAt))
  }

  const rows = await orm
    .select(
      fieldsInOrder([
        ['id', schema.wikiNotifications.id],
        ['pageId', schema.wikiNotifications.pageId],
        ['slug', schema.wikiNotifications.pageSlug],
        ['title', schema.wikiNotifications.pageTitle],
        ['action', schema.wikiNotifications.action],
        ['actorId', schema.wikiNotifications.actorId],
        ['summary', schema.wikiNotifications.summary],
        ['createdAt', schema.wikiNotifications.createdAt],
        ['readAt', schema.wikiNotifications.readAt],
      ]),
    )
    .from(schema.wikiNotifications)
    .where(and(...conditions))
    .orderBy(desc(schema.wikiNotifications.createdAt))
    .limit(limit)
    .offset(offset)

  return rows.map((row) => ({ ...row, url: wikiPagePath(row.slug) }))
}

export const markWikiNotificationsRead = async function markWikiNotificationsRead(
  ctx: ServiceCtx,
  input: unknown,
): Promise<{ ok: boolean }> {
  const parsed = MarkWikiNotificationsReadInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { ids, all } = parsed.data

  const orm = drizzle(ctx.db, { schema })
  const now = currentEpochSeconds()
  const conditions = [
    eq(schema.wikiNotifications.workspaceId, ctx.workspaceId),
    eq(schema.wikiNotifications.userId, ctx.userId),
  ]
  if (!all && ids) {
    await inChunks(ids, async (chunk) => {
      await orm
        .update(schema.wikiNotifications)
        .set({ readAt: now })
        .where(and(...conditions, inArray(schema.wikiNotifications.id, chunk)))
      return []
    })
  } else {
    await orm
      .update(schema.wikiNotifications)
      .set({ readAt: now })
      .where(and(...conditions))
  }

  return { ok: true }
}

export interface WikiChangeEvent {
  id: string
  action: 'created' | 'updated' | 'deleted'
  pageId: string
  slug: string | null
  title: string | null
  projectId: string | null
  actorId: string | null
  createdAt: number
  /*
   * PROJ-526: for a cascade delete's root event only — ids of every page removed by the
   * cascade, INCLUDING the root's own id (== `pageId`), capped at MAX_DELETED_PAGE_IDS.
   * null for every non-cascade event, so a poller building a local mirror can evict
   * these ids without needing a separate activity row per descendant. Note: post-R14
   * (PROJ-496), "deleted" here means "trashed" — the pages are recoverable via
   * undelete_wiki_page within the retention window, so a poller should treat eviction
   * as provisional, not permanent.
   */
  deletedPageIds: string[] | null
  /*
   * PROJ-526: true when the cascade exceeded MAX_DELETED_PAGE_IDS and deletedPageIds was
   * truncated — deletedCount on the same event still reports the true total, so a poller
   * can detect a truncated mirror-eviction list and fall back to a full resync.
   */
  deletedPageIdsTruncated: boolean
}

const parseJsonObject = function parseJsonObject(raw: string | null): Record<string, unknown> | undefined {
  if (Predicate.isNullish(raw) || String.isEmpty(raw)) {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/*
 * PROJ-493: for created/updated events, current page state (slug/title/projectId) is
 * read live off wiki_pages — always up to date even if the page changed again since.
 * For deleted events there's no current row, so the same fields captured at delete time
 * in the activity diff (services/wiki.ts#deleteWikiPage) are used instead — including
 * projectId, which is what lets a deleted project-scoped page's event still be hidden
 * from a caller who can't see that project (the workspace-scoping invariant applies to
 * deleted pages too, not just live ones).
 * PROJ-869: `diff` now arrives as the raw JSON text (see listWikiChanges' CASE
 * expression, which only selects it for 'deleted' rows) rather than pre-parsed, since a
 * raw sql fragment loses the wiki_pages.diff column's mode:"json" auto-decoding.
 */
const extractDeletedPageInfo = function extractDeletedPageInfo(rawDiff: string | null): {
  slug: string | null
  title: string | null
  projectId: string | null
  deletedPageIds: string[] | null
  deletedPageIdsTruncated: boolean
} {
  const diff = parseJsonObject(rawDiff)
  if (!diff) {
    return fieldsInOrder([
      ['slug', null],
      ['title', null],
      ['projectId', null],
      ['deletedPageIds', null],
      ['deletedPageIdsTruncated', false],
    ])
  }
  return fieldsInOrder([
    ['slug', Predicate.isString(diff.slug) ? diff.slug : null],
    ['title', Predicate.isString(diff.title) ? diff.title : null],
    ['projectId', Predicate.isString(diff.projectId) ? diff.projectId : null],
    /*
     * PROJ-526: only present on a cascade root's diff (services/wiki.ts#deleteWikiPage);
     * includes the root's own id — see WikiChangeEvent's doc for the full contract.
     */
    [
      'deletedPageIds',
      globalThis.Array.isArray(diff.deletedPageIds)
        ? diff.deletedPageIds.filter((id): id is string => Predicate.isString(id))
        : null,
    ],
    ['deletedPageIdsTruncated', diff.deletedPageIdsTruncated === true],
  ])
}

interface WikiActivityRow {
  id: string
  action: string
  entityId: string
  actorId: string | null
  // PROJ-869: raw JSON text, NULL for every non-'deleted' row (see listWikiChanges).
  diff: string | null
  createdAt: number
  pageSlug: string | null
  pageTitle: string | null
  pageProjectId: string | null
  pageDeletedAt: number | null
}

/*
 * PROJ-496: a "created"/"updated" event for a page that's now trashed is stale — the page
 * itself is excluded from every other read path, so the delta feed drops it too rather
 * than pointing an agent at a page get_wiki_page will 404 on. The "deleted" event for that
 * same trash action is NOT dropped: it's the one event that's supposed to report the page
 * went away.
 */
const eventFieldsFor = function eventFieldsFor(
  action: 'created' | 'updated' | 'deleted',
  r: WikiActivityRow,
): {
  slug: string | null
  title: string | null
  eventProjectId: string | null
  deleted: ReturnType<typeof extractDeletedPageInfo> | undefined
} {
  const deleted = action === 'deleted' ? extractDeletedPageInfo(r.diff) : undefined
  return fieldsInOrder([
    ['slug', deleted ? deleted.slug : r.pageSlug],
    ['title', deleted ? deleted.title : r.pageTitle],
    ['eventProjectId', deleted ? deleted.projectId : r.pageProjectId],
    ['deleted', deleted],
  ])
}

const isEventVisible = async function isEventVisible(
  projectId: string | undefined,
  eventProjectId: string | null,
  canSeeProject: (id: string) => Promise<boolean>,
): Promise<boolean> {
  if (Predicate.isNotNullish(projectId) && String.isNonEmpty(projectId)) {
    return eventProjectId === projectId
  }
  if (Predicate.isNullish(eventProjectId)) {
    return true
  }
  return canSeeProject(eventProjectId)
}

/*
 * Resolves one activity row to an event, or undefined if it should be dropped (stale
 * trash-shadowed row, wrong project, or not visible to the caller).
 */
const toWikiChangeEvent = async function toWikiChangeEvent(
  r: WikiActivityRow,
  projectId: string | undefined,
  canSeeProject: (id: string) => Promise<boolean>,
): Promise<WikiChangeEvent | undefined> {
  const action = r.action as 'created' | 'updated' | 'deleted'
  if (action !== 'deleted' && Predicate.isNotNullish(r.pageDeletedAt) && Predicate.isNotNullish(r.pageDeletedAt)) {
    return undefined
  }

  const { slug, title, eventProjectId, deleted } = eventFieldsFor(action, r)
  if (!(await isEventVisible(projectId, eventProjectId, canSeeProject))) {
    return undefined
  }

  return fieldsInOrder([
    ['id', r.id],
    ['action', action],
    ['pageId', r.entityId],
    ['slug', slug],
    ['title', title],
    ['projectId', eventProjectId],
    ['actorId', r.actorId],
    ['createdAt', r.createdAt],
    ['deletedPageIds', deleted?.deletedPageIds ?? null],
    ['deletedPageIdsTruncated', deleted?.deletedPageIdsTruncated ?? false],
  ])
}

/*
 * PROJ-493: resolves the (pageId -> is-watched) set for the caller, for list_wiki_changes'
 * watchedOnly filter. Mirrors notifyWikiWatchers' match rule (direct watch, or a
 * subtree watch on a proper ancestor) but walks the CURRENT tree — a page reparented out
 * of a watched subtree since the change occurred is (deliberately) not flagged watched,
 * same class of "current tree, not historical" approximation as the rest of this file.
 */
const loadWikiWatchSets = async function loadWikiWatchSets(
  ctx: ServiceCtx,
  orm: Orm,
): Promise<{ directWatchIds: Set<string>; subtreeRootIds: Set<string> }> {
  const watches = await orm
    .select({ pageId: schema.wikiWatchers.pageId, subtree: schema.wikiWatchers.subtree })
    .from(schema.wikiWatchers)
    .where(and(eq(schema.wikiWatchers.workspaceId, ctx.workspaceId), eq(schema.wikiWatchers.userId, ctx.userId)))
  return {
    directWatchIds: new Set(watches.map((watch) => watch.pageId)),
    subtreeRootIds: new Set(watches.filter((watch) => watch.subtree).map((watch) => watch.pageId)),
  }
}

/*
 * Walks every candidate's parent chain in lock-step — one batched query per tree level
 * (nesting is capped at WIKI_MAX_NESTING_DEPTH) rather than a per-candidate chain walk,
 * which would be O(candidates x depth) round-trips for a `limit` of up to 500. Mutates
 * `matched` in place.
 */
const matchSubtreeWatches = async function matchSubtreeWatches(
  ctx: ServiceCtx,
  orm: Orm,
  pending: Map<string, string>,
  subtreeRootIds: ReadonlySet<string>,
  matched: Set<string>,
): Promise<void> {
  for (
    let depth = 0;
    depth < Number.increment(WIKI_MAX_NESTING_DEPTH) && pending.size > 0;
    depth = Number.increment(depth)
  ) {
    const frontier = [...new Set(pending.values())]
    const rows = await inChunks(frontier, (chunk) =>
      orm
        .select({ id: schema.wikiPages.id, parentId: schema.wikiPages.parentId })
        .from(schema.wikiPages)
        .where(and(inArray(schema.wikiPages.id, chunk), eq(schema.wikiPages.workspaceId, ctx.workspaceId))),
    )
    const parentOf = new Map(rows.map((row) => [row.id, row.parentId]))
    Iterable.forEach(pending, ([candidate, cur]) => {
      const parent = parentOf.get(cur)
      if (Predicate.isNullish(parent)) {
        pending.delete(candidate)
      } else if (subtreeRootIds.has(parent)) {
        matched.add(candidate)
        pending.delete(candidate)
      } else {
        pending.set(candidate, parent)
      }
    })
  }
}

const watchedPageIds = async function watchedPageIds(
  ctx: ServiceCtx,
  orm: Orm,
  candidatePageIds: string[],
): Promise<Set<string>> {
  const { directWatchIds, subtreeRootIds } = await loadWikiWatchSets(ctx, orm)
  if (directWatchIds.size === 0 && subtreeRootIds.size === 0) {
    return new Set()
  }

  const matched = new Set<string>()
  // Candidate page -> the ancestor its chain walk has currently reached.
  const pending = new Map<string, string>()
  Iterable.forEach(new Set(candidatePageIds), (pageId) => {
    if (directWatchIds.has(pageId)) {
      matched.add(pageId)
      return
    }
    if (subtreeRootIds.size > 0) {
      pending.set(pageId, pageId)
    }
  })

  await matchSubtreeWatches(ctx, orm, pending, subtreeRootIds, matched)
  return matched
}

/*
 * `since` is second-granular and exclusive, so a batch cut off mid-second by `limit` would
 * strand the rest of that second: the caller polls with nextSince = that second and `gt`
 * skips them forever. Drop the trailing partial second instead, so the next poll picks it
 * up whole. (If the WHOLE batch is one second there's nothing to trim — that needs `limit`
 * changes inside a single second, and the alternative is a poll that can never advance.)
 */
const trimTrailingPartialSecond = function trimTrailingPartialSecond<T extends { createdAt: number }>(
  rows: Readonly<T[]>,
  limit: number,
): Readonly<T[]> {
  if (rows.length !== limit || !Array.isReadonlyArrayNonEmpty(rows)) {
    return rows
  }
  const maxTs = Array.lastNonEmpty(rows).createdAt
  if (rows[0].createdAt === maxTs) {
    return rows
  }
  return rows.filter((row) => row.createdAt < maxTs)
}

/*
 * PROJ-493 (R11): cheap delta feed — piggybacks entirely on the `activity` table every
 * wiki_page write already populates (services/activity.ts#recordActivity, called from
 * every create/update/patch/delete path in services/wiki.ts) rather than a separate
 * change log. Defaults to every wiki page the caller can see (same visibility rule as
 * list_wiki_pages/search_wiki), NOT scoped to watched pages by default — a delta-polling
 * agent syncing "what changed in the wiki" is a broader use case than "what am I
 * watching", and requiring a watch registration for every page an agent wants to poll
 * would defeat the point of a cheap, low-ceremony polling tool. Pass watchedOnly=true to
 * narrow to watched pages. Unlike notifyWikiWatchers, this does NOT exclude template
 * pages — it's a ground-truth delta feed, not a notification stream, and callers that
 * care can filter client-side on the page's `type`/`is_template` themselves.
 */
export const listWikiChanges = async function listWikiChanges(
  ctx: ServiceCtx,
  input: unknown,
): Promise<{
  changes: WikiChangeEvent[]
  nextSince: number
}> {
  const parsed = ListWikiChangesInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { since, limit, projectId, watchedOnly } = parsed.data

  if (Predicate.isNotNullish(projectId) && String.isNonEmpty(projectId)) {
    if (!(await hasProjectAccess(ctx, projectId))) {
      return { changes: [], nextSince: since }
    }
  }

  const orm = drizzle(ctx.db, { schema })
  const rows = await orm
    .select(
      fieldsInOrder([
        ['id', schema.activity.id],
        ['action', schema.activity.action],
        ['entityId', schema.activity.entityId],
        ['actorId', schema.activity.actorId],
        /*
         * PROJ-869: only 'deleted' events read `diff` at all (extractDeletedPageInfo,
         * for the small slug/title/projectId/deletedPageIds fields it captures) — every
         * other action returns NULL here instead of D1 shipping the full diff blob back
         * for every row, which is what made list_wiki_changes' response size scale with
         * page content size.
         */
        [
          'diff',
          sql<
            string | null
          >`CASE WHEN ${schema.activity.action} = 'deleted' THEN ${schema.activity.diff} ELSE NULL END`,
        ],
        ['createdAt', schema.activity.createdAt],
        ['pageSlug', schema.wikiPages.slug],
        ['pageTitle', schema.wikiPages.title],
        ['pageProjectId', schema.wikiPages.projectId],
        ['pageDeletedAt', schema.wikiPages.deletedAt],
      ]),
    )
    .from(schema.activity)
    .leftJoin(schema.wikiPages, eq(schema.wikiPages.id, schema.activity.entityId))
    .where(
      and(
        eq(schema.activity.workspaceId, ctx.workspaceId),
        eq(schema.activity.entityType, 'wiki_page'),
        gt(schema.activity.createdAt, since),
      ),
    )
    .orderBy(schema.activity.createdAt)
    .limit(limit)

  const batch = trimTrailingPartialSecond(rows, limit)

  // One role lookup per distinct project in the batch, not per event.
  const roleCache = new Map<string, boolean>()
  const canSeeProject = async (id: string): Promise<boolean> => {
    const cached = roleCache.get(id)
    if (Predicate.isNotNullish(cached)) {
      return cached
    }
    const visible = await hasProjectAccess(ctx, id)
    roleCache.set(id, visible)
    return visible
  }

  let nextSince = since
  const events: WikiChangeEvent[] = []
  for (const r of batch) {
    if (r.createdAt > nextSince) {
      nextSince = r.createdAt
    }
    const event = await toWikiChangeEvent(r, projectId, canSeeProject)
    if (event) {
      events.push(event)
    }
  }

  if (watchedOnly) {
    const watched = await watchedPageIds(
      ctx,
      orm,
      events.map((selectedEvent) => selectedEvent.pageId),
    )
    return {
      changes: events.filter((selectedEvent) => watched.has(selectedEvent.pageId)),
      nextSince,
    }
  }

  return { changes: events, nextSince }
}
