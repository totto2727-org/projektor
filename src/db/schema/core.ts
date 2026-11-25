import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'

export interface WorkspaceBrand {
  displayName?: string
  accent?: string
  onAccent?: string
  logoR2Key?: string
  fontFamily?: string
  fontUrl?: string
}

const workspacesColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  ['name', text('name').notNull()],
  ['slug', text('slug').notNull().unique()],
  ['createdAt', integer('created_at').notNull()],
  [
    'brand',
    text('brand', { mode: 'json' })
      .$type<WorkspaceBrand>()
      .notNull()
      .$defaultFn(() => ({})),
  ],
])

export const workspaces = sqliteTable('workspaces', workspacesColumns)

const usersColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  ['email', text('email').notNull().unique()],
  ['name', text('name').notNull()],
  ['avatarUrl', text('avatar_url')],
  ['createdAt', integer('created_at').notNull()],
])

export const users = sqliteTable('users', usersColumns)

const workspaceMembersColumns = fieldsInOrder([
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
    'role',
    text('role', { enum: ['owner', 'admin', 'member', 'viewer'] })
      .notNull()
      .default('member'),
  ],
  ['joinedAt', integer('joined_at').notNull()],
])

export const workspaceMembers = sqliteTable('workspace_members', workspaceMembersColumns, (table) => [
  primaryKey({ columns: [table.workspaceId, table.userId] }),
])

const provisioningRemovalsColumns = fieldsInOrder([
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
  ['removedAt', integer('removed_at').notNull()],
])

/*
 * PROJ-436: a durable record that an owner explicitly removed this user from this
 * workspace, so provisioning (ADMIN_EMAILS / AUTO_JOIN_ROLE / WORKSPACE_DOMAIN_MAP) skips
 * re-adding them here. Cleared by re-inviting the user to the same workspace.
 */
export const provisioningRemovals = sqliteTable('provisioning_removals', provisioningRemovalsColumns, (table) => [
  primaryKey({ columns: [table.workspaceId, table.userId] }),
])

const apiTokensColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  // NULL = user-scoped token (valid across all workspaces the user is a member of)
  ['workspaceId', text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' })],
  ['userId', text('user_id').references(() => users.id, { onDelete: 'set null' })],
  ['name', text('name').notNull()],
  ['tokenHash', text('token_hash').notNull().unique()],
  ['scopes', text('scopes', { mode: 'json' }).$type<string[]>().notNull()],
  ['lastUsedAt', integer('last_used_at')],
  ['expiresAt', integer('expires_at')],
  ['createdAt', integer('created_at').notNull()],
])

export const apiTokens = sqliteTable('api_tokens', apiTokensColumns)

const enabledPluginsColumns = fieldsInOrder([
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  ['pluginId', text('plugin_id').notNull()],
  [
    'config',
    text('config', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
  ],
  ['enabledAt', integer('enabled_at').notNull()],
])

export const enabledPlugins = sqliteTable('enabled_plugins', enabledPluginsColumns, (table) => [
  primaryKey({ columns: [table.workspaceId, table.pluginId] }),
])
