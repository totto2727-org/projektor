import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { migratedDb } from "../../db/src/test/helpers";
import { DataQueryError } from "../src/errors";
import {
	findFeedbackSourceById,
	listFeedback,
	listFeedbackSources,
	readFeedbackSummary,
} from "../src/feedback";
import { findSprintById, listSprints } from "../src/sprints";

/** Read-only transport over the real migrated schema. */
function readDatabase(sqlite: DatabaseSync): D1Database {
	function prepare(sql: string, bindings: SQLInputValue[] = []) {
		return {
			bind: (...values: SQLInputValue[]) => prepare(sql, values),
			first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
			all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }),
			raw: async () =>
				sqlite
					.prepare(sql)
					.all(...bindings)
					.map((row) => Object.values(row)),
		};
	}
	return { prepare } as unknown as D1Database;
}

describe("sprint and feedback database read models", () => {
	let sqlite: DatabaseSync;
	let db: D1Database;
	beforeEach(() => {
		sqlite = migratedDb();
		db = readDatabase(sqlite);
		sqlite.exec(`
			INSERT INTO workspaces (id,name,slug,created_at) VALUES ('wa','A','a',1),('wb','B','b',1);
			INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.com','User',1);
			INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES
			 ('pa','wa','A','A','a',1,1),('pa2','wa','A2','A2','a2',1,1),('pb','wb','B','B','b',1,1);
			INSERT INTO sprints (id,workspace_id,project_id,name,status,created_at,updated_at) VALUES
			 ('s2','wa','pa','Later','active',20,21),('s1','wa','pa','Earlier','planned',10,11),
			 ('s3','wa','pa2','Other project','completed',30,31),('sb','wb','pb','Other tenant','planned',5,6);
			INSERT INTO feedback_sources (id,token_hash,workspace_id,project_id,name,allowed_origins,created_by,created_at,revoked_at) VALUES
			 ('sa','hash-a','wa','pa','A source','["https://a.example"]','u',10,NULL),
			 ('sa2','hash-a2','wa','pa','Second source',NULL,'u',20,25),
			 ('sb','hash-b','wb','pb','B source',NULL,'u',30,NULL);
			INSERT INTO feedback (id,source_id,workspace_id,project_id,rating,rating_scale,body,app_version,status,created_at) VALUES
			 ('f1','sa','wa','pa',1,'thumbs','Comment','1','new',10),
			 ('f2','sa','wa','pa',-1,'thumbs',NULL,'1','reviewed',20),
			 ('f3','sa','wa','pa',5,'five_star','','1','actioned',30),
			 ('f4','sa','wa','pa',NULL,NULL,'Text',NULL,'new',40),
			 ('f5','sa2','wa','pa',3,'five_star','Other','2','new',50),
			 ('fb','sb','wb','pb',1,'thumbs','Tenant B','1','new',60);
		`);
	});
	afterEach(() => sqlite.close());

	it("retains sprint model columns, creation ordering and explicit workspace/project scope", async () => {
		const rows = await Effect.runPromise(listSprints(db, "wa", { projectId: "pa" }));
		expect(rows.map((row) => row.id)).toEqual(["s1", "s2"]);
		expect(rows[0]).toEqual({
			id: "s1",
			workspaceId: "wa",
			projectId: "pa",
			name: "Earlier",
			goal: null,
			status: "planned",
			startDate: null,
			endDate: null,
			createdAt: 10,
			updatedAt: 11,
		});
		expect(await Effect.runPromise(listSprints(db, "wa", { projectId: "pb" }))).toEqual([]);
		expect(await Effect.runPromise(findSprintById(db, "wa", "sb"))).toBeUndefined();
		expect(await Effect.runPromise(findSprintById(db, "wa", "missing"))).toBeUndefined();
		expect(await Effect.runPromise(findSprintById(db, "wa", "s2"))).toEqual(rows[1]);
	});

	it("retains raw feedback list rows, descending order and combined filters", async () => {
		const rows = await Effect.runPromise(listFeedback(db, "wa", { projectId: "pa" }));
		expect(rows.map((row) => row.id)).toEqual(["f5", "f4", "f3", "f2", "f1"]);
		expect(rows[4]).toEqual({
			id: "f1",
			source_id: "sa",
			source_name: "A source",
			rating: 1,
			rating_scale: "thumbs",
			body: "Comment",
			submitter_label: null,
			source_url: null,
			app_version: "1",
			status: "new",
			linked_issue_id: null,
			created_at: 10,
		});
		expect(
			(
				await Effect.runPromise(
					listFeedback(db, "wa", { projectId: "pa", sourceId: "sa", status: "new" }),
				)
			).map((row) => row.id),
		).toEqual(["f4", "f1"]);
		expect(await Effect.runPromise(listFeedback(db, "wa", { projectId: "pb" }))).toEqual([]);
	});

	it("retains source/version aggregate counts, null groups and SQL average semantics", async () => {
		const rows = await Effect.runPromise(readFeedbackSummary(db, "wa", { projectId: "pa" }));
		expect(rows).toEqual([
			{
				source_id: "sa2",
				source_name: "Second source",
				app_version: "2",
				total: 1,
				thumbs_up: 0,
				thumbs_total: 0,
				five_star_avg: 3,
				five_star_total: 1,
				with_comment_count: 1,
				last_seen_at: 50,
			},
			{
				source_id: "sa",
				source_name: "A source",
				app_version: null,
				total: 1,
				thumbs_up: 0,
				thumbs_total: 0,
				five_star_avg: null,
				five_star_total: 0,
				with_comment_count: 1,
				last_seen_at: 40,
			},
			{
				source_id: "sa",
				source_name: "A source",
				app_version: "1",
				total: 3,
				thumbs_up: 1,
				thumbs_total: 2,
				five_star_avg: 5,
				five_star_total: 1,
				with_comment_count: 1,
				last_seen_at: 30,
			},
		]);
		expect(await Effect.runPromise(readFeedbackSummary(db, "wa", { projectId: "pb" }))).toEqual([]);
	});

	it("retains raw source metadata and revoked rows without producing API previews", async () => {
		const rows = await Effect.runPromise(listFeedbackSources(db, "wa", { projectId: "pa" }));
		expect(rows.map((row) => row.id)).toEqual(["sa2", "sa"]);
		expect(rows[0]).toEqual({
			id: "sa2",
			token_hash: "hash-a2",
			name: "Second source",
			description: null,
			is_active: 1,
			allowed_origins: null,
			created_at: 20,
			revoked_at: 25,
		});
		expect(await Effect.runPromise(findFeedbackSourceById(db, "wa", "sa"))).toEqual({
			...rows[1],
			project_id: "pa",
		});
		expect(await Effect.runPromise(findFeedbackSourceById(db, "wa", "sb"))).toBeNull();
		expect(await Effect.runPromise(findFeedbackSourceById(db, "wa", "missing"))).toBeNull();
		expect(await Effect.runPromise(listFeedbackSources(db, "wa", { projectId: "pb" }))).toEqual([]);
	});

	it("defers I/O and reports tagged query errors without app semantics", async () => {
		let calls = 0;
		const cause = new Error("database unavailable");
		const broken = {
			prepare: () => {
				calls++;
				throw cause;
			},
		} as unknown as D1Database;
		const effect = listFeedback(broken, "wa", { projectId: "pa" });
		expect(calls).toBe(0);
		const result = await Effect.runPromise(Effect.flip(effect));
		expect(calls).toBe(1);
		expect(result).toBeInstanceOf(DataQueryError);
		expect(result).toMatchObject({ _tag: "DataQueryError", operation: "listFeedback", cause });
	});
});
