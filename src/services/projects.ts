import { drizzle, schema } from "#db";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Effect } from "effect";
import { type DataQueryError, queryEffect } from "./errors";
import type {
	Project,
	ProjectListOptions,
	ProjectSummary,
	ProjectSummaryVisibility,
} from "./types";
export type {
	Project,
	ProjectListOptions,
	ProjectSummary,
	ProjectSummaryVisibility,
} from "./types";

export function listProjects(
	db: D1Database,
	workspaceId: string,
	opts: ProjectListOptions = {},
): Effect.Effect<Project[], DataQueryError> {
	return queryEffect("listProjects", () => {
		const orm = drizzle(db, { schema });
		const conditions = [eq(schema.projects.workspaceId, workspaceId)];
		if (opts.visibility) conditions.push(opts.visibility);
		if (!opts.includeArchived) conditions.push(isNull(schema.projects.archivedAt));
		return orm
			.select()
			.from(schema.projects)
			.where(and(...conditions))
			.orderBy(asc(schema.projects.name));
	});
}

export function findProjectById(
	db: D1Database,
	workspaceId: string,
	id: string,
): Effect.Effect<Project | undefined, DataQueryError> {
	return queryEffect("findProjectById", () =>
		drizzle(db, { schema })
			.select()
			.from(schema.projects)
			.where(and(eq(schema.projects.id, id), eq(schema.projects.workspaceId, workspaceId)))
			.get(),
	);
}

export function findProjectBySlug(
	db: D1Database,
	workspaceId: string,
	slug: string,
): Effect.Effect<Project | undefined, DataQueryError> {
	return queryEffect("findProjectBySlug", () =>
		drizzle(db, { schema })
			.select()
			.from(schema.projects)
			.where(and(eq(schema.projects.slug, slug), eq(schema.projects.workspaceId, workspaceId)))
			.get(),
	);
}

export function findProjectIdByKey(
	db: D1Database,
	workspaceId: string,
	key: string,
): Effect.Effect<{ id: string } | undefined, DataQueryError> {
	return queryEffect("findProjectIdByKey", () =>
		drizzle(db, { schema })
			.select({ id: schema.projects.id })
			.from(schema.projects)
			.where(and(eq(schema.projects.key, key), eq(schema.projects.workspaceId, workspaceId)))
			.get(),
	);
}

export function listProjectSummaries(
	db: D1Database,
	userId: string,
	visibility: ProjectSummaryVisibility,
	includeArchived = false,
): Effect.Effect<ProjectSummary[], DataQueryError> {
	return queryEffect("listProjectSummaries", async () => {
		const rows = await db
			.prepare(`SELECT
        p.id,
        p.name,
        p.key,
        p.slug,
        p.description,
        p.archived_at,
        p.created_at,
        p.updated_at,
        w.id   AS workspace_id,
        w.name AS workspace_name,
        w.slug AS workspace_slug,
        COUNT(CASE WHEN COALESCE(NULLIF(i.status_category, ''), i.status) NOT IN ('done','cancelled') THEN 1 END)
          AS open_issue_count,
        COUNT(CASE WHEN COALESCE(NULLIF(i.status_category, ''), i.status) NOT IN ('done','cancelled')
                     AND i.status = 'backlog' THEN 1 END)
          AS backlog_issue_count
      FROM projects p
      JOIN workspaces w         ON w.id  = p.workspace_id
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ?
      LEFT JOIN issues i        ON i.project_id = p.id
      WHERE (${visibility.sql})
        ${includeArchived ? "" : "AND p.archived_at IS NULL"}
      GROUP BY p.id, p.name, p.key, p.slug, p.description, p.archived_at, p.created_at, p.updated_at,
               w.id, w.name, w.slug
      ORDER BY w.slug, p.name`)
			.bind(userId, ...visibility.bindings)
			.all<ProjectSummary>();
		return rows.results;
	});
}
