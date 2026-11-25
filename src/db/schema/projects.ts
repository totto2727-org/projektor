import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { workspaces } from './core.ts'

const projectsColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  ['name', text('name').notNull()],
  ['key', text('key').notNull()],
  ['description', text('description')],
  ['createdAt', integer('created_at').notNull()],
  ['updatedAt', integer('updated_at').notNull()],
  // Per-project agent WIP cap (PROJ-253). NULL = use the workspace default.
  ['agentWipLimit', integer('agent_wip_limit')],
  /*
   * Human-readable URL slug, e.g. "start-line" (PROJ-376). Nullable for
   * pre-migration rows that failed backfill; unique per workspace, enforced
   * by a partial index (see migrations/0035_project_slug.sql) so NULLs don't
   * collide.
   */
  ['slug', text('slug')],
  ['archivedAt', integer('archived_at')],
])

export const projects = sqliteTable('projects', projectsColumns, (table) => [
  index('projects_workspace_idx').on(table.workspaceId),
  index('projects_workspace_slug_idx').on(table.workspaceId, table.slug),
])
