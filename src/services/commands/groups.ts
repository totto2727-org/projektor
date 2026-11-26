import { and, eq } from 'drizzle-orm'
import { Array, Predicate, Effect } from 'effect'
import { flattenError } from 'zod'

import {
  AddGroupMemberSchema,
  CreateGroupSchema,
  SetGroupGrantSchema,
  UpdateGroupSchema,
} from '#contracts/inputs/groups.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { drizzle, schema } from '#db'
import * as groupData from '#services/groups.ts'

import { isWorkspaceAdmin } from './access.ts'
import { recordActivity } from './activity.ts'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, validationIssues } from './errors.ts'
import type { ServiceCtx } from './types.ts'

type GroupOrm = ReturnType<typeof drizzle<typeof schema>>
type GroupDetails = groupData.GroupRow & {
  grants: Effect.Success<ReturnType<typeof groupData.listGroupGrants>>
  members: Effect.Success<ReturnType<typeof groupData.listGroupMembers>>
}
type CreatedGroup = Pick<groupData.GroupRow, 'name' | 'description'> & { id: ReturnType<typeof crypto.randomUUID> }

const requireAdmin = function requireAdmin(ctx: ServiceCtx): void {
  if (!isWorkspaceAdmin(ctx.role)) {
    throw new ForbiddenError()
  }
}

/**
 * Load a group scoped to the workspace, or throw NotFound.
 *
 * @param {ReturnType<typeof drizzle>} orm The Drizzle connection.
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {string} groupId The group ID in the caller's workspace.
 * @returns {Promise<groupData.GroupRow>} The group row in the workspace.
 */
const loadGroup = async function loadGroup(
  orm: ReturnType<typeof drizzle>,
  ctx: ServiceCtx,
  groupId: string,
): Promise<groupData.GroupRow> {
  const group = await orm
    .select()
    .from(schema.userGroups)
    .where(and(eq(schema.userGroups.id, groupId), eq(schema.userGroups.workspaceId, ctx.workspaceId)))
    .get()
  if (!group) {
    throw new NotFoundError('Group not found')
  }
  return group
}

/**
 * Requires workspace-admin, then loads the group (or throws NotFound).
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {string} groupId The group ID in the caller's workspace.
 * @returns {Promise<{ orm: GroupOrm; group: groupData.GroupRow }>} The database connection and group after the admin check.
 */
const requireAdminGroup = async function requireAdminGroup(
  ctx: ServiceCtx,
  groupId: string,
): Promise<{ orm: GroupOrm; group: groupData.GroupRow }> {
  requireAdmin(ctx)
  const orm = drizzle(ctx.db, { schema })
  const group = await loadGroup(orm, ctx, groupId)
  return fieldsInOrder([
    ['orm', orm],
    ['group', group],
  ])
}

/**
 * List groups. Owner/admin see every group in the workspace; a plain member sees
 * only the groups they belong to (ticket: "members see only their own groups").
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @returns {Promise<Effect.Success<ReturnType<typeof groupData.listGroups>>>} The groups visible to the caller and their membership and grant counts.
 */
export const listGroups = async function listGroups(
  ctx: ServiceCtx,
): Promise<Effect.Success<ReturnType<typeof groupData.listGroups>>> {
  return Effect.runPromise(
    groupData.listGroups(ctx.db, ctx.workspaceId, isWorkspaceAdmin(ctx.role) ? {} : { memberUserId: ctx.userId }),
  )
}

/**
 * Full group detail: members and project grants. Owner/admin may view any group;
 * a plain member may view only groups they belong to.
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {string} groupId The group ID in the caller's workspace.
 * @returns {Promise<GroupDetails>} The group row with member and project-grant details.
 */
export const getGroup = async function getGroup(ctx: ServiceCtx, groupId: string): Promise<GroupDetails> {
  const orm = drizzle(ctx.db, { schema })
  await loadGroup(orm, ctx, groupId)

  if (!isWorkspaceAdmin(ctx.role)) {
    const own = await orm
      .select({ userId: schema.userGroupMembers.userId })
      .from(schema.userGroupMembers)
      .where(and(eq(schema.userGroupMembers.groupId, groupId), eq(schema.userGroupMembers.userId, ctx.userId)))
      .get()
    if (!own) {
      throw new ForbiddenError()
    }
  }

  const group = await Effect.runPromise(groupData.findGroup(ctx.db, ctx.workspaceId, groupId))
  if (!group) {
    throw new NotFoundError('Group not found')
  }
  const members = await Effect.runPromise(groupData.listGroupMembers(ctx.db, ctx.workspaceId, groupId))
  const grants = await Effect.runPromise(groupData.listGroupGrants(ctx.db, ctx.workspaceId, groupId))

  return {
    ...group,
    ...fieldsInOrder([
      ['members', members],
      ['grants', grants],
    ]),
  }
}

/**
 * Per-member group membership for the whole workspace, driving the members-admin
 * screen (group chips + the "no groups / pending" badge). Owner/admin only.
 * Includes members with zero groups so the pending state is visible.
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @returns {Promise<{userId: string, groups: {id: string, name: string}[] }[]>} The workspace members and each member's groups.
 */
export const listMemberGroups = async function listMemberGroups(
  ctx: ServiceCtx,
): Promise<{ userId: string; groups: { id: string; name: string }[] }[]> {
  requireAdmin(ctx)
  return Effect.runPromise(groupData.listMemberGroups(ctx.db, ctx.workspaceId))
}

export const createGroup = async function createGroup(ctx: ServiceCtx, input: unknown): Promise<CreatedGroup> {
  requireAdmin(ctx)
  const parsed = CreateGroupSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { name, description } = parsed.data

  const orm = drizzle(ctx.db, { schema })
  const existing = await orm
    .select({ id: schema.userGroups.id })
    .from(schema.userGroups)
    .where(and(eq(schema.userGroups.workspaceId, ctx.workspaceId), eq(schema.userGroups.name, name)))
    .get()
  if (existing) {
    throw new ConflictError(`Group "${name}" already exists`)
  }

  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await orm.insert(schema.userGroups).values(
    fieldsInOrder([
      ['id', id],
      ['workspaceId', ctx.workspaceId],
      ['name', name],
      ['description', description ?? null],
      ['createdAt', now],
    ]),
  )

  await recordActivity(ctx, {
    action: 'created',
    diff: { name },
    entityId: id,
    entityType: 'group',
  })
  return fieldsInOrder([
    ['id', id],
    ['name', name],
    ['description', description ?? null],
  ])
}

export const updateGroup = async function updateGroup(
  ctx: ServiceCtx,
  groupId: string,
  input: unknown,
): Promise<{ ok: boolean }> {
  requireAdmin(ctx)
  const parsed = UpdateGroupSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }

  const setObj: Record<string, unknown> = {}
  if (Predicate.isNotNullish(parsed.data.name)) {
    setObj.name = parsed.data.name
  }
  if (parsed.data.description !== undefined) {
    setObj.description = parsed.data.description
  }
  if (Array.isArrayEmpty(Object.keys(setObj))) {
    throw new ValidationError(validationIssues(['Nothing to update'], {}))
  }

  const orm = drizzle(ctx.db, { schema })
  await loadGroup(orm, ctx, groupId)

  if (setObj.name !== undefined) {
    const clash = await orm
      .select({ id: schema.userGroups.id })
      .from(schema.userGroups)
      .where(and(eq(schema.userGroups.workspaceId, ctx.workspaceId), eq(schema.userGroups.name, setObj.name as string)))
      .get()
    if (clash && clash.id !== groupId) {
      throw new ConflictError(`Group "${parsed.data.name}" already exists`)
    }
  }

  await orm
    .update(schema.userGroups)
    .set(setObj)
    .where(and(eq(schema.userGroups.id, groupId), eq(schema.userGroups.workspaceId, ctx.workspaceId)))

  await recordActivity(ctx, {
    action: 'updated',
    diff: setObj,
    entityId: groupId,
    entityType: 'group',
  })
  return { ok: true }
}

export const deleteGroup = async function deleteGroup(ctx: ServiceCtx, groupId: string): Promise<{ ok: boolean }> {
  await requireAdminGroup(ctx, groupId)

  /*
   * PROJ-923: D1 doesn't guarantee the FK cascades (PROJ-407) — remove the group's
   * members and project grants explicitly, in the same batch as the group itself.
   */
  await ctx.db.batch([
    ctx.db.prepare('DELETE FROM user_group_members WHERE group_id = ?').bind(groupId),
    ctx.db.prepare('DELETE FROM group_project_grants WHERE group_id = ?').bind(groupId),
    ctx.db.prepare('DELETE FROM user_groups WHERE id = ? AND workspace_id = ?').bind(groupId, ctx.workspaceId),
  ])

  await recordActivity(ctx, { action: 'deleted', entityId: groupId, entityType: 'group' })
  return { ok: true }
}

export const addGroupMember = async function addGroupMember(
  ctx: ServiceCtx,
  groupId: string,
  input: unknown,
): Promise<{ ok: boolean }> {
  requireAdmin(ctx)
  const parsed = AddGroupMemberSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { userId } = parsed.data

  const orm = drizzle(ctx.db, { schema })
  await loadGroup(orm, ctx, groupId)

  // The target must already be a member of this workspace.
  const wsMember = await orm
    .select({ userId: schema.workspaceMembers.userId })
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.workspaceId, ctx.workspaceId), eq(schema.workspaceMembers.userId, userId)))
    .get()
  if (!wsMember) {
    throw new ValidationError(validationIssues(['User is not a workspace member'], {}))
  }

  const now = currentEpochSeconds()
  await orm
    .insert(schema.userGroupMembers)
    .values(
      fieldsInOrder([
        ['groupId', groupId],
        ['userId', userId],
        ['addedBy', ctx.userId],
        ['addedAt', now],
      ]),
    )
    .onConflictDoNothing()

  await recordActivity(ctx, {
    action: 'updated',
    diff: { addedMember: userId },
    entityId: groupId,
    entityType: 'group',
  })
  return { ok: true }
}

export const removeGroupMember = async function removeGroupMember(
  ctx: ServiceCtx,
  groupId: string,
  userId: string,
): Promise<{ ok: boolean }> {
  const { orm } = await requireAdminGroup(ctx, groupId)

  await orm
    .delete(schema.userGroupMembers)
    .where(and(eq(schema.userGroupMembers.groupId, groupId), eq(schema.userGroupMembers.userId, userId)))

  await recordActivity(ctx, {
    action: 'updated',
    diff: { removedMember: userId },
    entityId: groupId,
    entityType: 'group',
  })
  return { ok: true }
}

export const setGroupGrant = async function setGroupGrant(
  ctx: ServiceCtx,
  groupId: string,
  input: unknown,
): Promise<{ ok: boolean }> {
  requireAdmin(ctx)
  const parsed = SetGroupGrantSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { projectId, role } = parsed.data

  const orm = drizzle(ctx.db, { schema })
  await loadGroup(orm, ctx, groupId)

  // The project must belong to this workspace.
  const project = await orm
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId)))
    .get()
  if (!project) {
    throw new NotFoundError('Project not found')
  }

  await orm
    .insert(schema.groupProjectGrants)
    .values({ groupId, projectId, role })
    .onConflictDoUpdate({
      target: [schema.groupProjectGrants.groupId, schema.groupProjectGrants.projectId],
      set: { role },
    })

  await recordActivity(ctx, {
    action: 'updated',
    diff: { grant: { projectId, role } },
    entityId: groupId,
    entityType: 'group',
  })
  return { ok: true }
}

export const removeGroupGrant = async function removeGroupGrant(
  ctx: ServiceCtx,
  groupId: string,
  projectId: string,
): Promise<{ ok: boolean }> {
  requireAdmin(ctx)
  const orm = drizzle(ctx.db, { schema })
  await loadGroup(orm, ctx, groupId)

  await orm
    .delete(schema.groupProjectGrants)
    .where(and(eq(schema.groupProjectGrants.groupId, groupId), eq(schema.groupProjectGrants.projectId, projectId)))

  await recordActivity(ctx, {
    action: 'updated',
    diff: { removedGrant: projectId },
    entityId: groupId,
    entityType: 'group',
  })
  return { ok: true }
}
