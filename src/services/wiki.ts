import { drizzle, schema } from "#db";
import { and, asc, desc, eq, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { queryEffect } from "./errors";

/** Validated filters. Authorization predicates are supplied by the calling app. */
export interface WikiScopeOptions {
	projectId?: string;
	includeWorkspacePages?: boolean;
	/** Trusted predicate against wikiPages.projectId. Include workspace pages in the app predicate. */
	visibility?: SQL;
}
export interface WikiListOptions extends WikiScopeOptions {
	parentId?: string;
	type?: string;
	status?: string;
	tags?: readonly string[];
	includeTemplates?: boolean;
}
export interface WikiPageOptions extends WikiScopeOptions {
	limit: number;
	offset: number;
}
export interface WikiSearchOptions extends Omit<WikiPageOptions, "visibility"> {
	updatedSince?: number;
	type?: string;
	status?: string;
	tags?: readonly string[];
	now: number;
	/** Trusted app-authored fragment using alias p. Never accept request SQL. */
	visibilitySql?: { sql: string; params: readonly unknown[] };
}

export interface WikiSearchResult {
	id: string;
	slug: string;
	title: string;
	project_id: string | null;
	type: string | null;
	tags: string[];
	status: string | null;
	verified_at: number | null;
	verified_by: string | null;
	owners: string[];
	verify_interval: number | null;
	excerpt: string;
	rank: number;
}

const summaryColumns = {
	id: schema.wikiPages.id,
	slug: schema.wikiPages.slug,
	title: schema.wikiPages.title,
	parent_id: schema.wikiPages.parentId,
	project_id: schema.wikiPages.projectId,
	updated_at: schema.wikiPages.updatedAt,
	type: schema.wikiPages.type,
	tags: schema.wikiPages.tags,
	status: schema.wikiPages.status,
	verified_at: schema.wikiPages.verifiedAt,
	verified_by: schema.wikiPages.verifiedBy,
	owners: schema.wikiPages.owners,
	verify_interval: schema.wikiPages.verifyInterval,
	is_template: schema.wikiPages.isTemplate,
};
const detailColumns = { ...summaryColumns, content: schema.wikiPages.content };

function scopeConditions(workspaceId: string, opts: WikiScopeOptions, trash = false) {
	const conditions = [
		eq(schema.wikiPages.workspaceId, workspaceId),
		trash ? isNotNull(schema.wikiPages.deletedAt) : isNull(schema.wikiPages.deletedAt),
	];
	if (opts.projectId) {
		const scope = opts.includeWorkspacePages
			? or(eq(schema.wikiPages.projectId, opts.projectId), isNull(schema.wikiPages.projectId))
			: eq(schema.wikiPages.projectId, opts.projectId);
		if (scope) conditions.push(scope);
	}
	if (opts.visibility) conditions.push(opts.visibility);
	return conditions;
}

export function listWikiPages(db: D1Database, workspaceId: string, opts: WikiListOptions = {}) {
	return queryEffect("listWikiPages", () => {
		const conditions = scopeConditions(workspaceId, opts);
		if (opts.parentId) conditions.push(eq(schema.wikiPages.parentId, opts.parentId));
		if (opts.type) conditions.push(eq(schema.wikiPages.type, opts.type));
		if (opts.status) conditions.push(eq(schema.wikiPages.status, opts.status));
		if (opts.tags?.length)
			conditions.push(
				sql`EXISTS (SELECT 1 FROM json_each(${schema.wikiPages.tags}) WHERE value IN (${sql.join(
					opts.tags.map((tag) => sql`${tag}`),
					sql`, `,
				)}))`,
			);
		if (!opts.includeTemplates) conditions.push(eq(schema.wikiPages.isTemplate, false));
		return drizzle(db, { schema })
			.select(summaryColumns)
			.from(schema.wikiPages)
			.where(and(...conditions))
			.orderBy(asc(schema.wikiPages.title));
	});
}

export function listWikiTreeRows(db: D1Database, workspaceId: string, opts: WikiScopeOptions = {}) {
	return queryEffect("listWikiTreeRows", () =>
		drizzle(db, { schema })
			.select({
				id: schema.wikiPages.id,
				slug: schema.wikiPages.slug,
				title: schema.wikiPages.title,
				parentId: schema.wikiPages.parentId,
				projectId: schema.wikiPages.projectId,
				type: schema.wikiPages.type,
			})
			.from(schema.wikiPages)
			.where(and(...scopeConditions(workspaceId, opts)))
			.orderBy(asc(schema.wikiPages.title)),
	);
}

/** Live id wins over a colliding slug, then single-hop historical-slug fallback. */
export function findWikiPage(db: D1Database, workspaceId: string, idOrSlug: string) {
	return queryEffect("findWikiPage", async () => {
		const orm = drizzle(db, { schema });
		const direct = await orm
			.select(detailColumns)
			.from(schema.wikiPages)
			.where(
				and(
					or(eq(schema.wikiPages.id, idOrSlug), eq(schema.wikiPages.slug, idOrSlug)),
					eq(schema.wikiPages.workspaceId, workspaceId),
					isNull(schema.wikiPages.deletedAt),
				),
			)
			.orderBy(sql`CASE WHEN ${schema.wikiPages.id} = ${idOrSlug} THEN 0 ELSE 1 END`)
			.get();
		if (direct) return direct;
		const redirect = await orm
			.select({ pageId: schema.wikiRedirects.pageId })
			.from(schema.wikiRedirects)
			.where(
				and(
					eq(schema.wikiRedirects.workspaceId, workspaceId),
					eq(schema.wikiRedirects.oldSlug, idOrSlug),
				),
			)
			.get();
		if (!redirect) return undefined;
		// Existing detail contracts include version only on historical-slug fallback.
		return orm
			.select({ ...detailColumns, version: schema.wikiPages.version })
			.from(schema.wikiPages)
			.where(
				and(
					eq(schema.wikiPages.id, redirect.pageId),
					eq(schema.wikiPages.workspaceId, workspaceId),
					isNull(schema.wikiPages.deletedAt),
				),
			)
			.get();
	});
}

export function listWikiTemplates(
	db: D1Database,
	workspaceId: string,
	opts: WikiScopeOptions = {},
) {
	return queryEffect("listWikiTemplates", () =>
		drizzle(db, { schema })
			.select({
				id: schema.wikiPages.id,
				slug: schema.wikiPages.slug,
				title: schema.wikiPages.title,
				project_id: schema.wikiPages.projectId,
				type: schema.wikiPages.type,
			})
			.from(schema.wikiPages)
			.where(and(...scopeConditions(workspaceId, opts), eq(schema.wikiPages.isTemplate, true)))
			.orderBy(asc(schema.wikiPages.title)),
	);
}

export function listWikiTrash(db: D1Database, workspaceId: string, opts: WikiPageOptions) {
	return queryEffect("listWikiTrash", () =>
		drizzle(db, { schema })
			.select({
				id: schema.wikiPages.id,
				slug: schema.wikiPages.slug,
				title: schema.wikiPages.title,
				parent_id: schema.wikiPages.parentId,
				project_id: schema.wikiPages.projectId,
				deleted_at: schema.wikiPages.deletedAt,
			})
			.from(schema.wikiPages)
			.where(and(...scopeConditions(workspaceId, opts, true)))
			.orderBy(desc(schema.wikiPages.deletedAt))
			.limit(opts.limit)
			.offset(opts.offset),
	);
}

export function listStaleWikiPages(
	db: D1Database,
	workspaceId: string,
	opts: WikiPageOptions & { now: number },
) {
	return queryEffect("listStaleWikiPages", () =>
		drizzle(db, { schema })
			.select({
				id: schema.wikiPages.id,
				slug: schema.wikiPages.slug,
				title: schema.wikiPages.title,
				project_id: schema.wikiPages.projectId,
				status: schema.wikiPages.status,
				verified_at: schema.wikiPages.verifiedAt,
				verified_by: schema.wikiPages.verifiedBy,
				verify_interval: schema.wikiPages.verifyInterval,
				updated_at: schema.wikiPages.updatedAt,
			})
			.from(schema.wikiPages)
			.where(
				and(
					...scopeConditions(workspaceId, opts),
					eq(schema.wikiPages.isTemplate, false),
					sql`(
		${schema.wikiPages.status} IN ('stale', 'deprecated') OR (${schema.wikiPages.verifyInterval} IS NOT NULL AND
		(${schema.wikiPages.verifiedAt} IS NULL OR (${schema.wikiPages.verifiedAt} + ${schema.wikiPages.verifyInterval} * 86400) <= ${opts.now})))`,
				),
			)
			.orderBy(asc(schema.wikiPages.updatedAt))
			.limit(opts.limit)
			.offset(opts.offset),
	);
}

const revisionColumns = {
	id: schema.wikiRevisions.id,
	title: schema.wikiRevisions.title,
	summary: schema.wikiRevisions.summary,
	author_id: schema.wikiRevisions.authorId,
	created_at: schema.wikiRevisions.createdAt,
};
function revisionScope(workspaceId: string, pageId: string) {
	return and(
		eq(schema.wikiRevisions.pageId, pageId),
		sql`EXISTS (SELECT 1 FROM wiki_pages WHERE wiki_pages.id = ${schema.wikiRevisions.pageId} AND wiki_pages.workspace_id = ${workspaceId})`,
	);
}
export function listWikiRevisions(db: D1Database, workspaceId: string, pageId: string) {
	return queryEffect("listWikiRevisions", () =>
		drizzle(db, { schema })
			.select({ ...revisionColumns, author_name: schema.users.name })
			.from(schema.wikiRevisions)
			.leftJoin(schema.users, eq(schema.wikiRevisions.authorId, schema.users.id))
			.where(revisionScope(workspaceId, pageId))
			.orderBy(desc(schema.wikiRevisions.createdAt), desc(sql`wiki_revisions.rowid`)),
	);
}
export function getWikiRevision(
	db: D1Database,
	workspaceId: string,
	pageId: string,
	revisionId: string,
) {
	return queryEffect("getWikiRevision", () =>
		drizzle(db, { schema })
			.select({ ...revisionColumns, content: schema.wikiRevisions.content })
			.from(schema.wikiRevisions)
			.where(and(revisionScope(workspaceId, pageId), eq(schema.wikiRevisions.id, revisionId)))
			.get(),
	);
}
export function getLatestWikiRevisionId(db: D1Database, workspaceId: string, pageId: string) {
	return queryEffect("getLatestWikiRevisionId", async () => {
		const row = await drizzle(db, { schema })
			.select({ id: schema.wikiRevisions.id })
			.from(schema.wikiRevisions)
			.where(revisionScope(workspaceId, pageId))
			.orderBy(desc(schema.wikiRevisions.createdAt), desc(sql`wiki_revisions.rowid`))
			.get();
		return row?.id ?? null;
	});
}

function decodeJsonArrayColumn(value: unknown): string[] {
	if (Array.isArray(value)) return value as string[];
	if (typeof value !== "string") return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
/** FTS sanitization and permission decisions belong to the app. */
export function searchWiki(
	db: D1Database,
	workspaceId: string,
	ftsQuery: string,
	opts: WikiSearchOptions,
) {
	return queryEffect("searchWiki", async () => {
		if (!ftsQuery) return [];
		let q = `SELECT p.id, p.slug, p.title, p.project_id, p.type, p.tags, p.status, p.verified_at, p.verified_by, p.owners, p.verify_interval,
		 snippet(wiki_fts, -1, '**', '**', '…', 24) as excerpt, bm25(wiki_fts, 0, 0, 10.0, 1.0, 5.0) as rank
		 FROM wiki_fts JOIN wiki_pages p ON p.id = wiki_fts.page_id
		 WHERE wiki_fts MATCH ? AND wiki_fts.workspace_id = ? AND p.workspace_id = ? AND p.is_template = 0 AND p.deleted_at IS NULL`;
		const params: unknown[] = [ftsQuery, workspaceId, workspaceId];
		if (opts.projectId) {
			q += opts.includeWorkspacePages
				? " AND (p.project_id = ? OR p.project_id IS NULL)"
				: " AND p.project_id = ?";
			params.push(opts.projectId);
		}
		if (opts.visibilitySql) {
			q += ` AND (${opts.visibilitySql.sql})`;
			params.push(...opts.visibilitySql.params);
		}
		if (opts.updatedSince !== undefined) {
			q += " AND p.updated_at >= ?";
			params.push(opts.updatedSince);
		}
		if (opts.type) {
			q += " AND p.type = ?";
			params.push(opts.type);
		}
		if (opts.status) {
			q += " AND p.status = ?";
			params.push(opts.status);
		}
		if (opts.tags?.length) {
			q += ` AND EXISTS (SELECT 1 FROM json_each(p.tags) WHERE value IN (${opts.tags.map(() => "?").join(",")}))`;
			params.push(...opts.tags);
		}
		q += ` ORDER BY (CASE WHEN (p.status IN ('stale', 'deprecated') OR (p.verify_interval IS NOT NULL AND p.verified_at IS NOT NULL AND (p.verified_at + p.verify_interval * 86400) <= ?)) THEN 1 ELSE 0 END), bm25(wiki_fts, 0, 0, 10.0, 1.0, 5.0), p.id LIMIT ? OFFSET ?`;
		params.push(opts.now, opts.limit, opts.offset);
		const { results } = await db
			.prepare(q)
			.bind(...params)
			.all<Omit<WikiSearchResult, "tags" | "owners"> & { tags: unknown; owners: unknown }>();
		return results.map((row) => ({
			...row,
			tags: decodeJsonArrayColumn(row.tags),
			owners: decodeJsonArrayColumn(row.owners),
		}));
	});
}

export function getWikiDraft(db: D1Database, workspaceId: string, pageId: string, userId: string) {
	return queryEffect("getWikiDraft", async () => {
		const row = await drizzle(db, { schema })
			.select({
				title: schema.wikiDrafts.title,
				content: schema.wikiDrafts.content,
				baseRevisionId: schema.wikiDrafts.baseRevisionId,
				updatedAt: schema.wikiDrafts.updatedAt,
			})
			.from(schema.wikiDrafts)
			.where(
				and(
					eq(schema.wikiDrafts.workspaceId, workspaceId),
					eq(schema.wikiDrafts.pageId, pageId),
					eq(schema.wikiDrafts.userId, userId),
				),
			)
			.get();
		return row ?? null;
	});
}

// Bounded LCS preserves the existing wiki conflict/revision diff contract.
const MAX_DIFF_CELLS = 1_000_000;
type DiffOp = { type: "equal" | "add" | "remove"; line: string };

function buildLcsTable(oldLines: readonly string[], newLines: readonly string[]): number[][] {
	const n = oldLines.length;
	const m = newLines.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] =
				oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	return dp;
}

function traceLcsDiffOps(
	oldLines: readonly string[],
	newLines: readonly string[],
	dp: readonly number[][],
): DiffOp[] {
	const n = oldLines.length;
	const m = newLines.length;
	const ops: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (oldLines[i] === newLines[j]) {
			ops.push({ type: "equal", line: oldLines[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			ops.push({ type: "remove", line: oldLines[i] });
			i++;
		} else {
			ops.push({ type: "add", line: newLines[j] });
			j++;
		}
	}
	while (i < n) {
		ops.push({ type: "remove", line: oldLines[i] });
		i++;
	}
	while (j < m) {
		ops.push({ type: "add", line: newLines[j] });
		j++;
	}
	return ops;
}

function computeLineDiff(oldLines: readonly string[], newLines: readonly string[]): DiffOp[] {
	if (oldLines.length * newLines.length > MAX_DIFF_CELLS) {
		return [
			...oldLines.map((line): DiffOp => ({ type: "remove", line })),
			...newLines.map((line): DiffOp => ({ type: "add", line })),
		];
	}
	return traceLcsDiffOps(oldLines, newLines, buildLcsTable(oldLines, newLines));
}

export function buildUnifiedDiff(baseContent: string, currentContent: string): string {
	if (baseContent === currentContent) return "";
	const ops = computeLineDiff(baseContent.split("\n"), currentContent.split("\n"));
	const CONTEXT = 3;
	const changeIdxs = ops.reduce<number[]>((acc, op, idx) => {
		if (op.type !== "equal") acc.push(idx);
		return acc;
	}, []);
	if (changeIdxs.length === 0) return "";
	const groups: Array<[number, number]> = [];
	let groupStart = changeIdxs[0];
	let groupEnd = changeIdxs[0];
	for (const idx of changeIdxs.slice(1)) {
		if (idx - groupEnd <= CONTEXT * 2) {
			groupEnd = idx;
		} else {
			groups.push([groupStart, groupEnd]);
			groupStart = idx;
			groupEnd = idx;
		}
	}
	groups.push([groupStart, groupEnd]);
	const hunks: string[] = [];
	for (const [gStart, gEnd] of groups) {
		const sliceStart = Math.max(0, gStart - CONTEXT);
		const sliceEnd = Math.min(ops.length - 1, gEnd + CONTEXT);
		const slice = ops.slice(sliceStart, sliceEnd + 1);
		let oldStart = 1;
		let newStart = 1;
		for (let k = 0; k < sliceStart; k++) {
			if (ops[k].type !== "add") oldStart++;
			if (ops[k].type !== "remove") newStart++;
		}
		const oldCount = slice.filter((op) => op.type !== "add").length;
		const newCount = slice.filter((op) => op.type !== "remove").length;
		const lines = slice.map(
			(op) => `${op.type === "add" ? "+" : op.type === "remove" ? "-" : " "}${op.line}`,
		);
		hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${lines.join("\n")}`);
	}
	return `--- base\n+++ current\n${hunks.join("\n")}`;
}
