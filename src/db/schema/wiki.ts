import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { users, workspaces } from './core.ts'
import { wikiPages } from './wiki-pages.ts'

export { wikiPages } from './wiki-pages.ts'

const wikiRevisionsColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'pageId',
    text('page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
  ],
  ['content', text('content').notNull()],
  // PROJ-484: page title at the time of this revision (0042_wiki_revision_title_summary.sql).
  ['title', text('title').notNull().default('')],
  // PROJ-484: optional edit message/changelog note supplied by the writer.
  ['summary', text('summary')],
  [
    'authorId',
    text('author_id')
      .notNull()
      .references(() => users.id),
  ],
  ['createdAt', integer('created_at').notNull()],
])

export const wikiRevisions = sqliteTable('wiki_revisions', wikiRevisionsColumns, (table) => [
  index('wiki_revisions_page_idx').on(table.pageId),
])

const wikiRedirectsColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  ['oldSlug', text('old_slug').notNull()],
  [
    'pageId',
    text('page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
  ],
  ['createdAt', integer('created_at').notNull()],
])

/*
 * PROJ-483: old slug -> page id, written whenever a page's slug changes (services/wiki.ts
 * updateWikiPage). Redirects always point at the page's current id, never at another
 * slug, so a page renamed repeatedly never forms a redirect -> redirect chain.
 */
export const wikiRedirects = sqliteTable('wiki_redirects', wikiRedirectsColumns, (table) => [
  uniqueIndex('wiki_redirects_workspace_old_slug_idx').on(table.workspaceId, table.oldSlug),
  index('wiki_redirects_page_id_idx').on(table.pageId),
])

const wikiLinksColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  [
    'sourcePageId',
    text('source_page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
  ],
  ['targetPageId', text('target_page_id').references(() => wikiPages.id, { onDelete: 'set null' })],
  ['targetTitle', text('target_title').notNull()],
  // PROJ-818: foldWikiTitle(target_title).
  ['targetFold', text('target_fold')],
  // PROJ-818: the target as written (title text or slug) — see migration 0063.
  ['targetText', text('target_text')],
  // PROJ-814/818: 'title' | 'slug' — how the link was written (NULL: legacy row).
  ['targetKind', text('target_kind')],
  ['createdAt', integer('created_at').notNull()],
])

/*
 * PROJ-485: server-side wiki link graph. Recomputed (delete-then-reinsert) on every
 * content write by services/wiki-links.ts#reindexWikiLinks. targetPageId is nullable —
 * null means the parsed [[Target]]/URL link didn't resolve to a page in this workspace
 * at write time (a broken link); targetTitle always holds the raw parsed text so it
 * survives later renames and stays available for broken-link reporting/re-resolution.
 */
export const wikiLinks = sqliteTable('wiki_links', wikiLinksColumns, (table) => [
  index('wiki_links_source_page_idx').on(table.sourcePageId),
  index('wiki_links_workspace_target_idx').on(table.workspaceId, table.targetPageId),
])

const wikiWatchersColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  [
    'userId',
    text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  ],
  [
    'pageId',
    text('page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
  ],
  ['subtree', integer('subtree', { mode: 'boolean' }).notNull().default(false)],
  ['createdAt', integer('created_at').notNull()],
])

/*
 * PROJ-493 (R11): a user watching either a single page (subtree=false) or a page and its
 * whole current+future subtree (subtree=true). "Is user watching page P" is resolved by
 * walking P's parent_id chain at notify time (services/wiki-watchers.ts), not by
 * materializing per-descendant rows — a page added later under a watched subtree is
 * covered automatically.
 */
export const wikiWatchers = sqliteTable('wiki_watchers', wikiWatchersColumns, (table) => [
  uniqueIndex('wiki_watchers_user_page_idx').on(table.workspaceId, table.userId, table.pageId),
  index('wiki_watchers_page_idx').on(table.workspaceId, table.pageId),
])

const wikiNotificationsColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  [
    'userId',
    text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  ],
  ['pageId', text('page_id').notNull()],
  ['pageSlug', text('page_slug').notNull()],
  ['pageTitle', text('page_title').notNull()],
  ['action', text('action', { enum: ['created', 'updated', 'deleted'] }).notNull()],
  ['actorId', text('actor_id').references(() => users.id, { onDelete: 'set null' })],
  ['summary', text('summary').notNull()],
  ['createdAt', integer('created_at').notNull()],
  ['readAt', integer('read_at')],
])

/*
 * PROJ-493 (R11): per-user notification list. `pageId` is NOT a foreign key (and has no
 * ON DELETE behavior) — a page that's since been hard-deleted must still leave its
 * deletion notification readable, so pageSlug/pageTitle are denormalized at write time
 * rather than joined from wiki_pages.
 */
export const wikiNotifications = sqliteTable('wiki_notifications', wikiNotificationsColumns, (table) => [
  index('wiki_notifications_user_idx').on(table.workspaceId, table.userId, table.createdAt),
])

const wikiDraftHeadsColumns = fieldsInOrder([
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  [
    'userId',
    text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  ],
  [
    'pageId',
    text('page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
  ],
  ['revision', text('revision').notNull()],
])

// Heads outlive scratch rows so CAS remains meaningful after discard/publication.
export const wikiDraftHeads = sqliteTable('wiki_draft_heads', wikiDraftHeadsColumns, (table) => [
  primaryKey({ columns: [table.workspaceId, table.userId, table.pageId] }),
])

const wikiDraftsColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  [
    'userId',
    text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  ],
  [
    'pageId',
    text('page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
  ],
  ['title', text('title').notNull()],
  ['content', text('content').notNull()],
  ['baseRevisionId', text('base_revision_id')],
  ['updatedAt', integer('updated_at').notNull()],
])

/*
 * PROJ-495 (R13): per-user scratch draft, one row per (page, user) — saveWikiDraft
 * upserts on the unique index below rather than accumulating draft history.
 * baseRevisionId is nullable (no FK to wiki_revisions — a revision can itself be
 * deleted independently) and carries the same "page had no revisions yet" convention
 * as wiki_pages/UpdatePageSchema's baseRevisionId, so publish can hand it straight to
 * updateWikiPage's existing optimistic-locking check.
 */
export const wikiDrafts = sqliteTable('wiki_drafts', wikiDraftsColumns, (table) => [
  uniqueIndex('wiki_drafts_user_page_idx').on(table.workspaceId, table.userId, table.pageId),
])
