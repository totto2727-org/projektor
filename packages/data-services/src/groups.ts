import { drizzle, schema } from "@projektor/db";
import { and, asc, eq } from "drizzle-orm";
import { queryEffect } from "./errors";

/** The app decides whether to pass a membership filter or request all workspace groups. */
export function listGroups(
	db: D1Database,
	workspaceId: string,
	options: { memberUserId?: string } = {},
) {
	return queryEffect("listGroups", async () => {
		const orm = drizzle(db, { schema });
		const columns = {
			id: schema.userGroups.id,
			name: schema.userGroups.name,
			description: schema.userGroups.description,
			createdAt: schema.userGroups.createdAt,
			memberCount: orm.$count(
				schema.userGroupMembers,
				eq(schema.userGroupMembers.groupId, schema.userGroups.id),
			),
			grantCount: orm.$count(
				schema.groupProjectGrants,
				eq(schema.groupProjectGrants.groupId, schema.userGroups.id),
			),
		};
		if (options.memberUserId !== undefined) {
			return orm
				.select(columns)
				.from(schema.userGroups)
				.innerJoin(
					schema.userGroupMembers,
					eq(schema.userGroupMembers.groupId, schema.userGroups.id),
				)
				.where(
					and(
						eq(schema.userGroups.workspaceId, workspaceId),
						eq(schema.userGroupMembers.userId, options.memberUserId),
					),
				)
				.orderBy(asc(schema.userGroups.name));
		}
		return orm
			.select(columns)
			.from(schema.userGroups)
			.where(eq(schema.userGroups.workspaceId, workspaceId))
			.orderBy(asc(schema.userGroups.name));
	});
}
export function findGroup(db: D1Database, workspaceId: string, groupId: string) {
	return queryEffect("findGroup", async () =>
		drizzle(db, { schema })
			.select()
			.from(schema.userGroups)
			.where(and(eq(schema.userGroups.id, groupId), eq(schema.userGroups.workspaceId, workspaceId)))
			.get(),
	);
}
export function listGroupMembers(db: D1Database, workspaceId: string, groupId: string) {
	return queryEffect("listGroupMembers", async () =>
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
	);
}
export function listGroupGrants(db: D1Database, workspaceId: string, groupId: string) {
	return queryEffect("listGroupGrants", async () =>
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
	);
}
export function listMemberGroups(db: D1Database, workspaceId: string) {
	return queryEffect("listMemberGroups", async () => {
		const rows = await drizzle(db, { schema })
			.select({
				userId: schema.workspaceMembers.userId,
				groupId: schema.userGroups.id,
				groupName: schema.userGroups.name,
			})
			.from(schema.workspaceMembers)
			.leftJoin(
				schema.userGroupMembers,
				eq(schema.userGroupMembers.userId, schema.workspaceMembers.userId),
			)
			.leftJoin(
				schema.userGroups,
				and(
					eq(schema.userGroups.id, schema.userGroupMembers.groupId),
					eq(schema.userGroups.workspaceId, workspaceId),
				),
			)
			.where(eq(schema.workspaceMembers.workspaceId, workspaceId));
		const byUser = new Map<string, { id: string; name: string }[]>();
		for (const row of rows) {
			if (!byUser.has(row.userId)) byUser.set(row.userId, []);
			if (row.groupId && row.groupName)
				byUser.get(row.userId)?.push({ id: row.groupId, name: row.groupName });
		}
		return Array.from(byUser, ([userId, groups]) => ({ userId, groups }));
	});
}
