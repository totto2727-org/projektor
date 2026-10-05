import type { D1Database } from "@cloudflare/workers-types";
import type { ProjectSummaryVisibility } from "@projektor/data-services";
import { type Column, type SQL, sql } from "drizzle-orm";
import { ApiError, ScopeError } from "./errors";
import type {
	AuthSession,
	ProjectSummary,
	RequestScope,
	WorkspaceMembership,
} from "./request-context";

/** Application policy, deliberately not part of the pure shared data package. */
export function projectSummaryVisibility(userId: string): ProjectSummaryVisibility {
	return {
		sql: `wm.role IN ('owner','admin') OR EXISTS (
			SELECT 1 FROM user_group_members ugm
			JOIN group_project_grants gpg ON gpg.group_id = ugm.group_id
			WHERE ugm.user_id = ? AND gpg.project_id = p.id)`,
		bindings: [userId],
	};
}

/** /auth/me remains the sole credential verifier. Token restrictions cannot be dropped by a DB read. */
export function requireBrowserDataRequest(request: Request): void {
	if (request.headers.has("authorization")) {
		throw new ScopeError(403, "An interactive browser session is required.");
	}
}

export function requireAuthenticatedDataSession(session: AuthSession): void {
	if (session.user.email === "public-viewer@projektor.local") {
		throw new ScopeError(403, "An interactive browser session is required.");
	}
}

/** Never expose driver SQL, bindings or authentication diagnostics to page clients. */
export function dataError(cause: unknown): ApiError {
	if (cause instanceof ApiError) return cause;
	return new ApiError("request", 500, "Unable to load project data.", cause);
}

export function requireDataDatabase(db: D1Database): D1Database {
	if (!db || typeof db.prepare !== "function") {
		throw new ApiError("configuration", 500, "The application database is not configured.");
	}
	return db;
}

/** Explicit authenticated membership or request-resolved selection, never a first-workspace fallback. */
export function requireDataWorkspace(
	scope: RequestScope,
	workspaceId?: string,
): WorkspaceMembership {
	requireAuthenticatedDataSession(scope);
	const selected = scope.selection;
	const id =
		workspaceId ??
		(selected.kind === "workspace" || selected.kind === "project"
			? selected.workspace.id
			: undefined);
	const membership = scope.workspaces.find((workspace) => workspace.id === id);
	if (!membership) throw new ScopeError(403, "Selected workspace is not accessible.");
	return membership;
}

/** A fetched project/entity must still be present in the authorized request catalog. */
export function requireDataProject(
	scope: RequestScope,
	projectId: string,
	workspaceId?: string,
): ProjectSummary {
	requireAuthenticatedDataSession(scope);
	const project = scope.projects.find(
		(candidate) =>
			candidate.id === projectId &&
			(workspaceId === undefined || candidate.workspace_id === workspaceId),
	);
	const membership =
		project &&
		scope.workspaces.find(
			(workspace) =>
				workspace.id === project.workspace_id && workspace.slug === project.workspace_slug,
		);
	if (!project || !membership) throw new ScopeError(404, "Selected project is not accessible.");
	return project;
}

export function authorizeDataEntity<T extends { readonly projectId: string | null }>(
	scope: RequestScope,
	workspaceId: string,
	entity: T | undefined,
): T {
	if (!entity) throw new ScopeError(404, "Not found.");
	requireDataWorkspace(scope, workspaceId);
	if (entity.projectId !== null) requireDataProject(scope, entity.projectId, workspaceId);
	return entity;
}

/** Mirrors API services/access.ts. The caller's shared query must also scope workspace_id. */
export function visibleProjectPredicate(
	scope: RequestScope,
	workspaceId: string,
	projectColumn: Column | SQL,
): SQL | undefined {
	const workspace = requireDataWorkspace(scope, workspaceId);
	if (workspace.role === "owner" || workspace.role === "admin") return undefined;
	return sql`EXISTS (
		SELECT 1 FROM user_group_members ugm
		JOIN group_project_grants gpg ON gpg.group_id = ugm.group_id
		WHERE ugm.user_id = ${scope.user.id} AND gpg.project_id = ${projectColumn}
	)`;
}

/** Server-only per-request capabilities. Never serialize this object into client props. */
export function makeDataContext(
	services: { readonly db: D1Database },
	scope: RequestScope,
	workspaceId?: string,
) {
	const workspace = requireDataWorkspace(scope, workspaceId);
	return {
		db: requireDataDatabase(services.db),
		scope,
		workspace,
		workspaceId: workspace.id,
		userId: scope.user.id,
		visibility: (projectColumn: Column | SQL) =>
			visibleProjectPredicate(scope, workspace.id, projectColumn),
	};
}
