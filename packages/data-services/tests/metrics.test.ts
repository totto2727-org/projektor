import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { migratedDb } from "../../db/src/test/helpers";
import { getCodeHeatmap } from "../src/code-heatmap";
import { DataQueryError } from "../src/errors";
import { getFlowMetrics } from "../src/flow-metrics";

const DAY = 86400;
const now = 3 * DAY;

/** Executes the production Drizzle SQL against the complete migrated SQLite schema. */
function readDatabase(sqlite: DatabaseSync, onQuery: () => void = () => {}): D1Database {
	function prepare(sql: string, bindings: SQLInputValue[] = []) {
		return {
			bind: (...values: SQLInputValue[]) => prepare(sql, values),
			all: async () => {
				onQuery();
				return { results: sqlite.prepare(sql).all(...bindings) };
			},
			raw: async () => {
				onQuery();
				return sqlite
					.prepare(sql)
					.all(...bindings)
					.map((row) => Object.values(row));
			},
		};
	}
	return { prepare } as unknown as D1Database;
}

const distribution = (value: number) => ({ count: 1, avg: value, p50: value, p90: value });

describe("shared metrics migrated SQLite reads", () => {
	let sqlite: DatabaseSync;
	let db: D1Database;

	beforeEach(() => {
		sqlite = migratedDb();
		db = readDatabase(sqlite);
		sqlite.exec(`
			INSERT INTO workspaces (id,name,slug,created_at) VALUES ('wa','A','a',1),('wb','B','b',1);
			INSERT INTO users (id,email,name,created_at) VALUES ('u','user@example.com','U',1);
			INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES
			 ('pa','wa','A','A',1,1),('pb','wb','B','B',1,1),('other','wa','Other','OTHER',1,1);
			INSERT INTO task_types (id,workspace_id,key,name) VALUES ('bug','wa','bug','Bug');
			INSERT INTO agent_sessions (id,workspace_id,name,started_at,last_heartbeat_at) VALUES ('agent','wa','Agent',1,1);
		`);
		const insert = sqlite.prepare(`INSERT INTO issues
			(id,workspace_id,project_id,number,title,status,created_by_id,created_at,updated_at,ready_at,claimed_at,in_review_at,done_at,review_bounce_count,type_id)
			VALUES (?,?,?,?, 'Issue',?, 'u',?,?, ?,?,?,?, ?,?)`);
		insert.run(
			"done",
			"wa",
			"pa",
			1,
			"done",
			DAY + 10,
			DAY + 70,
			DAY + 20,
			DAY + 30,
			DAY + 50,
			DAY + 70,
			2,
			"bug",
		);
		insert.run("old", "wa", "pa", 2, "done", 1, DAY - 1, null, null, null, DAY - 1, 0, null);
		insert.run(
			"future-open",
			"wa",
			"pa",
			3,
			"in_progress",
			now,
			now,
			null,
			now,
			null,
			null,
			0,
			null,
		);
		insert.run(
			"foreign",
			"wb",
			"pb",
			1,
			"done",
			DAY + 10,
			DAY + 70,
			DAY + 20,
			DAY + 30,
			DAY + 50,
			DAY + 70,
			10,
			null,
		);
		insert.run(
			"other-project",
			"wa",
			"other",
			1,
			"done",
			DAY + 10,
			DAY + 70,
			DAY + 20,
			DAY + 30,
			DAY + 50,
			DAY + 70,
			10,
			null,
		);
		sqlite.exec(`
			INSERT INTO issue_comments (id,issue_id,author_id,body,created_at,updated_at,author_kind) VALUES
			 ('human','done','u','Human',1,1,'human'),('agent-comment','done','u','Agent',1,1,'agent'),('legacy','done','u','Legacy',1,1,NULL);
			INSERT INTO issue_leases (id,workspace_id,issue_id,agent_session_id,claimed_at,released_at,release_reason) VALUES
			 ('lease','wa','done','agent',${DAY + 30},${DAY + 50},'expired');
			INSERT INTO issue_file_claims (id,workspace_id,issue_id,path,claimed_at,released_at,release_reason) VALUES
			 ('claim','wa','done','src/a.ts',${DAY + 30},${DAY + 50},'agent_ended');
			INSERT INTO issue_gate_rejections (id,workspace_id,issue_id,occurred_at) VALUES ('gate','wa','done',${DAY + 50});
			INSERT INTO wip_cap_denials (id,workspace_id,project_id,issue_id,occurred_at) VALUES ('cap','wa','pa','done',${DAY + 50});
		`);
	});

	afterEach(() => sqlite.close());

	it("preserves the complete windowed output, historical CFD baseline, human attribution and present aging snapshot", async () => {
		const result = await Effect.runPromise(
			getFlowMetrics(
				db,
				"wa",
				{ projectId: "pa", since: DAY, until: now - 1, granularity: "day" },
				now,
			),
		);
		expect(result).toEqual({
			leadTime: distribution(50),
			leadTimeExcluded: 0,
			cycleTime: distribution(40),
			wipOverTime: [
				{ date: "1970-01-02", count: 0 },
				{ date: "1970-01-03", count: 0 },
			],
			throughputOverTime: [
				{ bucketStart: "1970-01-02", count: 1 },
				{ bucketStart: "1970-01-03", count: 0 },
			],
			bugShareOverTime: [
				{ bucketStart: "1970-01-02", total: 1, bugCount: 1, bugSharePercent: 1 },
				{ bucketStart: "1970-01-03", total: 0, bugCount: 0, bugSharePercent: null },
			],
			bugTypeTracked: true,
			reviewLatency: distribution(20),
			reviewLatencyOverTime: [
				{ bucketStart: "1970-01-02", p50: 20 },
				{ bucketStart: "1970-01-03", p50: null },
			],
			humanInterventions: distribution(3),
			autonomyRatio: distribution(0.5),
			cfdOverTime: [
				{ bucketStart: "1970-01-02", backlogTodo: 0, inProgress: 0, inReview: 0, done: 2 },
				{ bucketStart: "1970-01-03", backlogTodo: 0, inProgress: 0, inReview: 0, done: 2 },
			],
			timeInProgress: distribution(20),
			arrivalVsCompletionOverTime: [
				{ bucketStart: "1970-01-02", created: 1, completed: 1, net: 0 },
				{ bucketStart: "1970-01-03", created: 0, completed: 0, net: 0 },
			],
			flowEfficiency: distribution(0.4),
			agingWip: [{ id: "future-open", status: "in_progress", ageSeconds: 0 }],
			factoryHealth: { leaseExpiries: 1, abandonedClaims: 1, gateRejections: 1, wipCapPressure: 1 },
		});
	});

	it("retains unbounded default distributions and deterministic default day/ISO-week buckets", async () => {
		const result = await Effect.runPromise(
			getFlowMetrics(db, "wa", { projectId: "pa", granularity: "week" }, now),
		);
		expect(result.leadTime).toEqual(distribution(50));
		expect(result.leadTimeExcluded).toBe(1);
		expect(result.humanInterventions.count).toBe(2);
		expect(result.throughputOverTime).toHaveLength(6);
		expect(result.wipOverTime).toHaveLength(31);
		expect(result.throughputOverTime.at(-1)).toEqual({ bucketStart: "1969-12-29", count: 2 });
	});

	it("clamps partial weekly edges and returns empty data without cross-workspace leakage", async () => {
		const partial = await Effect.runPromise(
			getFlowMetrics(
				db,
				"wa",
				{ projectId: "pa", since: DAY + 60, until: DAY + 70, granularity: "week" },
				now,
			),
		);
		expect(partial.throughputOverTime).toEqual([{ bucketStart: "1969-12-29", count: 1 }]);
		expect(partial.arrivalVsCompletionOverTime[0]).toMatchObject({
			created: 0,
			completed: 1,
			net: -1,
		});
		const foreign = await Effect.runPromise(
			getFlowMetrics(
				db,
				"wa",
				{ projectId: "pb", since: DAY, until: now, granularity: "day" },
				now,
			),
		);
		expect(foreign.leadTime).toEqual({ count: 0, avg: null, p50: null, p90: null });
		expect(foreign.agingWip).toEqual([]);
		expect(foreign.factoryHealth).toEqual({
			leaseExpiries: 0,
			abandonedClaims: 0,
			gateRejections: 0,
			wipCapPressure: 0,
		});
	});

	it("retains claims drill-down, stable count ordering, inclusive bounds and unfiltered total distinct issues", async () => {
		const insert = sqlite.prepare(
			"INSERT INTO issue_file_claims (id,workspace_id,issue_id,path,claimed_at,released_at) VALUES (?,?,?,?,?,?)",
		);
		insert.run("nested", "wa", "old", "src/nested/a.ts", DAY, DAY + 1);
		insert.run("same", "wa", "done", "src", DAY + 1, DAY + 2);
		insert.run("docs", "wa", "future-open", "docs/a.md", DAY + 2, DAY + 3);
		insert.run("end", "wa", "done", "z.ts", now, now + 1);
		insert.run("before", "wa", "done", "outside.ts", DAY - 1, DAY);
		insert.run("foreign-claim", "wb", "foreign", "foreign.ts", DAY, null);
		insert.run("other-claim", "wa", "other-project", "other.ts", DAY, null);
		const result = await Effect.runPromise(
			getCodeHeatmap(db, "wa", { projectId: "pa", since: DAY, until: now }, now),
		);
		expect(result).toEqual({
			prefix: "",
			mode: "claims",
			totalDistinctIssues: 3,
			entries: [
				{ path: "src", segment: "src", isLeaf: false, distinctIssueCount: 2, claimCount: 3 },
				{ path: "docs", segment: "docs", isLeaf: false, distinctIssueCount: 1, claimCount: 1 },
				{ path: "z.ts", segment: "z.ts", isLeaf: true, distinctIssueCount: 1, claimCount: 1 },
			],
		});
		const nested = await Effect.runPromise(
			getCodeHeatmap(db, "wa", { projectId: "pa", since: DAY, until: now, prefix: "src" }, now),
		);
		expect(nested).toEqual({
			prefix: "src",
			mode: "claims",
			totalDistinctIssues: 3,
			entries: [
				{ path: "src/a.ts", segment: "a.ts", isLeaf: true, distinctIssueCount: 1, claimCount: 1 },
				{
					path: "src/nested",
					segment: "nested",
					isLeaf: false,
					distinctIssueCount: 1,
					claimCount: 1,
				},
			],
		});
	});

	it("retains contention DTO names and tenant/project/default-window filters", async () => {
		const insert = sqlite.prepare(
			"INSERT INTO claim_conflicts (id,workspace_id,path,rejected_issue_id,holding_issue_id,occurred_at) VALUES (?,?,?,?,?,?)",
		);
		insert.run("c1", "wa", "src/a.ts", "done", "old", DAY);
		insert.run("c2", "wa", "src/b.ts", "old", "done", now);
		insert.run("c3", "wa", "src/a.ts", "done", "old", DAY + 1);
		insert.run("cf", "wb", "foreign.ts", "foreign", "foreign", DAY);
		insert.run("cp", "wa", "other.ts", "other-project", "done", DAY);
		const result = await Effect.runPromise(
			getCodeHeatmap(db, "wa", { projectId: "pa", mode: "contention" }, now),
		);
		expect(result).toEqual({
			prefix: "",
			mode: "contention",
			totalDistinctIssues: 2,
			entries: [
				{
					path: "src",
					segment: "src",
					isLeaf: false,
					distinctRejectedIssueCount: 2,
					conflictCount: 3,
				},
			],
		});
		expect(
			await Effect.runPromise(
				getCodeHeatmap(db, "wa", { projectId: "pb", mode: "contention" }, now),
			),
		).toEqual({ prefix: "", mode: "contention", totalDistinctIssues: 0, entries: [] });
	});

	it("defers SQL execution and reports query failures with the package DataQueryError", async () => {
		let queries = 0;
		const tracked = readDatabase(sqlite, () => queries++);
		const flow = getFlowMetrics(
			tracked,
			"wa",
			{ projectId: "pa", since: DAY, until: now, granularity: "day" },
			now,
		);
		const heatmap = getCodeHeatmap(tracked, "wa", { projectId: "pa" }, now);
		expect(queries).toBe(0);
		await Effect.runPromise(flow);
		await Effect.runPromise(heatmap);
		expect(queries).toBeGreaterThan(0);
		const failed = {
			prepare: () => {
				throw new Error("database unavailable");
			},
		} as unknown as D1Database;
		const error = await Effect.runPromise(
			getCodeHeatmap(failed, "wa", { projectId: "pa" }, now).pipe(Effect.flip),
		);
		expect(error).toBeInstanceOf(DataQueryError);
		expect(error.operation).toBe("getCodeHeatmap");
		const flowError = await Effect.runPromise(
			getFlowMetrics(failed, "wa", { projectId: "pa", granularity: "day" }, now).pipe(Effect.flip),
		);
		expect(flowError).toBeInstanceOf(DataQueryError);
		expect(flowError.operation).toBe("getFlowMetrics");
	});
});
