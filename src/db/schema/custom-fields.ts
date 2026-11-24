import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { workspaces } from './core.ts'
import { issues, projects } from './issues.ts'

export const customFieldDefinitions = sqliteTable(
  'custom_field_definitions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type', { enum: ['text', 'number', 'select', 'date', 'user'] }).notNull(),
    options: text('options'),
    createdAt: integer('created_at').notNull(),
    isInternal: integer('is_internal', { mode: 'boolean' }).notNull().default(true),
  },
  (table) => [
    index('cfd_workspace_idx').on(table.workspaceId),
    index('cfd_ws_proj_key_idx').on(table.workspaceId, table.projectId, table.key),
  ],
)

export const customFieldValues = sqliteTable(
  'custom_field_values',
  {
    issueId: text('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    fieldId: text('field_id')
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
  },
  (table) => [primaryKey({ columns: [table.issueId, table.fieldId] }), index('cfv_field_idx').on(table.fieldId)],
)
