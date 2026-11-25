import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { users, workspaces } from './core.ts'
import { projects } from './projects.ts'

export { projects } from './projects.ts'

const taskTypesColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  ['key', text('key').notNull()],
  ['name', text('name').notNull()],
  ['color', text('color')],
  ['icon', text('icon')],
  ['position', integer('position').notNull().default(0)],
  ['isDefault', integer('is_default').notNull().default(0)],
])

export const taskTypes = sqliteTable('task_types', taskTypesColumns, (table) => [
  uniqueIndex('task_types_workspace_key_idx').on(table.workspaceId, table.key),
  index('task_types_workspace_idx').on(table.workspaceId),
])

const taskStatusesColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  ['key', text('key').notNull()],
  ['name', text('name').notNull()],
  ['category', text('category', { enum: ['todo', 'in_progress', 'done', 'cancelled'] }).notNull()],
  ['color', text('color')],
  ['position', integer('position').notNull().default(0)],
  ['isDefault', integer('is_default').notNull().default(0)],
  // PROJ-749: explicit review-step flag (review gate + review flow metrics).
  ['isReviewStep', integer('is_review_step').notNull().default(0)],
])

export const taskStatuses = sqliteTable('task_statuses', taskStatusesColumns, (table) => [
  uniqueIndex('task_statuses_workspace_key_idx').on(table.workspaceId, table.key),
  index('task_statuses_workspace_idx').on(table.workspaceId),
])

const issuesColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  [
    'projectId',
    text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
  ],
  ['number', integer('number').notNull()],
  ['title', text('title').notNull()],
  ['body', text('body').notNull().default('')],
  [
    'status',
    text('status', {
      enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'],
    })
      .notNull()
      .default('backlog'),
  ],
  [
    'priority',
    text('priority', { enum: ['urgent', 'high', 'medium', 'low', 'none'] })
      .notNull()
      .default('none'),
  ],
  ['assigneeId', text('assignee_id').references(() => users.id, { onDelete: 'set null' })],
  [
    'labels',
    text('labels', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
  ],
  ['parentId', text('parent_id')],
  ['typeId', text('type_id').references(() => taskTypes.id, { onDelete: 'set null' })],
  ['statusId', text('status_id').references(() => taskStatuses.id, { onDelete: 'set null' })],
  ['statusCategory', text('status_category').notNull().default('')],
  ['sprintId', text('sprint_id')],
  [
    'createdById',
    text('created_by_id')
      .notNull()
      .references(() => users.id),
  ],
  /*
   * PROJ-396: the authenticated principal type at write time ("human" = Cloudflare
   * Access JWT, "agent" = Bearer API token — see middleware/auth.ts), same convention
   * as issueComments.authorKind (PROJ-328). NULL for issues created before this column
   * existed — no reliable signal to backfill, so they're excluded rather than guessed.
   */
  ['authorKind', text('author_kind', { enum: ['human', 'agent'] })],
  ['createdAt', integer('created_at').notNull()],
  ['updatedAt', integer('updated_at').notNull()],
  /*
   * Stamped when the issue enters a done-category status, cleared when it
   * leaves (PROJ-212). Indexed for completed-date range filtering.
   */
  ['completedAt', integer('completed_at')],
  /*
   * Flow metrics (PROJ-252): stamped once, the first time the issue enters the
   * corresponding state; never cleared (reopening is rework, not un-history).
   */
  ['readyAt', integer('ready_at')],
  ['claimedAt', integer('claimed_at')],
  ['doneAt', integer('done_at')],
  // Review gating (PROJ-254): stamped when a completion report is submitted.
  ['completionReportAt', integer('completion_report_at')],
  /*
   * Collaboration-shape metrics (PROJ-328): write-once, same rules as ready_at/
   * claimed_at/done_at above. reviewBounceCount counts status bounces OUT of
   * review back to in-progress (never cleared, never re-derived from history).
   */
  ['inReviewAt', integer('in_review_at')],
  ['reviewBounceCount', integer('review_bounce_count').notNull().default(0)],
  /*
   * PROJ-375: agents can close issues to done directly (no gate blocks it); this
   * flags agent-initiated closures whose completion-report verification wasn't
   * externally checkable (no CI run/PR/commit link) for after-the-fact human review.
   */
  ['needsAudit', integer('needs_audit', { mode: 'boolean' }).notNull().default(false)],
  /*
   * PROJ-859: stored definition-of-ready result (1/0, JSON array of missing
   * criteria). NULL until first computed — see migration 0058.
   */
  ['dorReady', integer('dor_ready')],
  ['dorMissing', text('dor_missing')],
])

export const issues = sqliteTable('issues', issuesColumns, (table) => [
  index('issues_project_idx').on(table.projectId),
  index('issues_status_idx').on(table.status),
  index('issues_status_id_idx').on(table.statusId),
  index('issues_parent_idx').on(table.parentId),
  index('issues_assignee_idx').on(table.assigneeId),
  index('issues_workspace_status_idx').on(table.workspaceId, table.status),
  index('issues_workspace_category_created_idx').on(table.workspaceId, table.statusCategory, table.createdAt),
  index('idx_issues_workspace_completed').on(table.workspaceId, table.completedAt),
  index('idx_issues_workspace_ready_at').on(table.workspaceId, table.readyAt),
  index('idx_issues_workspace_claimed_at').on(table.workspaceId, table.claimedAt),
  index('idx_issues_workspace_done_at').on(table.workspaceId, table.doneAt),
  index('idx_issues_workspace_in_review_at').on(table.workspaceId, table.inReviewAt),
  index('idx_issues_workspace_needs_audit').on(table.workspaceId, table.needsAudit),
])

const issueCommentsColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'issueId',
    text('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
  ],
  [
    'authorId',
    text('author_id')
      .notNull()
      .references(() => users.id),
  ],
  ['body', text('body').notNull()],
  ['createdAt', integer('created_at').notNull()],
  ['updatedAt', integer('updated_at').notNull()],
  /*
   * Collaboration-shape metrics (PROJ-328): the authenticated principal type at
   * write time ("human" = Cloudflare Access JWT, "agent" = Bearer API token — see
   * middleware/auth.ts). NULL for comments written before this column existed.
   */
  ['authorKind', text('author_kind', { enum: ['human', 'agent'] })],
])

export const issueComments = sqliteTable('issue_comments', issueCommentsColumns, (table) => [
  index('issue_comments_issue_idx').on(table.issueId),
])

const issueLinksColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  [
    'sourceIssueId',
    text('source_issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
  ],
  [
    'targetIssueId',
    text('target_issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
  ],
  ['type', text('type', { enum: ['blocks', 'relates_to', 'duplicates'] }).notNull()],
  [
    'createdById',
    text('created_by_id')
      .notNull()
      .references(() => users.id),
  ],
  ['createdAt', integer('created_at').notNull()],
])

export const issueLinks = sqliteTable('issue_links', issueLinksColumns, (table) => [
  index('issue_links_source_idx').on(table.sourceIssueId),
  index('issue_links_target_idx').on(table.targetIssueId),
])

const activityColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  ['entityType', text('entity_type', { enum: ['issue', 'wiki_page', 'project', 'group'] }).notNull()],
  ['entityId', text('entity_id').notNull()],
  ['actorId', text('actor_id').references(() => users.id, { onDelete: 'set null' })],
  ['action', text('action').notNull()],
  ['diff', text('diff', { mode: 'json' }).$type<Record<string, unknown>>()],
  ['createdAt', integer('created_at').notNull()],
])

export const activity = sqliteTable('activity', activityColumns, (table) => [
  index('activity_workspace_idx').on(table.workspaceId),
  index('activity_entity_idx').on(table.entityType, table.entityId),
  /*
   * PROJ-493 (R11): list_wiki_changes filters entity_type='wiki_page' AND
   * created_at >= since within a workspace — an indexed range scan instead of a
   * full scan of the workspace's activity rows.
   */
  index('activity_workspace_entity_created_idx').on(table.workspaceId, table.entityType, table.createdAt),
])

const issueGateRejectionsColumns = fieldsInOrder([
  ['id', text('id').primaryKey()],
  [
    'workspaceId',
    text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  ],
  [
    'issueId',
    text('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
  ],
  ['occurredAt', integer('occurred_at').notNull()],
])

/*
 * PROJ-334: gate rejections — an event log of in_review -> in_progress bounces
 * specifically (narrower than the aggregate issues.review_bounce_count, which also
 * counts review -> cancelled). A timestamped event, unlike the aggregate counter, so
 * the factory-health tile can count rejections within an arbitrary date window.
 */
export const issueGateRejections = sqliteTable('issue_gate_rejections', issueGateRejectionsColumns, (table) => [
  index('idx_issue_gate_rejections_workspace_occurred').on(table.workspaceId, table.occurredAt),
])
