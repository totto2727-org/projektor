import { drizzle, schema, type WorkspaceBrand } from "@projektor/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Effect } from "effect";
import { type DataQueryError, queryEffect } from "./errors";
import type {
	Workspace,
	WorkspaceMember,
	WorkspaceMemberRelation,
	WorkspaceMembership,
	WorkspaceTokenMetadata,
} from "./types";
export type {
	Workspace,
	WorkspaceMember,
	WorkspaceMemberRelation,
	WorkspaceMembership,
	WorkspaceTokenMetadata,
} from "./types";
export type { WorkspaceBrand } from "@projektor/db";

export function listWorkspaces(
	db: D1Database,
	userId: string,
): Effect.Effect<WorkspaceMembership[], DataQueryError> {
	return queryEffect("listWorkspaces", () =>
		drizzle(db, { schema })
			.select({
				id: schema.workspaces.id,
				name: schema.workspaces.name,
				slug: schema.workspaces.slug,
				createdAt: schema.workspaces.createdAt,
				role: schema.workspaceMembers.role,
			})
			.from(schema.workspaces)
			.innerJoin(
				schema.workspaceMembers,
				eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
			)
			.where(eq(schema.workspaceMembers.userId, userId))
			.orderBy(asc(schema.workspaces.name)),
	);
}

export function findWorkspaceBySlug(
	db: D1Database,
	slug: string,
): Effect.Effect<Workspace | undefined, DataQueryError> {
	return queryEffect("findWorkspaceBySlug", () =>
		drizzle(db, { schema })
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.slug, slug))
			.get(),
	);
}

/** Return the membership relation. The app decides what its role permits. */
export function findWorkspaceMembership(
	db: D1Database,
	workspaceId: string,
	userId: string,
): Effect.Effect<WorkspaceMemberRelation | undefined, DataQueryError> {
	return queryEffect("findWorkspaceMembership", () =>
		drizzle(db, { schema })
			.select()
			.from(schema.workspaceMembers)
			.where(
				and(
					eq(schema.workspaceMembers.workspaceId, workspaceId),
					eq(schema.workspaceMembers.userId, userId),
				),
			)
			.get(),
	);
}

export function listWorkspaceMembers(
	db: D1Database,
	workspaceId: string,
): Effect.Effect<WorkspaceMember[], DataQueryError> {
	return queryEffect("listWorkspaceMembers", () =>
		drizzle(db, { schema })
			.select({
				id: schema.users.id,
				email: schema.users.email,
				name: schema.users.name,
				avatarUrl: schema.users.avatarUrl,
				role: schema.workspaceMembers.role,
				joinedAt: schema.workspaceMembers.joinedAt,
			})
			.from(schema.workspaceMembers)
			.innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
			.where(eq(schema.workspaceMembers.workspaceId, workspaceId))
			.orderBy(asc(schema.workspaceMembers.joinedAt)),
	);
}

export function readWorkspaceBrand(
	db: D1Database,
	workspaceId: string,
): Effect.Effect<WorkspaceBrand, DataQueryError> {
	return queryEffect("readWorkspaceBrand", async () => {
		const row = await drizzle(db, { schema })
			.select({ brand: schema.workspaces.brand })
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, workspaceId))
			.get();
		return row?.brand ?? {};
	});
}

/** Secret token hashes/values are deliberately absent from this projection. */
export function listWorkspaceTokenMetadata(
	db: D1Database,
	workspaceId: string,
): Effect.Effect<WorkspaceTokenMetadata[], DataQueryError> {
	return queryEffect("listWorkspaceTokenMetadata", () =>
		drizzle(db, { schema })
			.select({
				id: schema.apiTokens.id,
				name: schema.apiTokens.name,
				scopes: schema.apiTokens.scopes,
				lastUsedAt: schema.apiTokens.lastUsedAt,
				expiresAt: schema.apiTokens.expiresAt,
				createdAt: schema.apiTokens.createdAt,
			})
			.from(schema.apiTokens)
			.where(eq(schema.apiTokens.workspaceId, workspaceId))
			.orderBy(desc(schema.apiTokens.createdAt)),
	);
}
