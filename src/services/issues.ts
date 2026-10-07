import { and, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'

import { drizzle, schema } from '#db'

import { batchLoadCustomFields, inChunks, type CustomFieldValue } from './custom-fields'
import { queryEffect } from './errors'

export const ISSUE_REF_PATTERN = /^([A-Z][A-Z0-9]*)-(\d{1,9})$/
export interface IssueListOptions {
  status?: typeof schema.issues.$inferSelect.status
  statusId?: string
  statusIds?: string
  category?: string
  priority?: typeof schema.issues.$inferSelect.priority
  priorities?: string
  projectId?: string
  assignee?: string
  parentId?: string
  noParent?: boolean
  typeId?: string
  excludeTypeIds?: string
  sprintId?: string
  completedAfter?: number
  completedBefore?: number
  updatedAfter?: number
  updatedBefore?: number
  needsAudit?: boolean
  includeRollups?: boolean
  includeBody?: boolean
  cursor?: { createdAt: number; id?: string }
  limit: number
  customField?: { id: string; op?: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'; value?: string }
}
export interface ChildRollup {
  total: number
  byStatus: Record<string, number>
  done: number
  remaining: number
}
export function computeChildRollup(rows: readonly { status: string; count: number }[]): ChildRollup {
  const byStatus: Record<string, number> = {}
  let total = 0
  for (const row of rows) {
    byStatus[row.status] = row.count
    total += row.count
  }
  const done = (byStatus.done ?? 0) + (byStatus.cancelled ?? 0)
  return { total, byStatus, done, remaining: total - done }
}
const issueColumns = {
  id: schema.issues.id,
  workspace_id: schema.issues.workspaceId,
  project_id: schema.issues.projectId,
  number: schema.issues.number,
  title: schema.issues.title,
  body: schema.issues.body,
  status: schema.issues.status,
  priority: schema.issues.priority,
  assignee_id: schema.issues.assigneeId,
  labels: sql<string>`${schema.issues.labels}`,
  parent_id: schema.issues.parentId,
  type_id: schema.issues.typeId,
  status_id: schema.issues.statusId,
  status_category: schema.taskStatuses.category,
  sprint_id: schema.issues.sprintId,
  created_by_id: schema.issues.createdById,
  author_kind: schema.issues.authorKind,
  created_at: schema.issues.createdAt,
  updated_at: schema.issues.updatedAt,
  completed_at: schema.issues.completedAt,
  needs_audit: schema.issues.needsAudit,
  project_key: schema.projects.key,
  project_name: schema.projects.name,
  type_key: schema.taskTypes.key,
  type_name: schema.taskTypes.name,
  status_key: schema.taskStatuses.key,
  status_name: schema.taskStatuses.name,
}
function issueSelect(db: D1Database) {
  return drizzle(db, { schema })
    .select(issueColumns)
    .from(schema.issues)
    .leftJoin(schema.projects, eq(schema.issues.projectId, schema.projects.id))
    .leftJoin(schema.taskTypes, eq(schema.issues.typeId, schema.taskTypes.id))
    .leftJoin(schema.taskStatuses, eq(schema.issues.statusId, schema.taskStatuses.id))
}
export type IssueRow = NonNullable<Awaited<ReturnType<ReturnType<typeof issueSelect>['get']>>>
export type IssueListRow = Omit<NonNullable<IssueRow>, 'body'> & {
  body?: string
  assignee_name: string | null
  customFields: CustomFieldValue[]
  rollup?: ChildRollup
}
export interface IssuePage {
  items: IssueListRow[]
  nextCursor: string | null
  total: number | null
}

/** Reference syntax is validated by the application before calling. No authorization occurs here. */
export function getIssue(db: D1Database, workspaceId: string, options: { id?: string; ref?: string }) {
  return queryEffect('getIssue', async () => {
    const match = options.ref?.match(ISSUE_REF_PATTERN)
    if (!options.id && !match) return null
    const predicate = options.id
      ? eq(schema.issues.id, options.id)
      : and(eq(schema.projects.key, match![1]), eq(schema.issues.number, Number(match![2])))
    return (
      (await issueSelect(db)
        .where(and(eq(schema.issues.workspaceId, workspaceId), predicate))
        .get()) ?? null
    )
  })
}
export function findIssueIdByRef(db: D1Database, workspaceId: string, ref: string) {
  return queryEffect('findIssueIdByRef', async () => {
    const match = ref.match(ISSUE_REF_PATTERN)
    if (!match) return null
    const row = await drizzle(db, { schema })
      .select({ id: schema.issues.id })
      .from(schema.issues)
      .innerJoin(schema.projects, eq(schema.issues.projectId, schema.projects.id))
      .where(
        and(
          eq(schema.issues.workspaceId, workspaceId),
          eq(schema.projects.key, match[1]),
          eq(schema.issues.number, Number(match[2])),
        ),
      )
      .get()
    return row?.id ?? null
  })
}
export function findIssueCustomField(db: D1Database, workspaceId: string, key: string) {
  return queryEffect(
    'findIssueCustomField',
    async () =>
      (await drizzle(db, { schema })
        .select({ id: schema.customFieldDefinitions.id, type: schema.customFieldDefinitions.type })
        .from(schema.customFieldDefinitions)
        .where(
          and(eq(schema.customFieldDefinitions.workspaceId, workspaceId), eq(schema.customFieldDefinitions.key, key)),
        )
        .get()) ?? null,
  )
}
function listConditions(workspaceId: string, options: IssueListOptions, visibility?: SQL): SQL[] {
  const conditions: SQL[] = [eq(schema.issues.workspaceId, workspaceId)]
  if (visibility) conditions.push(visibility)
  if (options.status) conditions.push(eq(schema.issues.status, options.status))
  if (options.statusId) conditions.push(eq(schema.issues.statusId, options.statusId))
  const statusIds = options.statusIds
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // Membership filters bind one JSON value instead of an input-scaled array, keeping
  // the complete filtered count and cursor page under D1's 100-parameter cap.
  if (statusIds?.length)
    conditions.push(sql`${schema.issues.statusId} IN (SELECT value FROM json_each(${JSON.stringify(statusIds)}))`)
  if (options.category) conditions.push(eq(schema.issues.statusCategory, options.category))
  if (options.needsAudit !== undefined) conditions.push(eq(schema.issues.needsAudit, options.needsAudit))
  if (options.priority) conditions.push(eq(schema.issues.priority, options.priority))
  const priorities = options.priorities
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) as NonNullable<IssueListOptions['priority']>[] | undefined
  if (priorities?.length)
    conditions.push(sql`${schema.issues.priority} IN (SELECT value FROM json_each(${JSON.stringify(priorities)}))`)
  if (options.projectId) conditions.push(eq(schema.issues.projectId, options.projectId))
  if (options.assignee) conditions.push(eq(schema.issues.assigneeId, options.assignee))
  if (options.parentId) conditions.push(eq(schema.issues.parentId, options.parentId))
  if (options.noParent) conditions.push(isNull(schema.issues.parentId))
  if (options.typeId) conditions.push(eq(schema.issues.typeId, options.typeId))
  const excluded = options.excludeTypeIds
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (excluded?.length)
    conditions.push(
      or(
        isNull(schema.issues.typeId),
        sql`${schema.issues.typeId} NOT IN (SELECT value FROM json_each(${JSON.stringify(excluded)}))`,
      )!,
    )
  if (options.sprintId) conditions.push(eq(schema.issues.sprintId, options.sprintId))
  if (options.completedAfter) conditions.push(gte(schema.issues.completedAt, options.completedAfter))
  if (options.completedBefore) conditions.push(lte(schema.issues.completedAt, options.completedBefore))
  if (options.updatedAfter) conditions.push(gte(schema.issues.updatedAt, options.updatedAfter))
  if (options.updatedBefore) conditions.push(lte(schema.issues.updatedAt, options.updatedBefore))
  const field = options.customField
  if (field) {
    const op = field.op ?? 'eq'
    conditions.push(
      op === 'eq'
        ? sql`EXISTS (SELECT 1 FROM custom_field_values WHERE issue_id = ${schema.issues.id} AND field_id = ${field.id} AND value = ${field.value ?? ''})`
        : sql`EXISTS (SELECT 1 FROM custom_field_values WHERE issue_id = ${schema.issues.id} AND field_id = ${field.id} AND CAST(value AS REAL) ${sql.raw({ gt: '>', gte: '>=', lt: '<', lte: '<=' }[op])} ${parseFloat(field.value ?? '0')})`,
    )
  }
  return conditions
}
export function getChildRollups(db: D1Database, workspaceId: string, parentIds: readonly string[]) {
  return queryEffect('getChildRollups', async () => {
    const orm = drizzle(db, { schema })
    const rows = await inChunks(parentIds, (chunk) =>
      orm
        .select({
          parent_id: schema.issues.parentId,
          status: schema.issues.status,
          count: sql<number>`count(*)`,
        })
        .from(schema.issues)
        .where(and(eq(schema.issues.workspaceId, workspaceId), inArray(schema.issues.parentId, chunk)))
        .groupBy(schema.issues.parentId, schema.issues.status),
    )
    const grouped: Record<string, { status: string; count: number }[]> = {}
    for (const row of rows) if (row.parent_id) (grouped[row.parent_id] ??= []).push(row)
    return Object.fromEntries(parentIds.map((id) => [id, computeChildRollup(grouped[id] ?? [])]))
  })
}
export function getIssueExtras(db: D1Database, workspaceId: string, issueId: string) {
  return Effect.gen(function* () {
    const rollups = yield* getChildRollups(db, workspaceId, [issueId])
    const fields = yield* batchLoadCustomFields(db, workspaceId, [issueId])
    return {
      rollup: rollups[issueId] ?? computeChildRollup([]),
      customFields: fields[issueId] ?? [],
    }
  })
}
export function listIssues(db: D1Database, workspaceId: string, options: IssueListOptions, visibility?: SQL) {
  return Effect.gen(function* () {
    const page = yield* queryEffect('listIssues', async () => {
      const orm = drizzle(db, { schema })
      const conditions = listConditions(workspaceId, options, visibility)
      const cursor = options.cursor
      const pageConditions = !cursor
        ? conditions
        : [
            ...conditions,
            cursor.id === undefined
              ? sql`${schema.issues.createdAt} < ${cursor.createdAt}`
              : sql`(${schema.issues.createdAt} < ${cursor.createdAt} OR (${schema.issues.createdAt} = ${cursor.createdAt} AND ${schema.issues.id} < ${cursor.id}))`,
          ]
      const total = cursor ? null : await orm.$count(schema.issues, and(...conditions))
      const rows = await orm
        .select({ ...issueColumns, assignee_name: schema.users.name })
        .from(schema.issues)
        .leftJoin(schema.users, eq(schema.issues.assigneeId, schema.users.id))
        .leftJoin(schema.projects, eq(schema.issues.projectId, schema.projects.id))
        .leftJoin(schema.taskTypes, eq(schema.issues.typeId, schema.taskTypes.id))
        .leftJoin(schema.taskStatuses, eq(schema.issues.statusId, schema.taskStatuses.id))
        .where(and(...pageConditions))
        .orderBy(desc(schema.issues.createdAt), desc(schema.issues.id))
        .limit(options.limit + 1)
      const hasMore = rows.length > options.limit
      const items = hasMore ? rows.slice(0, options.limit) : rows
      const last = items.at(-1)
      return { items, total, nextCursor: hasMore && last ? `${last.created_at}:${last.id}` : null }
    })
    const ids = page.items.map((r) => r.id)
    const fields = yield* batchLoadCustomFields(db, workspaceId, ids)
    const rollups = options.includeRollups ? yield* getChildRollups(db, workspaceId, ids) : null
    const items: IssueListRow[] = page.items.map(({ body, ...row }) => ({
      ...row,
      ...(options.includeBody ? { body } : {}),
      customFields: fields[row.id] ?? [],
      ...(rollups ? { rollup: rollups[row.id] ?? computeChildRollup([]) } : {}),
    }))
    return { items, total: page.total, nextCursor: page.nextCursor } satisfies IssuePage
  })
}
export interface IssueBatchOptions {
  refs?: readonly string[]
  ids?: readonly string[]
  includeBody?: boolean
}
export function getIssuesBatch(db: D1Database, workspaceId: string, options: IssueBatchOptions, visibility?: SQL) {
  return Effect.gen(function* () {
    const selection = yield* queryEffect('getIssuesBatch', async () => {
      const refs = options.refs ?? []
      const orm = drizzle(db, { schema })
      const numbersByKey = new Map<string, number[]>()
      for (const ref of refs) {
        const match = ref.match(ISSUE_REF_PATTERN)!
        const numbers = numbersByKey.get(match[1]) ?? []
        numbers.push(Number(match[2]))
        numbersByKey.set(match[1], numbers)
      }
      const refToId = new Map<string, string>()
      for (const [key, numbers] of numbersByKey) {
        const rows = await inChunks(numbers, (chunk) =>
          orm
            .select({ id: schema.issues.id, number: schema.issues.number })
            .from(schema.issues)
            .innerJoin(schema.projects, eq(schema.issues.projectId, schema.projects.id))
            .where(
              and(
                eq(schema.projects.key, key),
                eq(schema.issues.workspaceId, workspaceId),
                inArray(schema.issues.number, chunk),
              ),
            ),
        )
        for (const row of rows) refToId.set(`${key}-${row.number}`, row.id)
      }
      const order = refs.map((ref) => {
        const m = ref.match(ISSUE_REF_PATTERN)!
        return { requested: ref, id: refToId.get(`${m[1]}-${Number(m[2])}`) }
      })
      for (const id of options.ids ?? []) order.push({ requested: id, id })
      const ids = [...new Set(order.map((o) => o.id).filter((id): id is string => !!id))]
      const rows = await inChunks(ids, (chunk) =>
        issueSelect(db).where(
          and(eq(schema.issues.workspaceId, workspaceId), inArray(schema.issues.id, chunk), visibility),
        ),
      )
      return { order, rows }
    })
    const fields = yield* batchLoadCustomFields(
      db,
      workspaceId,
      selection.rows.map((r) => r.id),
    )
    const rowsById = new Map(
      selection.rows.map(({ body, ...row }) => [
        row.id,
        { ...row, ...(options.includeBody ? { body } : {}), customFields: fields[row.id] ?? [] },
      ]),
    )
    const items: (Omit<NonNullable<IssueRow>, 'body'> & {
      body?: string
      customFields: CustomFieldValue[]
    })[] = []
    const missing: string[] = []
    const seen = new Set<string>()
    for (const entry of selection.order) {
      const row = entry.id ? rowsById.get(entry.id) : undefined
      if (!row) {
        if (!missing.includes(entry.requested)) missing.push(entry.requested)
        continue
      }
      if (seen.has(row.id)) continue
      seen.add(row.id)
      items.push(row)
    }
    return { items, missing }
  })
}

export interface IssueSearchOptions {
  query: string
  limit: number
  projectId?: string
}
export interface IssueSearchRow {
  id: string
  number: number
  title: string
  status: string
  priority: string
  project_id: string | null
  project_key: string | null
  project_name: string | null
}
export interface IssueSearchVisibility {
  sql: string
  params: unknown[]
}
export function searchIssues(
  db: D1Database,
  workspaceId: string,
  options: IssueSearchOptions,
  visibility?: IssueSearchVisibility,
) {
  return queryEffect('searchIssues', async (): Promise<IssueSearchRow[]> => {
    const query = options.query
      .trim()
      .split(/\s+/)
      .filter((t) => Boolean(t) && /\w/.test(t))
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(' ')
    if (!query) return []
    let statement = `SELECT i.id, i.number, i.title, i.status, i.priority, p.id as project_id, p.key as project_key, p.name as project_name FROM issues_fts JOIN issues i ON i.id = issues_fts.issue_id LEFT JOIN projects p ON p.id = i.project_id WHERE issues_fts MATCH ? AND issues_fts.workspace_id = ?`
    const params: unknown[] = [query, workspaceId]
    if (options.projectId) {
      statement += ' AND i.project_id = ?'
      params.push(options.projectId)
    }
    if (visibility) {
      statement += ` AND ${visibility.sql}`
      params.push(...visibility.params)
    }
    statement += ' ORDER BY bm25(issues_fts) LIMIT ?'
    params.push(options.limit)
    return (
      await db
        .prepare(statement)
        .bind(...params)
        .all<IssueSearchRow>()
    ).results
  })
}
