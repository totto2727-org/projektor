import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { users, workspaces } from './core.ts'
import { projects } from './projects.ts'

const INITIAL_WIKI_PAGE_VERSION = 0

const wikiPagesColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  ['projectId', text('project_id').references(() => projects.id, { onDelete: 'cascade' })],
  ['slug', text('slug').notNull()],
  ['title', text('title').notNull()],
  // PROJ-818: foldWikiTitle(title), computed in JS (SQLite lower() is ASCII-only).
  ['titleFold', text('title_fold')],
  // PROJ-816: this page's wiki_fts rowid (migration 0065).
  ['searchRowid', integer('search_rowid')],
  ['content', text('content').notNull().default('')],
  ['parentId', text('parent_id')],
  [
    'createdById',
    text('created_by_id')
      .notNull()
      .references(() => users.id),
  ],
  [
    'updatedById',
    text('updated_by_id')
      .notNull()
      .references(() => users.id),
  ],
  ['createdAt', integer('created_at').notNull()],
  ['updatedAt', integer('updated_at').notNull()],
  /*
   * PROJ-919: bumped by every write to the row; the wiki write guard compares it so a
   * concurrent title/slug/parent-only write can't be silently overwritten.
   */
  ['version', integer('version').notNull().default(INITIAL_WIKI_PAGE_VERSION)],
  /*
   * PROJ-488 (R6): denormalized from optional YAML frontmatter parsed on write
   * (services/wiki-frontmatter.ts). `type`/`status` are freeform TEXT — the
   * well-known enum values are enforced at the Zod layer, not a DB CHECK
   * constraint, so this column never blocks a write the schema layer would allow.
   */
  ['type', text('type')],
  [
    'tags',
    text('tags', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
  ],
  ['status', text('status')],
  ['verifiedAt', integer('verified_at')],
  ['verifiedBy', text('verified_by')],
  [
    'owners',
    text('owners', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
  ],
  ['verifyInterval', integer('verify_interval')],
  /*
   * PROJ-491 (R9): denormalized from frontmatter `template: true` (services/
   * wiki-frontmatter.ts). Marks a page as a reusable template (conventionally
   * living under a workspace "Templates" page) rather than regular content.
   */
  ['isTemplate', integer('is_template', { mode: 'boolean' }).notNull().default(false)],
  /*
   * PROJ-496 (R14): unix seconds this page was soft-deleted, or NULL if live.
   * Everything a hard delete used to clean up immediately (R2 objects, wiki_links,
   * wiki_watchers, wiki_drafts, wiki_fts) now waits until purgeExpiredWikiPages
   * actually removes the row, 30+ days later (services/wiki.ts).
   */
  ['deletedAt', integer('deleted_at')],
  /*
   * PROJ-496 follow-up: identifies which deleteWikiPage call trashed this page —
   * every page in one cascade-trash batch shares the same value, a lone non-cascade
   * trash gets its own unique value. Disambiguates cascade-restore batch membership
   * without relying on deletedAt timestamp equality, which collides when two
   * independent trashes land in the same wall-clock second.
   */
  ['trashBatchId', text('trash_batch_id')],
])

export const wikiPages = sqliteTable('wiki_pages', wikiPagesColumns, (table) => [
  index('wiki_pages_workspace_slug_idx').on(table.workspaceId, table.slug),
  /*
   * PROJ-483: enforces slug uniqueness per workspace (0041_wiki_slug_unique.sql).
   * PROJ-496: PARTIAL — only among live pages — so trashing a page immediately frees
   * its slug for reuse rather than reserving it for the whole 30-day retention window.
   */
  uniqueIndex('wiki_pages_workspace_slug_unique_idx')
    .on(table.workspaceId, table.slug)
    .where(sql`${table.deletedAt} IS NULL`),
  index('wiki_pages_parent_idx').on(table.parentId),
  index('wiki_pages_project_id_idx').on(table.projectId),
  // PROJ-488: type/status filtering (listWikiPages/searchWiki).
  index('wiki_pages_workspace_type_idx').on(table.workspaceId, table.type),
  index('wiki_pages_workspace_status_idx').on(table.workspaceId, table.status),
  // PROJ-491: template picker / search+staleness exclusion filter on this flag.
  index('wiki_pages_workspace_template_idx').on(table.workspaceId, table.isTemplate),
  // PROJ-496: trash listing / purge job scan (services/wiki.ts#listWikiTrash,
  // #purgeExpiredWikiPages).
  index('wiki_pages_workspace_deleted_at_idx').on(table.workspaceId, table.deletedAt),
  // PROJ-496 follow-up: collectCascadeTrashedDescendantIds walks this per batch id.
  index('wiki_pages_trash_batch_id_idx').on(table.workspaceId, table.trashBatchId),
])
