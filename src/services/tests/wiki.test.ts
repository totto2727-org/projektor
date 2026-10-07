import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { schema } from "#db";
import { eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { migratedDb } from "#db/test/helpers";
import { DataQueryError } from "../errors";
import * as wiki from "../wiki";
import * as apiWiki from "../../api/services/wiki";
import type { ServiceCtx } from "../../api/services/types";

function readDatabase(sqlite: DatabaseSync): D1Database {
	function prepare(query: string, bindings: SQLInputValue[] = []) {
		return {
			bind: (...values: SQLInputValue[]) => prepare(query, values),
			all: async () => ({ results: sqlite.prepare(query).all(...bindings) }),
			raw: async () =>
				sqlite
					.prepare(query)
					.all(...bindings)
					.map((row) => Object.values(row)),
			first: async () => sqlite.prepare(query).get(...bindings) ?? null,
		};
	}
	return { prepare } as unknown as D1Database;
}

function wikiReadFixture() {
	const sqlite = migratedDb();
	sqlite.exec(`
	 INSERT INTO workspaces(id,name,slug,created_at) VALUES ('wa','A','alpha',1),('wb','B','beta',1);
	 INSERT INTO users(id,email,name,created_at) VALUES ('u','u@example.com','User',1),('v','v@example.com','Other',1);
	 INSERT INTO projects(id,workspace_id,name,key,created_at,updated_at) VALUES ('pa','wa','Project','PA',1,1),('pb','wb','Foreign','PB',1,1);
	 INSERT INTO wiki_pages(id,workspace_id,slug,title,content,created_by_id,updated_by_id,created_at,updated_at,tags,owners,type,status,verify_interval,project_id,is_template,deleted_at,parent_id) VALUES
	 ('root','wa','root','Alpha','Root content','u','u',1,10,'["ops"]','["u"]','runbook',NULL,NULL,NULL,0,NULL,NULL),
	 ('child','wa','child','Beta','Child content','u','u',1,20,'["ops","dev"]','[]','guide',NULL,1,'pa',0,NULL,'root'),
	 ('template','wa','template','Template','Template content','u','u',1,30,'[]','[]','runbook',NULL,NULL,NULL,1,NULL,NULL),
	 ('trash','wa','trash','Trash','Trash content','u','u',1,40,'[]','[]',NULL,'stale',NULL,NULL,0,50,NULL),
	 ('foreign','wb','foreign','Foreign','Foreign content','u','u',1,50,'[]','[]',NULL,NULL,NULL,'pb',0,NULL,NULL);
	 INSERT INTO wiki_redirects(id,workspace_id,old_slug,page_id,created_at) VALUES ('redirect','wa','old-root','root',1),('bad','wa','cross-tenant','foreign',1);
	 INSERT INTO wiki_revisions(id,page_id,content,author_id,created_at,title,summary) VALUES
	 ('r1','root','Before','u',100,'Old','first'),('r2','root','After','u',100,'New','second'),('rf','foreign','Secret','u',100,'Hidden','foreign');
	 INSERT INTO wiki_drafts(id,workspace_id,page_id,user_id,title,content,updated_at) VALUES ('d','wa','root','u','Draft','Draft text',90);
	`);
	return { sqlite, db: readDatabase(sqlite) };
}

describe("pure wiki reads", () => {
	let sqlite: DatabaseSync;
	let db: D1Database;
	beforeEach(() => ({ sqlite, db } = wikiReadFixture()));
	afterEach(() => sqlite.close());

	it("preserves list metadata projection, JSON decoding, filters and template exclusion", async () => {
		const rows = await Effect.runPromise(wiki.listWikiPages(db, "wa"));
		expect(rows.map((r) => r.id)).toEqual(["root", "child"]);
		expect(rows[0]).toEqual({
			id: "root",
			slug: "root",
			title: "Alpha",
			parent_id: null,
			project_id: null,
			updated_at: 10,
			type: "runbook",
			tags: ["ops"],
			status: null,
			verified_at: null,
			verified_by: null,
			owners: ["u"],
			verify_interval: null,
			is_template: false,
		});
		expect(
			await Effect.runPromise(
				wiki.listWikiPages(db, "wa", { type: "guide", tags: ["dev"], parentId: "root" }),
			),
		).toHaveLength(1);
		expect(await Effect.runPromise(wiki.listWikiPages(db, "wa", { tags: ["none"] }))).toEqual([]);
		expect(
			await Effect.runPromise(wiki.listWikiPages(db, "wa", { includeTemplates: true })),
		).toHaveLength(3);
	});

	it("accepts app-authorized visibility and includes workspace pages only when requested", async () => {
		const visibility = or(
			isNull(schema.wikiPages.projectId),
			eq(schema.wikiPages.projectId, "other"),
		);
		expect(
			(await Effect.runPromise(wiki.listWikiPages(db, "wa", { visibility }))).map((r) => r.id),
		).toEqual(["root"]);
		expect(
			(
				await Effect.runPromise(
					wiki.listWikiTreeRows(db, "wa", { projectId: "pa", includeWorkspacePages: true }),
				)
			).map((r) => r.id),
		).toEqual(["root", "child", "template"]);
		expect(
			(await Effect.runPromise(wiki.listWikiTreeRows(db, "wa", { projectId: "pa" }))).map(
				(r) => r.id,
			),
		).toEqual(["child"]);
	});

	it("resolves id before colliding slug and live pages before redirects, excludes trash and foreign targets", async () => {
		expect((await Effect.runPromise(wiki.findWikiPage(db, "wa", "old-root")))?.content).toBe(
			"Root content",
		);
		expect(await Effect.runPromise(wiki.findWikiPage(db, "wa", "cross-tenant"))).toBeUndefined();
		expect(await Effect.runPromise(wiki.findWikiPage(db, "wa", "trash"))).toBeUndefined();
		expect(await Effect.runPromise(wiki.findWikiPage(db, "wa", "foreign"))).toBeUndefined();
		sqlite.exec(
			"UPDATE wiki_pages SET slug='new-root' WHERE id='root'; UPDATE wiki_pages SET slug='root' WHERE id='child';",
		);
		expect((await Effect.runPromise(wiki.findWikiPage(db, "wa", "root")))?.id).toBe("root");
		sqlite.exec("UPDATE wiki_pages SET slug='old-root' WHERE id='child';");
		expect((await Effect.runPromise(wiki.findWikiPage(db, "wa", "old-root")))?.id).toBe("child");
	});

	it("preserves maintenance/trash/template filtering and pagination without presentation fields", async () => {
		expect(
			(
				await Effect.runPromise(
					wiki.listStaleWikiPages(db, "wa", { now: 100, limit: 10, offset: 0 }),
				)
			).map((r) => r.id),
		).toEqual(["child"]);
		expect((await Effect.runPromise(wiki.listWikiTemplates(db, "wa"))).map((r) => r.id)).toEqual([
			"template",
		]);
		const trash = await Effect.runPromise(wiki.listWikiTrash(db, "wa", { limit: 10, offset: 0 }));
		expect(trash).toEqual([
			{
				id: "trash",
				slug: "trash",
				title: "Trash",
				parent_id: null,
				project_id: null,
				deleted_at: 50,
			},
		]);
		expect(await Effect.runPromise(wiki.listWikiTrash(db, "wa", { limit: 10, offset: 1 }))).toEqual(
			[],
		);
	});

	it("orders same-second revisions by rowid and scopes every revision query to the workspace/page", async () => {
		expect(
			(await Effect.runPromise(wiki.listWikiRevisions(db, "wa", "root"))).map((r) => r.id),
		).toEqual(["r2", "r1"]);
		expect(await Effect.runPromise(wiki.getLatestWikiRevisionId(db, "wa", "root"))).toBe("r2");
		expect(await Effect.runPromise(wiki.getWikiRevision(db, "wa", "root", "r1"))).toEqual({
			id: "r1",
			title: "Old",
			summary: "first",
			author_id: "u",
			created_at: 100,
			content: "Before",
		});
		expect(await Effect.runPromise(wiki.listWikiRevisions(db, "wa", "foreign"))).toEqual([]);
		expect(
			await Effect.runPromise(wiki.getWikiRevision(db, "wa", "foreign", "rf")),
		).toBeUndefined();
		expect(await Effect.runPromise(wiki.getLatestWikiRevisionId(db, "wa", "foreign"))).toBeNull();
	});

	it("isolates drafts by workspace, user and page", async () => {
		expect(await Effect.runPromise(wiki.getWikiDraft(db, "wa", "root", "u"))).toEqual({
			title: "Draft",
			content: "Draft text",
			baseRevisionId: null,
			updatedAt: 90,
		});
		expect(await Effect.runPromise(wiki.getWikiDraft(db, "wa", "root", "v"))).toBeNull();
		expect(await Effect.runPromise(wiki.getWikiDraft(db, "wb", "root", "u"))).toBeNull();
	});

	it("keeps FTS weighting, stable paging, JSON mapping, templates/trash exclusion and permission fragments", async () => {
		sqlite.exec(
			"CREATE VIRTUAL TABLE wiki_fts USING fts5(page_id UNINDEXED, workspace_id UNINDEXED, title, content, tags); INSERT INTO wiki_fts(page_id,workspace_id,title,content,tags) SELECT id,workspace_id,title,'needle',tags FROM wiki_pages;",
		);
		const opts = { now: 100, limit: 10, offset: 0 };
		const rows = await Effect.runPromise(wiki.searchWiki(db, "wa", "needle*", opts));
		expect(rows.map((r) => r.id).sort()).toEqual(["child", "root"]);
		expect(rows.find((r) => r.id === "root")?.owners).toEqual(["u"]);
		const restricted = await Effect.runPromise(
			wiki.searchWiki(db, "wa", "needle*", {
				...opts,
				visibilitySql: { sql: "p.project_id IS NULL", params: [] },
			}),
		);
		expect(restricted.map((r) => r.id)).toEqual(["root"]);
		expect(
			await Effect.runPromise(wiki.searchWiki(db, "wa", "needle*", { ...opts, tags: ["none"] })),
		).toEqual([]);
		const one = await Effect.runPromise(
			wiki.searchWiki(db, "wa", "needle*", { ...opts, limit: 1 }),
		);
		const two = await Effect.runPromise(
			wiki.searchWiki(db, "wa", "needle*", { ...opts, limit: 1, offset: 1 }),
		);
		expect([one[0].id, two[0].id]).toEqual(rows.map((r) => r.id));
	});

	it("is lazy and reports database failures as typed DataQueryError", async () => {
		const broken = {
			prepare: () => {
				throw new Error("database unavailable");
			},
		} as unknown as D1Database;
		const query = wiki.listWikiPages(broken, "wa");
		await expect(Effect.runPromise(query)).rejects.toBeInstanceOf(DataQueryError);
	});

	it("keeps API list, template, trash and tree contracts while sharing the DB read", async () => {
		const ctx = { db, workspaceId: "wa", userId: "u", role: "owner" } as ServiceCtx;
		const rows = await Effect.runPromise(wiki.listWikiPages(db, "wa"));
		expect(await apiWiki.listWikiPages(ctx, {})).toEqual(
			rows.map((r) => ({ ...r, url: `/wiki/${r.slug}` })),
		);
		expect(await apiWiki.listWikiTemplates(ctx, {})).toEqual([
			{
				id: "template",
				slug: "template",
				title: "Template",
				project_id: null,
				type: "runbook",
				url: "/wiki/template",
			},
		]);
		expect(await apiWiki.listWikiTrash(ctx, {})).toEqual([
			{
				id: "trash",
				slug: "trash",
				title: "Trash",
				parent_id: null,
				project_id: null,
				deleted_at: 50,
				purgeAfter: 50 + apiWiki.WIKI_TRASH_RETENTION_SECONDS,
			},
		]);
		expect(await apiWiki.getWikiTree(ctx)).toEqual([
			{
				id: "root",
				slug: "root",
				title: "Alpha",
				url: "/wiki/root",
				type: "runbook",
				children: [
					{
						id: "child",
						slug: "child",
						title: "Beta",
						url: "/wiki/child",
						type: "guide",
						children: [],
					},
				],
			},
			{
				id: "template",
				slug: "template",
				title: "Template",
				url: "/wiki/template",
				type: "runbook",
				children: [],
			},
		]);
	});

	it("preserves detail redirect extras, revision contracts and API not-found errors", async () => {
		const ctx = { db, workspaceId: "wa", userId: "u", role: "owner" } as ServiceCtx;
		const detail = await Effect.runPromise(wiki.findWikiPage(db, "wa", "root"));
		expect(await apiWiki.getWikiPage(ctx, "root")).toEqual({
			...detail,
			revisionId: "r2",
			url: "/wiki/root",
			freshness: null,
		});
		expect(await apiWiki.getWikiPage(ctx, "old-root")).toHaveProperty("version", 0);
		expect(await apiWiki.listWikiRevisions(ctx, "old-root")).toEqual(
			await Effect.runPromise(wiki.listWikiRevisions(db, "wa", "root")),
		);
		expect(await apiWiki.getWikiRevision(ctx, "old-root", "r1")).toEqual(
			await Effect.runPromise(wiki.getWikiRevision(db, "wa", "root", "r1")),
		);
		await expect(apiWiki.getWikiPage(ctx, "foreign")).rejects.toMatchObject({
			message: "Wiki page not found",
		});
		await expect(apiWiki.getWikiRevision(ctx, "root", "rf")).rejects.toMatchObject({
			message: "Revision not found",
		});
		expect(await apiWiki.getWikiRevisionDiff(ctx, "root", "r1", { against: "r2" })).toEqual({
			from: "r1",
			to: "r2",
			diff: "--- base\n+++ current\n@@ -1,1 +1,1 @@\n-Before\n+After",
		});
	});

	it("leaves validation, project authorization and search freshness in the API", async () => {
		const ctx = { db, workspaceId: "wa", userId: "u", role: "viewer" } as ServiceCtx;
		expect((await apiWiki.listWikiPages(ctx, {})).map((r) => r.id)).toEqual(["root"]);
		await expect(apiWiki.getWikiPage(ctx, "child")).rejects.toMatchObject({
			message: "Wiki page not found",
		});
		await expect(apiWiki.listWikiPages(ctx, { projectId: "not-a-uuid" })).rejects.toMatchObject({
			kind: "validation",
		});
		sqlite.exec(
			"CREATE VIRTUAL TABLE wiki_fts USING fts5(page_id UNINDEXED, workspace_id UNINDEXED, title, content, tags); INSERT INTO wiki_fts(page_id,workspace_id,title,content,tags) SELECT id,workspace_id,title,'needle',tags FROM wiki_pages;",
		);
		expect(await apiWiki.searchWiki(ctx, { query: "needle" })).toEqual([
			expect.objectContaining({ id: "root", tags: ["ops"], owners: ["u"], freshness: null }),
		]);
		expect(await apiWiki.listStaleWikiPages(ctx, {})).toEqual([]);
	});

	it("keeps bounded unified diff behavior for unchanged content, contextual hunks and huge pages", () => {
		expect(apiWiki.buildUnifiedDiff).toBe(wiki.buildUnifiedDiff);
		expect(wiki.buildUnifiedDiff("same", "same")).toBe("");
		expect(wiki.buildUnifiedDiff("one\ntwo\nthree", "one\nnew\nthree")).toBe(
			"--- base\n+++ current\n@@ -1,3 +1,3 @@\n one\n-two\n+new\n three",
		);
		const huge = Array.from({ length: 1001 }, () => "old").join("\n");
		expect(wiki.buildUnifiedDiff(huge, huge.replaceAll("old", "new"))).toContain(
			"@@ -1,1001 +1,1001 @@",
		);
	});
});
