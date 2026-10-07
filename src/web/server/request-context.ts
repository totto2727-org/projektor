import type { D1Database } from "@cloudflare/workers-types";
import { listProjectSummaries } from "#services";
import { Effect, Schema } from "effect";
import { HttpClientResponse } from "effect/http";
import type { RequestApi } from "./api-client";
import { ApiError, responseError, ScopeError } from "./errors";
import {
	dataError,
	projectSummaryVisibility,
	requireAuthenticatedDataSession,
	requireBrowserDataRequest,
	requireDataDatabase,
} from "./data-context";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

export const AuthUserSchema = Schema.Struct({
	id: NonEmptyString,
	email: NonEmptyString,
	name: Schema.String,
});
export type AuthUser = typeof AuthUserSchema.Type;

export const WorkspaceMembershipSchema = Schema.Struct({
	id: NonEmptyString,
	name: Schema.String,
	slug: NonEmptyString,
	role: Schema.Literals(["owner", "admin", "member", "viewer"]),
});
export type WorkspaceMembership = typeof WorkspaceMembershipSchema.Type;

export const AuthSessionSchema = Schema.Struct({
	user: AuthUserSchema,
	workspaces: Schema.Array(WorkspaceMembershipSchema),
});
export type AuthSession = typeof AuthSessionSchema.Type;

/** The existing cross-workspace GET /api/projects response, not a new API DTO. */
export const ProjectSummarySchema = Schema.Struct({
	id: NonEmptyString,
	name: Schema.String,
	key: NonEmptyString,
	slug: Schema.NullOr(Schema.String),
	description: Schema.NullOr(Schema.String),
	workspace_id: NonEmptyString,
	workspace_name: Schema.String,
	workspace_slug: NonEmptyString,
	open_issue_count: Schema.Number,
	backlog_issue_count: Schema.Number,
	archived_at: Schema.NullOr(Schema.Number),
	created_at: Schema.Number,
	updated_at: Schema.Number,
});
export type ProjectSummary = typeof ProjectSummarySchema.Type;
export const ProjectCatalogSchema = Schema.Array(ProjectSummarySchema);

export const decodeAuthSession = Schema.decodeUnknownSync(AuthSessionSchema);
export const decodeProjectCatalog = Schema.decodeUnknownSync(ProjectCatalogSchema);

export type ScopeSelection =
	| { readonly kind: "global" }
	| { readonly kind: "workspace"; readonly workspace: WorkspaceMembership }
	| {
			readonly kind: "project";
			readonly workspace: WorkspaceMembership;
			readonly project: ProjectSummary;
	  }
	| {
			readonly kind: "selection-required";
			readonly target: "workspace" | "project";
			readonly reason: "empty" | "ambiguous";
	  };

/** Serializable data only. The transport/Request/credentials never belong here. */
export interface RequestScope {
	readonly user: AuthUser;
	readonly workspaces: readonly WorkspaceMembership[];
	readonly projects: readonly ProjectSummary[];
	readonly selection: ScopeSelection;
}

export interface ScopeOptions {
	readonly requireProject?: boolean;
	readonly requireWorkspace?: boolean;
	/** Route parameters may explicitly supply these, without client store fallback. */
	readonly projectHint?: string;
	readonly workspaceHint?: string;
}

function queryHint(url: URL, name: string): string | undefined {
	const values = url.searchParams.getAll(name).filter((value) => value !== "");
	if (new Set(values).size > 1) throw new ScopeError(400, `Ambiguous ${name} parameter.`);
	return values[0];
}

export function readProjectHint(url: URL): string | undefined {
	const query = queryHint(url, "projectId") ?? queryHint(url, "project");
	if (query) return query;
	// Path parameters come from Effront's matched route through RequestServices.
	// Other ?id values identify issues, wiki pages or feedback, not projects.
	return url.pathname.replace(/\/$/, "") === "/projects/view" ? queryHint(url, "id") : undefined;
}

function matchesProject(project: ProjectSummary, hint: string): boolean {
	return project.id === hint || project.key === hint || project.slug === hint;
}

function selectedWorkspace(
	workspaces: readonly WorkspaceMembership[],
	hint: string | undefined,
): WorkspaceMembership | undefined {
	if (!hint) return undefined;
	const matches = workspaces.filter((workspace) => workspace.slug === hint);
	if (matches.length !== 1) throw new ScopeError(403, "Selected workspace is not accessible.");
	return matches[0];
}

/** Pure selection policy, independent of browser state and framework lifecycle. */
export function resolveScope(
	session: AuthSession,
	projects: readonly ProjectSummary[],
	url: URL,
	options: ScopeOptions = {},
): RequestScope {
	const workspaceHint = options.workspaceHint ?? queryHint(url, "workspace");
	const projectHint = options.projectHint ?? readProjectHint(url);
	const workspace = selectedWorkspace(session.workspaces, workspaceHint);
	const candidates = workspace
		? projects.filter((project) => project.workspace_id === workspace.id)
		: projects;
	let selection: ScopeSelection;
	if (projectHint || options.requireProject) {
		const matches = projectHint
			? candidates.filter((project) => matchesProject(project, projectHint))
			: candidates;
		if (projectHint && matches.length === 0) {
			throw new ScopeError(404, "Selected project is not accessible.");
		}
		if (matches.length === 1) {
			const project = matches[0];
			const membership = session.workspaces.find(
				(item) => item.id === project.workspace_id && item.slug === project.workspace_slug,
			);
			if (!membership) throw new ScopeError(403, "Selected project is not accessible.");
			selection = { kind: "project", workspace: membership, project };
		} else {
			selection = {
				kind: "selection-required",
				target: "project",
				reason: matches.length === 0 ? "empty" : "ambiguous",
			};
		}
	} else if (workspace) {
		selection = { kind: "workspace", workspace };
	} else if (options.requireWorkspace) {
		selection =
			session.workspaces.length === 1
				? { kind: "workspace", workspace: session.workspaces[0] }
				: {
						kind: "selection-required",
						target: "workspace",
						reason: session.workspaces.length === 0 ? "empty" : "ambiguous",
					};
	} else {
		selection = { kind: "global" };
	}
	return { user: session.user, workspaces: session.workspaces, projects, selection };
}

/**
 * Called by server Page loaders. Backend auth and membership stay authoritative.
 * The global catalog is never narrowed by a baked-in deployment workspace.
 */
export function loadRequestScope(
	api: RequestApi,
	url: URL,
	options: ScopeOptions,
	services: { readonly db: D1Database; readonly request: Request },
): Effect.Effect<RequestScope, ApiError | ScopeError> {
	return Effect.gen(function* () {
		yield* scopePolicy(() => requireBrowserDataRequest(services.request));
		const session = yield* api
			.execute(api.get("/auth/me"))
			.pipe(
				Effect.flatMap(HttpClientResponse.schemaBodyJson(AuthSessionSchema)),
				Effect.mapError(responseError),
				Effect.scoped,
			);
		yield* scopePolicy(() => requireAuthenticatedDataSession(session));
		const db = yield* Effect.try({ try: () => requireDataDatabase(services.db), catch: dataError });
		const loadCatalog = (includeArchived = false) =>
			listProjectSummaries(
				db,
				session.user.id,
				projectSummaryVisibility(session.user.id),
				includeArchived,
			).pipe(
				Effect.mapError(dataError),
				Effect.flatMap((rows) =>
					Effect.try({
						try: () =>
							decodeProjectCatalog(rows).filter((project) =>
								session.workspaces.some(
									(workspace) =>
										workspace.id === project.workspace_id &&
										workspace.slug === project.workspace_slug,
								),
							),
						catch: dataError,
					}),
				),
			);
		const projects = yield* loadCatalog();
		const { hint, workspace } = yield* scopePolicy(() => ({
			hint: options.projectHint ?? readProjectHint(url),
			workspace: selectedWorkspace(
				session.workspaces,
				options.workspaceHint ?? queryHint(url, "workspace"),
			),
		}));
		const hasActiveMatch = projects.some(
			(project) =>
				hint !== undefined &&
				matchesProject(project, hint) &&
				(!workspace || project.workspace_id === workspace.id),
		);
		// Archived deep links retry exactly once without widening ordinary catalogs.
		const catalog = hint && !hasActiveMatch ? yield* loadCatalog(true) : projects;
		return yield* scopePolicy(() => resolveScope(session, catalog, url, options));
	});
}

/** Keep expected selection failures typed without reclassifying programmer defects. */
function scopePolicy<T>(evaluate: () => T): Effect.Effect<T, ScopeError> {
	return Effect.try({
		try: evaluate,
		catch: (error) => {
			if (error instanceof ScopeError) return error;
			throw error;
		},
	});
}
