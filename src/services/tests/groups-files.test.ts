import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { migratedDb } from "#db/test/helpers";
import { DataQueryError } from "../errors";
import { findAttachment, listAttachments } from "../files";
import {
	findGroup,
	listGroupGrants,
	listGroupMembers,
	listGroups,
	listMemberGroups,
} from "../groups";

/** Executes the actual Drizzle/raw SQL over the complete migrated SQLite schema. */
function readDatabase(sqlite: DatabaseSync): D1Database {
	function prepare(sql: string, bindings: SQLInputValue[] = []) {
		return {
			bind: (...values: SQLInputValue[]) => prepare(sql, values),
			all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }),
			first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
			raw: async () =>
				sqlite
					.prepare(sql)
					.all(...bindings)
					.map((row) => Object.values(row)),
		};
	}
	return { prepare } as unknown as D1Database;
}

describe("groups and attachment pure retrieval", () => {
	let sqlite: DatabaseSync;
	let db: D1Database;
	beforeEach(() => {
		sqlite = migratedDb();
		db = readDatabase(sqlite);
		sqlite.exec(`
			INSERT INTO workspaces (id,name,slug,created_at) VALUES ('wa','A','a',1),('wb','B','b',2);
			INSERT INTO users (id,email,name,created_at) VALUES ('u1','one@example.com','One',1),('u2','two@example.com','Two',2);
			INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('wa','u1','member',1),('wa','u2','viewer',2),('wb','u1','member',1);
			INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES ('p1','wa','Project','ONE',1,1),('p2','wb','Other','TWO',1,1);
			INSERT INTO user_groups (id,workspace_id,name,description,created_at) VALUES ('g1','wa','Zeta',NULL,3),('g2','wa','Alpha','Description',4),('g3','wb','Other',NULL,5);
			INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u2',20),('g1','u2','u1',10),('g3','u1','u1',30);
			INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','member'),('g3','p2','viewer');
			INSERT INTO wiki_pages (id,workspace_id,slug,title,project_id,created_by_id,updated_by_id,created_at,updated_at,deleted_at) VALUES
			 ('w1','wa','hello world','Hello','p1','u1','u1',1,1,NULL),
			 ('w2','wa','deleted','Deleted',NULL,'u1','u1',1,1,2),
			 ('w3','wb','other','Other tenant','p2','u1','u1',1,1,NULL);
			INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,url,linked_wiki_page_id,entity_type,entity_id,created_by_id,created_at) VALUES
			 ('a1','wa','file','secret/key','photo.png','image/png',123,NULL,NULL,'issue','same','u1',30),
			 ('a2','wa','wiki_ref','','','',0,NULL,'w1','issue','same','u1',10),
			 ('a3','wa','wiki_ref','','','',0,NULL,'w2','issue','same','u1',20),
			 ('a4','wa','url','','Site','',0,'https://example.com',NULL,'wiki_page','same','u1',40),
			 ('a5','wb','file','other/key','Other','text/plain',1,NULL,NULL,'issue','same','u1',1),
			 ('a6','wa','wiki_ref','','','',0,NULL,'w3','issue','same','u1',25);
		`);
	});
	afterEach(() => sqlite.close());

	it("lists exact group summaries/counts and app-selected membership subset", async () => {
		expect(await Effect.runPromise(listGroups(db, "wa"))).toEqual([
			{
				id: "g2",
				name: "Alpha",
				description: "Description",
				createdAt: 4,
				memberCount: 0,
				grantCount: 0,
			},
			{ id: "g1", name: "Zeta", description: null, createdAt: 3, memberCount: 2, grantCount: 1 },
		]);
		expect(
			(await Effect.runPromise(listGroups(db, "wa", { memberUserId: "u1" }))).map((g) => g.id),
		).toEqual(["g1"]);
		expect(await Effect.runPromise(listGroups(db, "wa", { memberUserId: "missing" }))).toEqual([]);
	});
	it("retrieves domain group/member/grant rows with explicit tenant boundaries", async () => {
		expect(await Effect.runPromise(findGroup(db, "wa", "g1"))).toEqual({
			id: "g1",
			workspaceId: "wa",
			name: "Zeta",
			description: null,
			createdAt: 3,
		});
		expect(await Effect.runPromise(findGroup(db, "wa", "g3"))).toBeUndefined();
		expect(await Effect.runPromise(listGroupMembers(db, "wa", "g1"))).toEqual([
			{ userId: "u2", email: "two@example.com", name: "Two", addedAt: 10, addedBy: "u1" },
			{ userId: "u1", email: "one@example.com", name: "One", addedAt: 20, addedBy: "u2" },
		]);
		expect(await Effect.runPromise(listGroupGrants(db, "wa", "g1"))).toEqual([
			{ projectId: "p1", projectName: "Project", projectKey: "ONE", role: "member" },
		]);
		expect(await Effect.runPromise(listGroupMembers(db, "wa", "g3"))).toEqual([]);
		expect(await Effect.runPromise(listGroupGrants(db, "wa", "g3"))).toEqual([]);
	});
	it("includes zero-group workspace members without leaking memberships from another tenant", async () => {
		sqlite.exec("DELETE FROM user_group_members WHERE group_id = 'g1' AND user_id = 'u2'");
		expect(await Effect.runPromise(listMemberGroups(db, "wa"))).toEqual([
			{ userId: "u1", groups: [{ id: "g1", name: "Zeta" }] },
			{ userId: "u2", groups: [] },
		]);
	});
	it("maps file/link/wiki metadata, orders by creation and filters entity type/id/workspace", async () => {
		const rows = await Effect.runPromise(
			listAttachments(db, "wa", { entityType: "issue", entityId: "same" }),
		);
		expect(rows.map((a) => a.id)).toEqual(["a2", "a3", "a6", "a1"]);
		expect(rows[0]).toEqual({
			id: "a2",
			kind: "wiki_ref",
			filename: "",
			contentType: "",
			size: 0,
			url: null,
			createdAt: 10,
			wikiPage: { id: "w1", title: "Hello", slug: "hello world", projectId: "p1" },
		});
		expect(rows[1].wikiPage).toBeNull();
		expect(rows[2].wikiPage).toBeNull();
		expect(rows[3]).toEqual({
			id: "a1",
			kind: "file",
			filename: "photo.png",
			contentType: "image/png",
			size: 123,
			url: null,
			createdAt: 30,
			wikiPage: null,
		});
		expect(
			await Effect.runPromise(
				listAttachments(db, "wa", { entityType: "issue", entityId: "missing" }),
			),
		).toEqual([]);
		expect(
			(
				await Effect.runPromise(
					listAttachments(db, "wa", { entityType: "wiki_page", entityId: "same" }),
				)
			).map((a) => a.id),
		).toEqual(["a4"]);
	});
	it("applies app-owned owner and linked-page predicates without losing unavailable refs", async () => {
		const rows = await Effect.runPromise(
			listAttachments(db, "wa", {
				entityType: "issue",
				entityId: "same",
				ownerVisibility: { sql: "a.id != ?", params: ["a1"] },
				linkedWikiVisibility: { sql: "w.project_id = ?", params: ["hidden"] },
			}),
		);
		expect(rows.map((a) => a.id)).toEqual(["a2", "a3", "a6"]);
		expect(rows.every((a) => a.wikiPage === null)).toBe(true);
		expect(
			await Effect.runPromise(
				findAttachment(db, "wa", "a1", { ownerVisibility: { sql: "a.id != ?", params: ["a1"] } }),
			),
		).toBeNull();
	});
	it("finds scoped metadata, missing rows remain null and internal storage keys stay absent", async () => {
		expect(await Effect.runPromise(findAttachment(db, "wa", "a5"))).toBeNull();
		expect(await Effect.runPromise(findAttachment(db, "wa", "missing"))).toBeNull();
		const row = await Effect.runPromise(findAttachment(db, "wa", "a4"));
		expect(row).toMatchObject({
			id: "a4",
			kind: "url",
			filename: "Site",
			url: "https://example.com",
		});
		expect(row).not.toHaveProperty("r2Key");
	});
	it("defers actual DB access until Effect execution and tags SQL failures", async () => {
		const query = listGroups(db, "wa");
		sqlite.exec("DROP TABLE group_project_grants");
		const error = await Effect.runPromise(Effect.flip(query));
		expect(error).toBeInstanceOf(DataQueryError);
		expect(error.operation).toBe("listGroups");
		expect(
			await Effect.runPromise(
				Effect.flip(
					listAttachments(db, "wa", {
						entityType: "issue",
						entityId: "same",
						ownerVisibility: { sql: "invalid_column = ?", params: [1] },
					}),
				),
			),
		).toMatchObject({ _tag: "DataQueryError", operation: "listAttachments" });
	});
});
