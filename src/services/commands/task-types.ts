import { and, eq } from 'drizzle-orm'
import { Predicate, Effect } from 'effect'
import { z } from 'zod'

import { IdSchema } from '#contracts/inputs/common.ts'
import { CreateTaskTypeSchema, UpdateTaskTypeSchema } from '#contracts/inputs/task-types.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { SQLITE_FALSE, SQLITE_TRUE, drizzle, schema } from '#db'
import { SQL_NULL } from '#db/sql-null.ts'
import { listTaskTypes as queryTypes } from '#services/task-types.ts'

import * as cache from './cache.ts'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, validationIssues } from './errors.ts'
import { prepareQuery } from './sql.ts'
import type { ServiceCtx } from './types.ts'

const INITIAL_TASK_POSITION = 0

const WS_META_TTL = 60
const WS_META_LOCAL_TTL_MS = 5000
const TASK_TYPES_CACHE_KEY = (workspaceId: string): string => `ws-meta:${workspaceId}:task-types`
const localCache = cache.createLocalCache<unknown[]>(WS_META_LOCAL_TTL_MS)

const invalidateTaskTypesCache = async function invalidateTaskTypesCache(ctx: ServiceCtx): Promise<void> {
  const cacheKey = TASK_TYPES_CACHE_KEY(ctx.workspaceId)
  await cache.invalidate(ctx.kv, cacheKey)
  localCache.invalidate(cacheKey)
}

const buildTaskTypeUpdateSet = function buildTaskTypeUpdateSet(
  data: z.infer<typeof UpdateTaskTypeSchema>,
): Record<string, unknown> {
  const setObj: Record<string, unknown> = {}
  if (Predicate.isNotNullish(data.name)) {
    setObj.name = data.name
  }
  if ('color' in data) {
    setObj.color = data.color ?? SQL_NULL
  }
  if ('icon' in data) {
    setObj.icon = data.icon ?? SQL_NULL
  }
  if (Predicate.isNotNullish(data.position)) {
    setObj.position = data.position
  }
  if (Predicate.isNotNullish(data.isDefault)) {
    setObj.isDefault = data.isDefault ? SQLITE_TRUE : SQLITE_FALSE
  }
  return setObj
}

export const listTaskTypes = async function listTaskTypes(ctx: ServiceCtx): Promise<unknown[]> {
  const cacheKey = TASK_TYPES_CACHE_KEY(ctx.workspaceId)
  const local = localCache.get(cacheKey)
  if (local) {
    return local
  }

  const cached = await cache.get<unknown[]>(ctx.kv, cacheKey)
  if (cached) {
    localCache.set(cacheKey, cached)
    return cached
  }

  const result = await Effect.runPromise(queryTypes(ctx.db, ctx.workspaceId))
  await cache.set(ctx.kv, cacheKey, result, WS_META_TTL)
  localCache.set(cacheKey, result)
  return result
}

export const createTaskType = async function createTaskType(ctx: ServiceCtx, raw: unknown) {
  if (ctx.role === 'member' || ctx.role === 'viewer') {
    throw new ForbiddenError()
  }
  const result = CreateTaskTypeSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(z.flattenError(result.error))
  }
  const { key, name, color, icon, position, isDefault } = result.data

  const orm = drizzle(ctx.db, { schema })
  const existing = await orm
    .select({ id: schema.taskTypes.id })
    .from(schema.taskTypes)
    .where(and(eq(schema.taskTypes.workspaceId, ctx.workspaceId), eq(schema.taskTypes.key, key)))
    .get()
  if (existing) {
    throw new ConflictError(`Task type key '${key}' already exists`)
  }

  if (isDefault === true) {
    await orm.update(schema.taskTypes).set({ isDefault: 0 }).where(eq(schema.taskTypes.workspaceId, ctx.workspaceId))
  }

  const id = crypto.randomUUID()
  await orm.insert(schema.taskTypes).values(
    fieldsInOrder([
      ['id', id],
      ['workspaceId', ctx.workspaceId],
      ['key', key],
      ['name', name],
      ['color', color ?? SQL_NULL],
      ['icon', icon ?? SQL_NULL],
      ['position', position ?? INITIAL_TASK_POSITION],
      ['isDefault', isDefault === true ? SQLITE_TRUE : SQLITE_FALSE],
    ]),
  )

  await invalidateTaskTypesCache(ctx)
  return { id, key, name }
}

export const updateTaskType = async function updateTaskType(
  ctx: ServiceCtx,
  id: string,
  raw: unknown,
): Promise<{ ok: boolean }> {
  if (ctx.role === 'member' || ctx.role === 'viewer') {
    throw new ForbiddenError()
  }
  const result = UpdateTaskTypeSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(z.flattenError(result.error))
  }
  const { data } = result
  const setObj = buildTaskTypeUpdateSet(data)

  const orm = drizzle(ctx.db, { schema })

  const existing = await orm
    .select({ id: schema.taskTypes.id })
    .from(schema.taskTypes)
    .where(and(eq(schema.taskTypes.id, id), eq(schema.taskTypes.workspaceId, ctx.workspaceId)))
    .get()
  if (!existing) {
    throw new NotFoundError('Task type not found')
  }

  const update = orm
    .update(schema.taskTypes)
    .set(setObj)
    .where(and(eq(schema.taskTypes.id, id), eq(schema.taskTypes.workspaceId, ctx.workspaceId)))
  if (data.isDefault === true) {
    await orm.batch([
      orm.update(schema.taskTypes).set({ isDefault: 0 }).where(eq(schema.taskTypes.workspaceId, ctx.workspaceId)),
      update,
    ])
  } else {
    await update
  }

  await invalidateTaskTypesCache(ctx)
  return { ok: true }
}

export const deleteTaskType = async function deleteTaskType(ctx: ServiceCtx, id: string): Promise<{ ok: boolean }> {
  const idCheck = IdSchema.safeParse(id)
  if (!idCheck.success) {
    throw new ValidationError(validationIssues(z.flattenError(idCheck.error).formErrors, {}))
  }
  if (ctx.role === 'member' || ctx.role === 'viewer') {
    throw new ForbiddenError()
  }

  const orm = drizzle(ctx.db, { schema })
  const inUse = await orm
    .select({ id: schema.issues.id })
    .from(schema.issues)
    .where(and(eq(schema.issues.typeId, id), eq(schema.issues.workspaceId, ctx.workspaceId)))
    .get()
  if (inUse) {
    throw new ConflictError('Task type is in use by one or more issues')
  }

  const existing = await orm
    .select({ id: schema.taskTypes.id })
    .from(schema.taskTypes)
    .where(and(eq(schema.taskTypes.id, id), eq(schema.taskTypes.workspaceId, ctx.workspaceId)))
    .get()
  if (!existing) {
    throw new NotFoundError('Task type not found')
  }

  await orm
    .delete(schema.taskTypes)
    .where(and(eq(schema.taskTypes.id, id), eq(schema.taskTypes.workspaceId, ctx.workspaceId)))

  await invalidateTaskTypesCache(ctx)
  return { ok: true }
}

export const buildDefaultTaskTypeStatements = function buildDefaultTaskTypeStatements(
  db: D1Database,
  workspaceId: string,
): D1PreparedStatement[] {
  const defaults = [
    { key: 'epic', name: 'Epic', position: 1, isDefault: 0 },
    { key: 'story', name: 'Story', position: 2, isDefault: 0 },
    { key: 'task', name: 'Task', position: 3, isDefault: 1 },
    { key: 'bug', name: 'Bug', position: 4, isDefault: 0 },
  ]
  const orm = drizzle(db, { schema })
  return defaults.map((taskType) =>
    prepareQuery(
      db,
      orm
        .insert(schema.taskTypes)
        .values({
          id: crypto.randomUUID(),
          workspaceId,
          key: taskType.key,
          name: taskType.name,
          color: SQL_NULL,
          icon: SQL_NULL,
          position: taskType.position,
          isDefault: taskType.isDefault,
        })
        .onConflictDoNothing()
        .toSQL(),
    ),
  )
}

export const seedDefaultTaskTypes = async function seedDefaultTaskTypes(
  db: D1Database,
  workspaceId: string,
): Promise<void> {
  await db.batch(buildDefaultTaskTypeStatements(db, workspaceId))
}
