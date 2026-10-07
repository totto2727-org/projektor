import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { schema } from "#db";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { migratedDb } from "#db/test/helpers";
import {
	DataQueryError,
	findProjectById,
	findProjectBySlug,
	findProjectIdByKey,
	findWorkspaceBySlug,
	findWorkspaceMembership,
	listProjects,
	listProjectSummaries,
	listWorkspaceMembers,
	listWorkspaces,
	listWorkspaceTokenMetadata,
	readWorkspaceBrand,
} from "../index";

/** Read-only D1 transport over the real migrated schema. Not a Worker emulator. */
function readDatabase(sqlite: DatabaseSync): D1Database {
	function prepare(sql: string, bindings: SQLInputValue[] = []) {
		return {
			bind: (...values: SQLInputValue[]) => prepare(sql, values),
			all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }),
			raw: async () => {
				const statement = sqlite.prepare(sql);
				statement.setReturnArrays(true);
				return statement.all(...bindings);
			},
		};
	}
	return { prepare } as unknown as D1Database;
}

describe("project/workspace pure queries", () => {
	let sqlite: DatabaseSync;
	let db: D1Database;

	beforeEach(() => {
		sqlite = migratedDb();
		db = readDatabase(sqlite);
		sqlite.exec(`
			INSERT INTO workspaces (id,name,slug,created_at,brand) VALUES
			 ('wa','Alpha workspace','alpha',10,'{"accent":"#abcdef","logoR2Key":"wa/brand-logo/x"}'),
			 ('wb','Beta workspace','beta',20,'{}');
			INSERT INTO users (id,email,name,created_at) VALUES
			 ('u1','one@example.com','One',1),('u2','two@example.com','Two',2);
			INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES
			 ('wa','u1','owner',20),('wa','u2','viewer',10),('wb','u2','member',30);
			INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at,archived_at) VALUES
			 ('p1','wa','Zeta','SAME','same',100,101,NULL),
			 ('p2','wa','Alpha','ARCH','archive',110,111,120),
			 ('p3','wa','Beta','BETA','beta',112,113,NULL),
			 ('p4','wb','Other tenant','SAME','same',200,201,NULL);
		`);
	});

	afterEach(() => sqlite.close());

	it("retains camelCase project rows, ordering, archive opt-in and app-supplied visibility", async () => {
		const projects = await Effect.runPromise(listProjects(db, "wa"));
		expect(projects.map((project) => project.id)).toEqual(["p3", "p1"]);
		expect(projects[1]).toEqual({
			id: "p1",
			workspaceId: "wa",
			name: "Zeta",
			key: "SAME",
			description: null,
			createdAt: 100,
			updatedAt: 101,
			agentWipLimit: null,
			slug: "same",
			archivedAt: null,
		});
		expect(
			(await Effect.runPromise(listProjects(db, "wa", { includeArchived: true }))).map((p) => p.id),
		).toEqual(["p2", "p3", "p1"]);
		expect(
			(
				await Effect.runPromise(
					listProjects(db, "wa", {
						visibility: eq(schema.projects.id, "p1"),
					}),
				)
			).map((p) => p.id),
		).toEqual(["p1"]);
	});

	it("scopes id, slug and key lookups to the explicit workspace and retains missing results", async () => {
		expect(await Effect.runPromise(findProjectById(db, "wa", "p4"))).toBeUndefined();
		expect(await Effect.runPromise(findProjectById(db, "wa", "p1"))).toMatchObject({ id: "p1" });
		expect(await Effect.runPromise(findProjectBySlug(db, "wa", "same"))).toMatchObject({
			id: "p1",
		});
		expect(await Effect.runPromise(findProjectBySlug(db, "wb", "same"))).toMatchObject({
			id: "p4",
		});
		expect(await Effect.runPromise(findProjectIdByKey(db, "wa", "SAME"))).toEqual({ id: "p1" });
		expect(await Effect.runPromise(findProjectIdByKey(db, "wb", "SAME"))).toEqual({ id: "p4" });
		expect(await Effect.runPromise(findProjectIdByKey(db, "wa", "MISSING"))).toBeUndefined();
	});

	it("retains summary column names, membership join, archive filtering and custom status counts", async () => {
		const insert = sqlite.prepare(`INSERT INTO issues
			(id,workspace_id,project_id,number,title,status,status_category,labels,created_by_id,created_at,updated_at)
			VALUES (?, 'wa', 'p1', ?, 'Issue', ?, ?, '[]', 'u1', 100, 101)`);
		insert.run("i1", 1, "backlog", "");
		insert.run("i2", 2, "custom-done", "done");
		insert.run("i3", 3, "custom-working", "in_progress");
		insert.run("i4", 4, "cancelled", "");
		const rows = await Effect.runPromise(
			listProjectSummaries(db, "u1", {
				sql: "p.id = ?",
				bindings: ["p1"],
			}),
		);
		expect(rows).toEqual([
			{
				id: "p1",
				name: "Zeta",
				key: "SAME",
				slug: "same",
				description: null,
				archived_at: null,
				created_at: 100,
				updated_at: 101,
				workspace_id: "wa",
				workspace_name: "Alpha workspace",
				workspace_slug: "alpha",
				open_issue_count: 2,
				backlog_issue_count: 1,
			},
		]);
		// Even a permissive caller predicate never drops the membership relation.
		expect(
			(await Effect.runPromise(listProjectSummaries(db, "u1", { sql: "1 = 1", bindings: [] }))).map(
				(p) => p.id,
			),
		).toEqual(["p3", "p1"]);
		expect(
			(
				await Effect.runPromise(
					listProjectSummaries(db, "u1", { sql: "1 = 1", bindings: [] }, true),
				)
			).map((p) => p.id),
		).toEqual(["p2", "p3", "p1"]);
		expect(
			await Effect.runPromise(listProjectSummaries(db, "unknown", { sql: "1 = 1", bindings: [] })),
		).toEqual([]);
	});

	it("loads workspace/membership relations without authorizing roles or selecting an implicit tenant", async () => {
		expect(await Effect.runPromise(listWorkspaces(db, "u2"))).toEqual([
			{ id: "wa", name: "Alpha workspace", slug: "alpha", createdAt: 10, role: "viewer" },
			{ id: "wb", name: "Beta workspace", slug: "beta", createdAt: 20, role: "member" },
		]);
		expect(await Effect.runPromise(listWorkspaces(db, "unknown"))).toEqual([]);
		expect(await Effect.runPromise(findWorkspaceBySlug(db, "alpha"))).toMatchObject({
			id: "wa",
			slug: "alpha",
		});
		expect(await Effect.runPromise(findWorkspaceBySlug(db, "unknown"))).toBeUndefined();
		expect(await Effect.runPromise(findWorkspaceMembership(db, "wa", "u2"))).toEqual({
			workspaceId: "wa",
			userId: "u2",
			role: "viewer",
			joinedAt: 10,
		});
		expect(await Effect.runPromise(findWorkspaceMembership(db, "wb", "u1"))).toBeUndefined();
		expect(
			(await Effect.runPromise(listWorkspaceMembers(db, "wa"))).map((member) => member.id),
		).toEqual(["u2", "u1"]);
	});

	it("decodes stored brand JSON but does not synthesize API URLs", async () => {
		expect(await Effect.runPromise(readWorkspaceBrand(db, "wa"))).toEqual({
			accent: "#abcdef",
			logoR2Key: "wa/brand-logo/x",
		});
		expect(await Effect.runPromise(readWorkspaceBrand(db, "missing"))).toEqual({});
	});

	it("returns only scoped token metadata with decoded scopes and existing descending order", async () => {
		sqlite.exec(`INSERT INTO api_tokens (id,workspace_id,user_id,name,token_hash,scopes,created_at) VALUES
		 ('t1','wa','u1','First','secret1','["read"]',10),
		 ('t2','wa','u1','Second','secret2','["write"]',20),
		 ('t3','wb','u2','Other','secret3','["read"]',30);`);
		expect(await Effect.runPromise(listWorkspaceTokenMetadata(db, "wa"))).toEqual([
			{
				id: "t2",
				name: "Second",
				scopes: ["write"],
				createdAt: 20,
				lastUsedAt: null,
				expiresAt: null,
			},
			{
				id: "t1",
				name: "First",
				scopes: ["read"],
				createdAt: 10,
				lastUsedAt: null,
				expiresAt: null,
			},
		]);
	});

	it("defers I/O and reports database failures through the typed Effect channel", async () => {
		let calls = 0;
		const cause = new Error("database unavailable");
		const broken = {
			prepare: () => {
				calls++;
				throw cause;
			},
		} as unknown as D1Database;
		const query = listProjects(broken, "wa");
		expect(calls).toBe(0);
		const failure = await Effect.runPromise(
			query.pipe(
				Effect.match({
					onSuccess: () => undefined,
					onFailure: (error) => error,
				}),
			),
		);
		expect(calls).toBe(1);
		expect(failure).toBeInstanceOf(DataQueryError);
		expect(failure).toMatchObject({ _tag: "DataQueryError", operation: "listProjects", cause });
	});
});
