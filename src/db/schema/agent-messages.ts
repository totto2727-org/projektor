import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { agentSessions } from './agents.ts'
import { workspaces } from './core.ts'

const agentMessagesColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  ['scope', text('scope').notNull()],
  ['agentId', text('agent_id').references(() => agentSessions.id, { onDelete: 'set null' })],
  ['body', text('body').notNull()],
  ['createdAt', integer('created_at').notNull()],
])

export const agentMessages = sqliteTable('agent_messages', agentMessagesColumns, (table) => [
  index('idx_agent_messages_scope').on(table.workspaceId, table.scope, table.createdAt),
])
