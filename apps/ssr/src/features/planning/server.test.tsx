import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createRequestApi, type RequestApi } from "../../server/api-client";
import type { ApiError, ScopeError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
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
vi.hoisted(() => {
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
	);
});
const workspace = { id: "w1", name: "Alpha", slug: "alpha", role: "owner" as const };
const project = {
	id: "p1",
	name: "Project",
	key: "PROJ",
	slug: "project",
	description: null,
	workspace_id: "w1",
	workspace_slug: "alpha",
	workspace_name: "Alpha",
	open_issue_count: 1,
	backlog_issue_count: 0,
	archived_at: null,
	created_at: 1,
	updated_at: 1,
};
const scope: RequestScope = {
	user: { id: "u1", name: "Owner", email: "owner@example.test" },
	workspaces: [workspace],
	projects: [project],
	selection: { kind: "project", workspace, project },
};
const sprint = {
	id: "s1",
	projectId: "p1",
	name: "Iteration",
	goal: null,
	startDate: null,
	endDate: null,
	status: "completed",
	createdAt: 1,
};
const issue = {
	id: "i1",
	title: "Completed task",
	number: 1,
	project_key: "PROJ",
	status_category: "done",
	sprint_id: "s1",
	customFields: [{ key: "story_points", value: "5" }],
};
const dist = { count: 0, avg: null, p50: null, p90: null };
const metric = {
	leadTime: dist,
	cycleTime: dist,
	reviewLatency: dist,
	humanInterventions: dist,
	autonomyRatio: dist,
	timeInProgress: dist,
	flowEfficiency: dist,
	wipOverTime: [],
	throughputOverTime: [],
	bugShareOverTime: [],
	bugTypeTracked: false,
	reviewLatencyOverTime: [],
	cfdOverTime: [],
	arrivalVsCompletionOverTime: [],
	agingWip: [],
	factoryHealth: { leaseExpiries: 0, abandonedClaims: 0, gateRejections: 0, wipCapPressure: 0 },
};
type Calls = { path: string; workspace: string | null }[];
function runWithApi<T>(
	resolve: (url: URL, options?: RequestInit) => unknown | Promise<unknown>,
	calls: Calls,
	use: (api: RequestApi) => Effect.Effect<T, ApiError | ScopeError>
): Promise<T> {
	const transport: typeof fetch = async (input, options) => {
		const url = new URL(String(input));
		calls.push({
			path: url.pathname + url.search,
			workspace: new Headers(options?.headers).get("X-Workspace-Slug"),
		});
		const value = await resolve(url, options);
		return value instanceof Response ? value : Response.json(value);
	};
	return Effect.runPromise(
		Effect.gen(function* () {
			const api = yield* createRequestApi(new Request("https://front.example/sprints"), {
				apiBaseUrl: "https://api.example",
			});
			return yield* use(api);
		}).pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.provideService(FetchHttpClient.Fetch, transport)
		)
	);
}

describe("planning native Effect SSR loaders and actual wire contracts", () => {
	it("keeps the HTTP response scope alive while the concrete sprint schema consumes a delayed body", async () => {
		let bodyRead = false;
		let abortedBeforeBody = false;
		const node = await runWithApi(
			(url, options) => {
				if (url.pathname !== "/api/sprints") return { items: [], nextCursor: null };
				options?.signal?.addEventListener(
					"abort",
					() => {
						abortedBeforeBody ||= !bodyRead;
					},
					{ once: true }
				);
				return new Response(
					new ReadableStream({
						async start(controller) {
							await new Promise((resolve) => setTimeout(resolve, 5));
							if (options?.signal?.aborted) {
								controller.error(new Error("Response scope closed before body consumption."));
								return;
							}
							bodyRead = true;
							controller.enqueue(new TextEncoder().encode(JSON.stringify({ items: [sprint] })));
							controller.close();
						},
					}),
					{ headers: { "content-type": "application/json" } }
				);
			},
			[],
			(api) => renderSprints(api, scope, new URL("https://front.example/sprints"))
		);
		expect(node.props.initialSprints).toEqual([sprint]);
		expect(bodyRead).toBe(true);
		expect(abortedBeforeBody).toBe(false);
	});
	it("maps malformed JSON and DTO schema failures at the individual loader response boundary", async () => {
		await expect(
			runWithApi(
				(url) =>
					url.pathname === "/api/sprints"
						? new Response("not-json", { headers: { "content-type": "application/json" } })
						: { items: [], nextCursor: null },
				[],
				(api) => renderSprints(api, scope, new URL("https://front.example/sprints"))
			)
		).rejects.toMatchObject({ _tag: "ApiError", kind: "schema", status: 502 });
		await expect(
			runWithApi(
				(url) =>
					url.pathname === "/api/sprints"
						? { items: [{ ...sprint, status: "invalid" }] }
						: { items: [], nextCursor: null },
				[],
				(api) => renderSprints(api, scope, new URL("https://front.example/sprints"))
			)
		).rejects.toMatchObject({ _tag: "ApiError", kind: "schema", status: 502 });
	});
	it.each(["all", "planned", "active", "completed"] as const)(
		"renders the %s sprint mode selected by the URL, retaining complete move/velocity context",
		async (mode) => {
			const all = [
				{ ...sprint, id: "planned", status: "planned", name: "Planned iteration" },
				{ ...sprint, id: "active", status: "active", name: "Active iteration" },
				sprint,
			];
			const node = await runWithApi(
				(url) =>
					url.pathname === "/api/sprints" ? { items: all } : { items: [issue], nextCursor: null },
				[],
				(api) => renderSprints(api, scope, new URL(`https://front.example/sprints?status=${mode}`))
			);
			expect(node.props.mode).toBe(mode);
			expect(node.props.initialSprints.map((item: { id: string }) => item.id)).toEqual(
				all.filter((item) => mode === "all" || item.status === mode).map((item) => item.id)
			);
			expect(node.props.allSprints).toEqual(all);
			const html = renderToStaticMarkup(node);
			expect(html).toContain("Velocity");
			expect(html).toContain("3 sprints");
			expect(html).toContain(`status=${mode}`);
		}
	);
	it("defaults sprint views to all and rejects invalid URL modes before any HTTP load", async () => {
		const calls: Calls = [];
		await expect(
			runWithApi(
				() => ({}),
				calls,
				(api) => renderSprints(api, scope, new URL("https://front.example/sprints?status=archived"))
			)
		).rejects.toMatchObject({ _tag: "ScopeError", status: 400 });
		expect(calls).toEqual([]);
	});
	it("validates explicit GET ranges/options with the same Effect Schema used by the TanStack form", async () => {
		await expect(
			runWithApi(
				() => metric,
				[],
				(api) =>
					renderMetrics(
						api,
						scope,
						new URL("https://front.example/metrics?since=2026-10-04&until=2026-10-01")
					)
			)
		).rejects.toMatchObject({ _tag: "ScopeError", status: 400 });
		await expect(
			runWithApi(
				() => metric,
				[],
				(api) =>
					renderMetrics(api, scope, new URL("https://front.example/metrics?since=2026-02-30"))
			)
		).rejects.toMatchObject({ _tag: "ScopeError", status: 400 });
	});
	it("SSR-loads sprint envelope and fully paged project= issues for velocity without browser GETs", async () => {
		const calls: Calls = [];
		const node = await runWithApi(
			(url) =>
				url.pathname === "/api/sprints"
					? { items: [sprint] }
					: url.searchParams.has("cursor")
						? { items: [{ ...issue, id: "i2", title: "Second task" }], nextCursor: null }
						: { items: [issue], nextCursor: "next:cursor" },
			calls,
			(api) => renderSprints(api, scope, new URL("https://front.example/sprints?projectId=p1"))
		);
		const html = renderToStaticMarkup(node);
		expect(html).toContain("Velocity");
		expect(html).toContain("Iteration");
		expect(calls.map((call) => call.path)).toEqual([
			"/api/sprints?projectId=p1",
			"/api/issues?project=p1&limit=100",
			"/api/issues?project=p1&limit=100&cursor=next%3Acursor",
		]);
		expect(calls.every((call) => call.workspace === "alpha")).toBe(true);
		expect(node.props.initialIssues.length).toBe(2);
		expect(node.props.mode).toBe("all");
	});
	it("fails safely rather than looping on repeated cursors", async () => {
		await expect(
			runWithApi(
				() => ({ items: [issue], nextCursor: "repeat" }),
				[],
				(api) => loadSprintIssues(api, "p1", "alpha")
			)
		).rejects.toMatchObject({
			kind: "schema",
			status: 502,
			message: "Repeated issue pagination cursor",
		});
	});
	it("SSR-loads the exact metrics window plus contention/prefix heatmap", async () => {
		const calls: Calls = [];
		const node = await runWithApi(
			(url) =>
				url.pathname.endsWith("/flow-metrics")
					? metric
					: {
							prefix: "src",
							totalDistinctIssues: 1,
							entries: [
								{
									path: "src/api",
									segment: "api",
									isLeaf: false,
									distinctRejectedIssueCount: 1,
									conflictCount: 2,
								},
							],
						},
			calls,
			(api) =>
				renderMetrics(
					api,
					scope,
					new URL(
						"https://front.example/metrics?since=2026-09-01&until=2026-10-01&granularity=day&heatmapMode=contention&prefix=src"
					)
				)
		);
		const flow = new URL(calls[0].path, "https://api.example");
		const heat = new URL(calls[1].path, "https://api.example");
		expect(flow.searchParams.get("since")).toBe(String(Date.parse("2026-09-01T00:00:00Z") / 1000));
		expect(flow.searchParams.get("until")).toBe(String(Date.parse("2026-10-01T23:59:59Z") / 1000));
		expect(flow.searchParams.get("granularity")).toBe("day");
		expect(heat.searchParams.get("mode")).toBe("contention");
		expect(heat.searchParams.get("prefix")).toBe("src");
		expect(renderToStaticMarkup(node)).toContain("Where the fleet queues up");
		expect(node.props.initialUrl).toContain("workspace=alpha");
	});
	it("keeps core metrics when the optional heatmap fails, but propagates core schema failures", async () => {
		const node = await runWithApi(
			(url) =>
				url.pathname.endsWith("/flow-metrics") ? metric : new Response("private", { status: 503 }),
			[],
			(api) => renderMetrics(api, scope, new URL("https://front.example/metrics"))
		);
		expect(node.props.initialHeatmap).toBeNull();
		expect(node.props.heatmapError).toContain("Failed to load");
		await expect(
			runWithApi(
				() => ({}),
				[],
				(api) => renderMetrics(api, scope, new URL("https://front.example/metrics"))
			)
		).rejects.toMatchObject({ kind: "schema", status: 502 });
	});
	it("rejects malformed sprint, metrics and heatmap JSON with Effect schemas", () => {
		expect(() => Schema.decodeUnknownSync(SprintsSchema)([sprint])).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(SprintsSchema)({ items: [{ ...sprint, status: "archived" }] })
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(MetricsSchema)({ ...metric, bugTypeTracked: "false" })
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(MetricsSchema)({
				...metric,
				agingWip: [{ id: "i", status: "done", ageSeconds: 1 }],
			})
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(HeatmapSchema)({ prefix: "", totalDistinctIssues: "1", entries: [] })
		).toThrow();
	});
	it("uses the original six-week weekly default and normalizes malformed/reversed dates", () => {
		const now = new Date("2026-10-04T12:00:00Z");
		expect(defaultRange(now)).toEqual({
			since: "2026-08-24",
			until: "2026-10-04",
			granularity: "week",
		});
		expect(
			rangeFromUrl(new URL("https://front.example/metrics?since=not-a-date&until=2026-10-04"), now)
				.since
		).toBe("2026-08-24");
		expect(
			rangeFromUrl(new URL("https://front.example/metrics?since=2026-10-05&until=2026-10-01"), now)
				.since
		).toBe("2026-10-01");
	});
});
