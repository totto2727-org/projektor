import type { schema } from "@projektor/db";
import type { Role } from "@projektor/types";
import type { SQL } from "drizzle-orm";

export type Project = typeof schema.projects.$inferSelect;
export type Workspace = typeof schema.workspaces.$inferSelect;
export type WorkspaceMemberRelation = typeof schema.workspaceMembers.$inferSelect;

/** Relational projection, retaining the existing catalog column names. */
export interface ProjectSummary {
	id: string;
	name: string;
	key: string;
	slug: string | null;
	description: string | null;
	workspace_id: string;
	workspace_name: string;
	workspace_slug: string;
	open_issue_count: number;
	backlog_issue_count: number;
	archived_at: number | null;
	created_at: number;
	updated_at: number;
}

export interface ProjectListOptions {
	includeArchived?: boolean;
	/** An app-authorized predicate against schema.projects, not a role decision. */
	visibility?: SQL;
}

/**
 * Trusted app-authored SQL against aliases p (projects) and wm (membership).
 * This must never come from a request parameter. Policy and its bindings belong
 * to the calling app. The query itself still requires the user's membership.
 */
export interface ProjectSummaryVisibility {
	sql: string;
	bindings: readonly string[];
}

export interface WorkspaceMembership {
	id: string;
	name: string;
	slug: string;
	createdAt: number;
	role: Role;
}

export interface WorkspaceMember {
	id: string;
	email: string;
	name: string;
	avatarUrl: string | null;
	role: Role;
	joinedAt: number;
}

export type WorkspaceTokenMetadata = Pick<
	typeof schema.apiTokens.$inferSelect,
	"id" | "name" | "scopes" | "lastUsedAt" | "expiresAt" | "createdAt"
>;
