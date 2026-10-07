import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { makeRequestServices, RequestServices } from "../../request";
import type { RequestApi } from "../../server/api-client";
import type { ApiError, ScopeError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
import { featureDatabase } from "./action-test-fixture";
import { defaultRange, rangeFromUrl } from "./helpers";
import { HeatmapSchema, MetricsSchema, SprintsSchema } from "./schemas";
import { loadSprintIssues, renderMetrics, renderSprints } from "./server";

vi.mock("./actions", () => ({
	createSprint: vi.fn(),
	editSprint: vi.fn(),
	setSprintStatus: vi.fn(),
	archiveSprint: vi.fn(),
	moveSprintIssues: vi.fn(),
}));
vi.hoisted(() =>
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
	),
);

function runWithDatabase<T>(
	database: ReturnType<typeof featureDatabase>,
	url: URL,
	use: (
		api: RequestApi,
		scope: RequestScope,
	) => Effect.Effect<T, ApiError | ScopeError, RequestServices>,
) {
	const transport = vi.fn<typeof fetch>().mockImplementation(async (input) => {
		expect(new URL(input instanceof Request ? input.url : input.toString()).pathname).toBe(
			"/auth/me",
		);
		return Response.json({
			user: { id: "u1", email: "owner@example.test", name: "Owner" },
			workspaces: [{ id: "w1", slug: "alpha", name: "Alpha", role: "owner" }],
		});
	});
	const result = Effect.runPromise(
		Effect.gen(function* () {
			const services = yield* makeRequestServices(
				new Request(url, { headers: { cookie: "CF_Authorization=actual-user" } }),
				{ API_BASE: "https://api.example", DB: database.db },
			);
			const scope = yield* services.scope({
				requireProject: true,
				projectHint: "p1",
				workspaceHint: "alpha",
			});
			return yield* use(services.api, scope).pipe(Effect.provideService(RequestServices, services));
		}).pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.provideService(FetchHttpClient.Fetch, transport),
		),
	);
	return { result, transport };
}
function issueRows(database: ReturnType<typeof featureDatabase>, count: number) {
	const statement = database.sqlite.prepare(
		"INSERT INTO issues (id,workspace_id,project_id,number,title,created_by_id,created_at,updated_at,sprint_id,status) VALUES (?, 'w1', 'p1', ?, ?, 'u1', 1, 1, 's1', 'done')",
	);
	for (let index = 0; index < count; index++)
		statement.run(`i${String(index).padStart(3, "0")}`, index + 1, `Completed task ${index}`);
}

describe("planning SSR named shared queries on real migrated D1", () => {
	it.each(["all", "planned", "active", "completed"] as const)(
		"renders URL %s mode with full sprint and velocity context without read HTTP",
		async (mode) => {
			const database = featureDatabase();
			database.sqlite.exec(
				"UPDATE sprints SET status='completed' WHERE id='s1'; UPDATE sprints SET status='active' WHERE id='s2'",
			);
			issueRows(database, 1);
			const run = runWithDatabase(
				database,
				new URL(`https://front.example/sprints?status=${mode}`),
				(api, scope) =>
					renderSprints(api, scope, new URL(`https://front.example/sprints?status=${mode}`)),
			);
			const node = await run.result;
			expect(node.props.mode).toBe(mode);
			expect(node.props.allSprints.map((item: { id: string }) => item.id)).toEqual(["s1", "s2"]);
			expect(node.props.initialSprints.map((item: { status: string }) => item.status)).toEqual(
				["completed", "active"].filter((status) => mode === "all" || status === mode),
			);
			expect(node.props.initialIssues).toHaveLength(1);
			expect(renderToStaticMarkup(node)).toContain("Velocity");
			expect(run.transport).toHaveBeenCalledTimes(1);
		},
	);
	it("loads every issue page, including same-timestamp ties and real custom fields, for velocity", async () => {
		const database = featureDatabase();
		issueRows(database, 205);
		database.sqlite
			.exec(`INSERT INTO custom_field_definitions (id,workspace_id,key,label,type,created_at) VALUES ('points','w1','story_points','Story points','number',1);
			INSERT INTO custom_field_values (issue_id,field_id,value) VALUES ('i000','points','5');
			INSERT INTO issues (id,workspace_id,project_id,number,title,created_by_id,created_at,updated_at) VALUES ('private','w2','foreign',1,'Private','u1',999,999)`);
		const run = runWithDatabase(database, new URL("https://front.example/sprints"), (api, scope) =>
			loadSprintIssues(api, "p1", "alpha", scope),
		);
		const issues = await run.result;
		expect(issues).toHaveLength(205);
		expect(new Set(issues.map((item) => item.id)).size).toBe(205);
		expect(issues.find((item) => item.id === "i000")?.customFields).toEqual([
			{ key: "story_points", value: "5" },
		]);
		expect(issues.some((item) => item.id === "private")).toBe(false);
		expect(run.transport).toHaveBeenCalledTimes(1);
	});
	it("rejects inaccessible selected projects before loading project data", async () => {
		const database = featureDatabase();
		const run = runWithDatabase(database, new URL("https://front.example/sprints"), (api, scope) =>
			renderSprints(api, { ...scope, projects: [] }, new URL("https://front.example/sprints")),
		);
		await expect(run.result).rejects.toMatchObject({ _tag: "ScopeError", status: 404 });
	});
	it("rejects invalid sprint modes and metrics ranges rather than sending HTTP reads", async () => {
		const database = featureDatabase();
		await expect(
			runWithDatabase(database, new URL("https://front.example/sprints"), (api, scope) =>
				renderSprints(api, scope, new URL("https://front.example/sprints?status=archived")),
			).result,
		).rejects.toMatchObject({ _tag: "ScopeError", status: 400 });
		for (const query of ["since=2026-10-04&until=2026-10-01", "since=2026-02-30"]) {
			await expect(
				runWithDatabase(database, new URL("https://front.example/metrics"), (api, scope) =>
					renderMetrics(api, scope, new URL(`https://front.example/metrics?${query}`)),
				).result,
			).rejects.toMatchObject({ _tag: "ScopeError", status: 400 });
		}
	});
	it("uses the exact UTC metrics window and contention prefix from the URL against real rows", async () => {
		const database = featureDatabase();
		issueRows(database, 1);
		const doneAt = Date.parse("2026-09-02T12:00:00Z") / 1000;
		database.sqlite
			.prepare("UPDATE issues SET ready_at=?, claimed_at=?, done_at=? WHERE id='i000'")
			.run(doneAt - 3600, doneAt - 1800, doneAt);
		database.sqlite
			.prepare(
				"INSERT INTO claim_conflicts (id,workspace_id,path,rejected_issue_id,holding_issue_id,occurred_at) VALUES ('conflict','w1','src/api/server.ts','i000','i000',?)",
			)
			.run(doneAt);
		const url = new URL(
			"https://front.example/metrics?since=2026-09-01&until=2026-10-01&granularity=day&heatmapMode=contention&prefix=src",
		);
		const run = runWithDatabase(database, url, (api, scope) => renderMetrics(api, scope, url));
		const node = await run.result;
		expect(node.props.initialRange).toEqual({
			since: "2026-09-01",
			until: "2026-10-01",
			granularity: "day",
		});
		expect(node.props.initialMetrics.leadTime).toEqual({
			count: 1,
			avg: 3600,
			p50: 3600,
			p90: 3600,
		});
		expect(node.props.initialHeatmap).toEqual({
			prefix: "src",
			totalDistinctIssues: 1,
			entries: [
				{
					path: "src/api",
					segment: "api",
					isLeaf: false,
					distinctRejectedIssueCount: 1,
					conflictCount: 1,
				},
			],
		});
		expect(node.props.initialUrl).toContain("workspace=alpha");
		expect(renderToStaticMarkup(node)).toContain("Where the fleet queues up");
		expect(run.transport).toHaveBeenCalledTimes(1);
	});
	it("retains core metrics when optional heatmap queries fail and safely reports core failures", async () => {
		const database = featureDatabase();
		database.sqlite.exec("DROP TABLE claim_conflicts");
		const url = new URL("https://front.example/metrics?heatmapMode=contention");
		const node = await runWithDatabase(database, url, (api, scope) =>
			renderMetrics(api, scope, url),
		).result;
		expect(node.props.initialHeatmap).toBeNull();
		expect(node.props.heatmapError).toContain("Failed to load");
		database.sqlite.exec("DROP TABLE task_types");
		await expect(
			runWithDatabase(database, url, (api, scope) => renderMetrics(api, scope, url)).result,
		).rejects.toMatchObject({
			_tag: "ApiError",
			status: 500,
			message: "Unable to load project data.",
		});
	});
	it("decodes the existing concrete sprint, metrics and heatmap DTO contracts", () => {
		expect(() =>
			Schema.decodeUnknownSync(SprintsSchema)({ items: [{ id: "s1", status: "archived" }] }),
		).toThrow();
		expect(() => Schema.decodeUnknownSync(MetricsSchema)({ bugTypeTracked: "false" })).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(HeatmapSchema)({
				prefix: "",
				totalDistinctIssues: "1",
				entries: [],
			}),
		).toThrow();
	});
	it("keeps the six-week weekly default and date normalization", () => {
		const now = new Date("2026-10-04T12:00:00Z");
		expect(defaultRange(now)).toEqual({
			since: "2026-08-24",
			until: "2026-10-04",
			granularity: "week",
		});
		expect(
			rangeFromUrl(new URL("https://front.example/metrics?since=not-a-date&until=2026-10-04"), now)
				.since,
		).toBe("2026-08-24");
		expect(
			rangeFromUrl(new URL("https://front.example/metrics?since=2026-10-05&until=2026-10-01"), now)
				.since,
		).toBe("2026-10-01");
	});
});
