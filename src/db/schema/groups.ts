import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { users, workspaces } from './core.ts'
import { projects } from './issues.ts'

// PROJ-311: admin-managed groups that carry per-project access grants.
export const userGroups = sqliteTable(
  'user_groups',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [uniqueIndex('user_groups_workspace_name_idx').on(table.workspaceId, table.name)],
)

export const userGroupMembers = sqliteTable(
  'user_group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => userGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedBy: text('added_by')
      .notNull()
      .references(() => users.id),
    addedAt: integer('added_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index('user_group_members_user_idx').on(table.userId),
  ],
)

export const groupProjectGrants = sqliteTable(
  'group_project_grants',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => userGroups.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['viewer', 'member', 'admin'] }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.projectId] }),
    index('group_project_grants_project_idx').on(table.projectId),
  ],
)
