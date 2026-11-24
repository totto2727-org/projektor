import { and, eq, isNull, sql } from 'drizzle-orm'
import { Array as EffectArray, Predicate, Effect } from 'effect'
import { flattenError } from 'zod'

import { IdSchema } from '#contracts/inputs/common.ts'
import { CreateCustomFieldDefSchema, UpdateCustomFieldDefSchema } from '#contracts/inputs/custom-fields.ts'
import { drizzle, schema } from '#db'
import * as fieldQueries from '#services/custom-fields.ts'

import { visibleProjectFilter } from './access.ts'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors.ts'
import type { ServiceCtx } from './types.ts'

export interface CustomFieldDef {
  id: string
  workspace_id: string
  project_id: string | null
  key: string
  label: string
  type: string
  options: string | null
  created_at: number
}

export interface CustomFieldValue {
  key: string
  label: string
  type: string
  value: string
}

export const listCustomFieldDefs = async function listCustomFieldDefs(ctx: ServiceCtx, projectId?: string | null) {
  return Effect.runPromise(
    fieldQueries.listCustomFieldDefs(
      ctx.db,
      ctx.workspaceId,
      projectId,
      visibleProjectFilter(ctx, schema.customFieldDefinitions.projectId) ?? undefined,
    ),
  )
}

const assertOptionsAllowedForType = function assertOptionsAllowedForType(
  type: string,
  options: string[] | undefined,
): void {
  if (type !== 'select' && options && EffectArray.isArrayNonEmpty(options)) {
    throw new ValidationError({
      formErrors: ['options can only be set for select fields'],
      fieldErrors: {},
    })
  }
}

const assertCustomFieldKeyAvailable = async function assertCustomFieldKeyAvailable(
  orm: ReturnType<typeof drizzle>,
  workspaceId: string,
  projectId: string | null | undefined,
  key: string,
): Promise<void> {
  const projCondition = projectId
    ? eq(schema.customFieldDefinitions.projectId, projectId)
    : isNull(schema.customFieldDefinitions.projectId)

  const existing = await orm
    .select({ id: schema.customFieldDefinitions.id })
    .from(schema.customFieldDefinitions)
    .where(
      and(
        eq(schema.customFieldDefinitions.workspaceId, workspaceId),
        projCondition,
        eq(schema.customFieldDefinitions.key, key),
      ),
    )
    .get()
  if (existing) {
    throw new ConflictError(`Custom field key '${key}' already exists`)
  }
}

const assertCustomFieldDefLimitNotReached = async function assertCustomFieldDefLimitNotReached(
  orm: ReturnType<typeof drizzle>,
  workspaceId: string,
): Promise<void> {
  const count = await orm.$count(
    schema.customFieldDefinitions,
    eq(schema.customFieldDefinitions.workspaceId, workspaceId),
  )
  if (count >= 50) {
    throw new ValidationError({
      formErrors: ['Maximum of 50 custom field definitions per workspace'],
      fieldErrors: {},
    })
  }
}

export const createCustomFieldDef = async function createCustomFieldDef(ctx: ServiceCtx, raw: unknown) {
  if (ctx.role === 'member' || ctx.role === 'viewer') {
    throw new ForbiddenError()
  }
  const result = CreateCustomFieldDefSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(flattenError(result.error))
  }
  const { key, label, type, options, projectId } = result.data

  assertOptionsAllowedForType(type, options)

  const orm = drizzle(ctx.db, { schema })
  await assertCustomFieldKeyAvailable(orm, ctx.workspaceId, projectId, key)
  await assertCustomFieldDefLimitNotReached(orm, ctx.workspaceId)

  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  await orm.insert(schema.customFieldDefinitions).values({
    id,
    workspaceId: ctx.workspaceId,
    projectId: projectId ?? null,
    key,
    label,
    type,
    options: options && EffectArray.isArrayNonEmpty(options) ? JSON.stringify(options) : null,
    createdAt: now,
  })

  return { id, key, label, type }
}

const getCustomFieldDefForUpdate = async function getCustomFieldDefForUpdate(
  orm: ReturnType<typeof drizzle>,
  workspaceId: string,
  id: string,
) {
  const existing = await orm
    .select({ id: schema.customFieldDefinitions.id, type: schema.customFieldDefinitions.type })
    .from(schema.customFieldDefinitions)
    .where(and(eq(schema.customFieldDefinitions.id, id), eq(schema.customFieldDefinitions.workspaceId, workspaceId)))
    .get()
  if (!existing) {
    throw new NotFoundError('Custom field not found')
  }
  return existing
}

const buildCustomFieldUpdateSet = function buildCustomFieldUpdateSet(
  data: ReturnType<typeof UpdateCustomFieldDefSchema.parse>,
  existingType: string,
) {
  if ('options' in data && data.options !== undefined && existingType !== 'select') {
    throw new ValidationError({
      formErrors: ['options can only be set for select fields'],
      fieldErrors: {},
    })
  }

  const setObj: Record<string, unknown> = {}
  if (Predicate.isNotNullish(data.label)) {
    setObj.label = data.label
  }
  if ('options' in data) {
    setObj.options = data.options && EffectArray.isArrayNonEmpty(data.options) ? JSON.stringify(data.options) : null
  }

  if (EffectArray.isArrayEmpty(Object.keys(setObj))) {
    throw new ValidationError({ formErrors: ['Nothing to update'], fieldErrors: {} })
  }

  return setObj
}

export const updateCustomFieldDef = async function updateCustomFieldDef(ctx: ServiceCtx, id: string, raw: unknown) {
  if (ctx.role === 'member' || ctx.role === 'viewer') {
    throw new ForbiddenError()
  }
  const result = UpdateCustomFieldDefSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(flattenError(result.error))
  }
  const data = result.data

  const orm = drizzle(ctx.db, { schema })
  const existing = await getCustomFieldDefForUpdate(orm, ctx.workspaceId, id)
  const setObj = buildCustomFieldUpdateSet(data, existing.type)

  await orm
    .update(schema.customFieldDefinitions)
    .set(setObj)
    .where(
      and(eq(schema.customFieldDefinitions.id, id), eq(schema.customFieldDefinitions.workspaceId, ctx.workspaceId)),
    )

  return { ok: true }
}

export const deleteCustomFieldDef = async function deleteCustomFieldDef(ctx: ServiceCtx, id: string) {
  const idCheck = IdSchema.safeParse(id)
  if (!idCheck.success) {
    throw new ValidationError({ formErrors: flattenError(idCheck.error).formErrors, fieldErrors: {} })
  }
  if (ctx.role === 'member' || ctx.role === 'viewer') {
    throw new ForbiddenError()
  }

  const orm = drizzle(ctx.db, { schema })
  const existing = await orm
    .select({ id: schema.customFieldDefinitions.id })
    .from(schema.customFieldDefinitions)
    .where(
      and(eq(schema.customFieldDefinitions.id, id), eq(schema.customFieldDefinitions.workspaceId, ctx.workspaceId)),
    )
    .get()
  if (!existing) {
    throw new NotFoundError('Custom field not found')
  }

  const inUse = await orm
    .select({ issueId: schema.customFieldValues.issueId })
    .from(schema.customFieldValues)
    .where(eq(schema.customFieldValues.fieldId, id))
    .get()
  if (inUse) {
    throw new ConflictError('Custom field is in use by one or more issues')
  }

  await orm
    .delete(schema.customFieldDefinitions)
    .where(
      and(eq(schema.customFieldDefinitions.id, id), eq(schema.customFieldDefinitions.workspaceId, ctx.workspaceId)),
    )

  return { ok: true }
}

export const buildDefaultCustomFieldStatements = function buildDefaultCustomFieldStatements(
  db: D1Database,
  workspaceId: string,
): D1PreparedStatement[] {
  return [
    db
      .prepare(`INSERT INTO custom_field_definitions
    (id,workspace_id,project_id,key,label,type,options,created_at)
    SELECT ?, ?, NULL, 'story_points', 'Story Points', 'number', NULL, ?
    WHERE NOT EXISTS (SELECT 1 FROM custom_field_definitions
      WHERE workspace_id = ? AND project_id IS NULL AND key = 'story_points')`)
      .bind(crypto.randomUUID(), workspaceId, Math.floor(Date.now() / 1000), workspaceId),
  ]
}

export const seedDefaultCustomFields = async function seedDefaultCustomFields(
  db: D1Database,
  workspaceId: string,
): Promise<void> {
  await db.batch(buildDefaultCustomFieldStatements(db, workspaceId))
}

const assertValidCustomFieldValue = function assertValidCustomFieldValue(
  key: string,
  value: string,
  def: typeof schema.customFieldDefinitions.$inferSelect,
): void {
  if (def.type === 'number') {
    if (Number.isNaN(parseFloat(value)) || !Number.isFinite(parseFloat(value))) {
      throw new ValidationError({
        formErrors: [],
        fieldErrors: { [key]: [`Custom field '${key}' expects a number`] },
      })
    }
  } else if (def.type === 'select') {
    const options: string[] = def.options ? (JSON.parse(def.options) as string[]) : []
    if (!options.includes(value)) {
      throw new ValidationError({
        formErrors: [],
        fieldErrors: { [key]: [`Value '${value}' is not a valid option for field '${key}'`] },
      })
    }
  } else if (def.type === 'date') {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError({
        formErrors: [],
        fieldErrors: { [key]: [`Custom field '${key}' expects a valid date`] },
      })
    }
  }
}

export const validateCustomFields = async function validateCustomFields(
  db: D1Database,
  workspaceId: string,
  customFields: Record<string, unknown>,
): Promise<{ fieldId: string; value: string }[]> {
  if (EffectArray.isArrayEmpty(Object.keys(customFields))) {
    return []
  }

  const orm = drizzle(db, { schema })
  const defs = await orm
    .select()
    .from(schema.customFieldDefinitions)
    .where(eq(schema.customFieldDefinitions.workspaceId, workspaceId))

  const defsByKey = new Map(defs.map((d) => [d.key, d]))
  const writes: { fieldId: string; value: string }[] = []

  for (const [key, rawValue] of Object.entries(customFields)) {
    const def = defsByKey.get(key)
    if (!def) {
      throw new ValidationError({
        formErrors: [],
        fieldErrors: { [key]: [`Unknown custom field key: ${key}`] },
      })
    }

    if (rawValue === null || Predicate.isNullish(rawValue) || rawValue === '') {
      continue
    }

    // oxlint-disable-next-line @typescript-eslint/no-base-to-string -- Preserve existing custom-field coercion before validation, including object values.
    const value = String(rawValue)
    assertValidCustomFieldValue(key, value, def)

    writes.push({ fieldId: def.id, value })
  }

  return writes
}

/*
 * PROJ-870: replaces writeCustomFieldValues' one-upsert-per-field loop. Builds (without
 * executing) multi-row upserts for every custom-field write on one issue, so the caller can
 * fold them into its own ctx.db.batch() alongside the issue write. Chunked for D1's
 * 100-bound-param cap: 3 params/row x 30 rows = 90, same headroom as services/sql.ts.
 */
const CUSTOM_FIELD_UPSERT_CHUNK_SIZE = 30 // 3 cols/row

export const buildCustomFieldUpsertStatements = function buildCustomFieldUpsertStatements(
  db: D1Database,
  issueId: string,
  writes: Readonly<{ fieldId: string; value: string }[]>,
): D1PreparedStatement[] {
  if (EffectArray.isReadonlyArrayEmpty(writes)) {
    return []
  }
  const orm = drizzle(db, { schema })
  const statements: D1PreparedStatement[] = []
  for (let index = 0; index < writes.length; index += CUSTOM_FIELD_UPSERT_CHUNK_SIZE) {
    const rowChunk = writes
      .slice(index, index + CUSTOM_FIELD_UPSERT_CHUNK_SIZE)
      .map(({ fieldId, value }) => ({ issueId, fieldId, value }))
    const query = orm
      .insert(schema.customFieldValues)
      .values(rowChunk)
      .onConflictDoUpdate({
        target: [schema.customFieldValues.issueId, schema.customFieldValues.fieldId],
        set: { value: sql`excluded.value` },
      })
      .toSQL()
    statements.push(db.prepare(query.sql).bind(...query.params))
  }
  return statements
}

export const batchLoadCustomFields = async function batchLoadCustomFields(
  db: D1Database,
  workspaceId: string,
  issueIds: string[],
): Promise<Record<string, CustomFieldValue[]>> {
  return Effect.runPromise(fieldQueries.batchLoadCustomFields(db, workspaceId, issueIds))
}
