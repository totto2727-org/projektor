import { and, asc, eq } from 'drizzle-orm'
import { Iterable, Predicate } from 'effect'
import type { Effect } from 'effect'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { drizzle, schema } from '#db'

import { queryEffect } from './errors.ts'
import type { DataQueryError } from './errors.ts'

export type GroupRow = typeof schema.userGroups.$inferSelect
type GroupListRow = Pick<GroupRow, 'id' | 'name' | 'description' | 'createdAt'> & {
  grantCount: number
  memberCount: number
}
type GroupMember = Pick<typeof schema.userGroupMembers.$inferSelect, 'addedAt' | 'addedBy' | 'userId'> &
  Pick<typeof schema.users.$inferSelect, 'email' | 'name'>
type GroupGrant = Pick<typeof schema.groupProjectGrants.$inferSelect, 'projectId' | 'role'> & {
  projectKey: string
  projectName: string
}
interface MemberGroups {
  groups: Pick<GroupRow, 'id' | 'name'>[]
  userId: string
}

/**
 * The app decides whether to pass a membership filter or request all workspace groups.
 *
 * @param {D1Database} db Database that stores groups and memberships.
 * @param {string} workspaceId Workspace that owns the groups.
 * @param {{ memberUserId?: string }} [options] Restrict the result to groups that include this user.
 * @returns {Effect.Effect<GroupListRow[], DataQueryError>} Matching groups with membership and grant counts.
 */
export const listGroups = function listGroups(
  db: D1Database,
  workspaceId: string,
  options: { memberUserId?: string } = {},
): Effect.Effect<GroupListRow[], DataQueryError> {
  return queryEffect('listGroups', async () => {
    const orm = drizzle(db, { schema })
    const columns = {
      id: schema.userGroups.id,
      name: schema.userGroups.name,
      description: schema.userGroups.description,
      createdAt: schema.userGroups.createdAt,
      memberCount: orm.$count(schema.userGroupMembers, eq(schema.userGroupMembers.groupId, schema.userGroups.id)),
      grantCount: orm.$count(schema.groupProjectGrants, eq(schema.groupProjectGrants.groupId, schema.userGroups.id)),
    }
    if (Predicate.isNotNullish(options.memberUserId)) {
      return orm
        .select(columns)
        .from(schema.userGroups)
        .innerJoin(schema.userGroupMembers, eq(schema.userGroupMembers.groupId, schema.userGroups.id))
        .where(
          and(eq(schema.userGroups.workspaceId, workspaceId), eq(schema.userGroupMembers.userId, options.memberUserId)),
        )
        .orderBy(asc(schema.userGroups.name))
    }
    return orm
      .select(columns)
      .from(schema.userGroups)
      .where(eq(schema.userGroups.workspaceId, workspaceId))
      .orderBy(asc(schema.userGroups.name))
  })
}
export const findGroup = function findGroup(
  db: D1Database,
  workspaceId: string,
  groupId: string,
): Effect.Effect<GroupRow | undefined, DataQueryError> {
  return queryEffect('findGroup', async () =>
    drizzle(db, { schema })
      .select()
      .from(schema.userGroups)
      .where(and(eq(schema.userGroups.id, groupId), eq(schema.userGroups.workspaceId, workspaceId)))
      .get(),
  )
}
export const listGroupMembers = function listGroupMembers(
  db: D1Database,
  workspaceId: string,
  groupId: string,
): Effect.Effect<GroupMember[], DataQueryError> {
  return queryEffect('listGroupMembers', async () =>
    drizzle(db, { schema })
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        addedAt: schema.userGroupMembers.addedAt,
        addedBy: schema.userGroupMembers.addedBy,
      })
      .from(schema.userGroupMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.userGroupMembers.userId))
      .innerJoin(schema.userGroups, eq(schema.userGroups.id, schema.userGroupMembers.groupId))
      .where(and(eq(schema.userGroups.id, groupId), eq(schema.userGroups.workspaceId, workspaceId)))
      .orderBy(asc(schema.userGroupMembers.addedAt)),
  )
}
export const listGroupGrants = function listGroupGrants(
  db: D1Database,
  workspaceId: string,
  groupId: string,
): Effect.Effect<GroupGrant[], DataQueryError> {
  return queryEffect('listGroupGrants', async () =>
    drizzle(db, { schema })
      .select({
        projectId: schema.groupProjectGrants.projectId,
        projectName: schema.projects.name,
        projectKey: schema.projects.key,
        role: schema.groupProjectGrants.role,
      })
      .from(schema.groupProjectGrants)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.groupProjectGrants.projectId))
      .innerJoin(schema.userGroups, eq(schema.userGroups.id, schema.groupProjectGrants.groupId))
      .where(
        and(
          eq(schema.userGroups.id, groupId),
          eq(schema.userGroups.workspaceId, workspaceId),
          eq(schema.projects.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(schema.projects.name)),
  )
}
export const listMemberGroups = function listMemberGroups(
  db: D1Database,
  workspaceId: string,
): Effect.Effect<MemberGroups[], DataQueryError> {
  return queryEffect('listMemberGroups', async () => {
    const rows = await drizzle(db, { schema })
      .select({
        userId: schema.workspaceMembers.userId,
        groupId: schema.userGroups.id,
        groupName: schema.userGroups.name,
      })
      .from(schema.workspaceMembers)
      .leftJoin(schema.userGroupMembers, eq(schema.userGroupMembers.userId, schema.workspaceMembers.userId))
      .leftJoin(
        schema.userGroups,
        and(eq(schema.userGroups.id, schema.userGroupMembers.groupId), eq(schema.userGroups.workspaceId, workspaceId)),
      )
      .where(eq(schema.workspaceMembers.workspaceId, workspaceId))
    const byUser = new Map<string, { id: string; name: string }[]>()
    Iterable.forEach(rows, (row) => {
      if (!byUser.has(row.userId)) {
        byUser.set(row.userId, [])
      }
      if (isNonEmptyText(row.groupId) && isNonEmptyText(row.groupName)) {
        byUser.get(row.userId)?.push({ id: row.groupId, name: row.groupName })
      }
    })
    return Array.from(byUser, ([userId, groups]) => ({ userId, groups }))
  })
}
