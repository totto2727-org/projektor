import { Effect } from "effect";
import { FetchHttpClient, HttpRouter, HttpServerResponse } from "effect/http";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { createTestDatabase } from "./test/database";
import { TestHttpClient } from "./test/http-client";
import { getRouteParams, makeRequestServices, type PreparedView, RequestServices } from "./request";
import { ApiError } from "./server";

vi.mock("@effront/core/workers", async () => {
	const { Effect } = await import("effect");
	return {
		getWorkersRequestContext: () =>
			Effect.die("Host context is not used by request-factory tests."),
	};
});

const database = createTestDatabase();
afterAll(database.close);
const env = { API_BASE: "https://api.example.test", DB: database.db };
function incoming(identity: string) {
	return new Request("https://front.example.test/", {
		headers: { "Cf-Access-Jwt-Assertion": identity },
	});
}
function run<A, E>(
	effect: Effect.Effect<A, E, import("effect/http").HttpClient.HttpClient>,
	transport: typeof fetch,
) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provide(TestHttpClient),
			Effect.provideService(FetchHttpClient.Fetch, transport),
		),
	);
}

describe("request-scoped Effect services", () => {
	it("reads matched framework parameters without another URL parser", async () => {
		const params = { projectSlug: "already%decoded", issueNumber: "12" };
		const result = await Effect.runPromise(
			getRouteParams.pipe(
				Effect.provideService(HttpRouter.RouteContext, {
					params,
					route: HttpRouter.route(
						"GET",
						"/projects/:projectSlug/issues/:issueNumber/:titleSlug",
						HttpServerResponse.empty(),
					),
				}),
			),
		);
		expect(result).toBe(params);
		expect(await Effect.runPromise(getRouteParams)).toEqual({});
	});
	it("shares concurrent work only inside one identity's request", async () => {
		const calls: Array<{ path: string; identity: string | null }> = [];
		const transport: typeof fetch = async (input, init) => {
			const request = new Request(input, init);
			const path = new URL(request.url).pathname;
			const identity = request.headers.get("Cf-Access-Jwt-Assertion");
			calls.push({ path, identity });
			return Response.json(
				path === "/auth/me"
					? {
							user: { id: identity, name: identity, email: "user@example.test" },
							workspaces: [],
						}
					: [],
			);
		};
		const results = await run(
			Effect.gen(function* () {
				const first = yield* makeRequestServices(incoming("first"), env);
				const second = yield* makeRequestServices(incoming("second"), env);
				const [a, repeated, b] = yield* Effect.all(
					[
						first.scope({ requireWorkspace: false }),
						first.scope({ requireWorkspace: false }),
						second.scope(),
					],
					{ concurrency: 3 },
				);
				return { a, repeated, b };
			}),
			transport,
		);
		expect(results.a).toBe(results.repeated);
		expect(results.a.user.id).toBe("first");
		expect(results.b.user.id).toBe("second");
		expect(calls.filter((call) => call.path === "/auth/me")).toHaveLength(2);
		expect(calls.filter((call) => call.path === "/api/projects")).toHaveLength(0);
	});

	it("invalidates only request-owned scope state and reloads authoritative HTTP data", async () => {
		let name = "Before";
		const transport = vi
			.fn<typeof fetch>()
			.mockImplementation(async (input) =>
				Response.json(
					new URL(String(input)).pathname === "/auth/me"
						? { user: { id: "user", name, email: "user@example.test" }, workspaces: [] }
						: [],
				),
			);
		const actual = await run(
			Effect.gen(function* () {
				const services = yield* makeRequestServices(incoming("caller"), env);
				const first = yield* services.scope();
				name = "After";
				const cached = yield* services.scope();
				yield* services.invalidate;
				const refreshed = yield* services.scope();
				return { first, cached, refreshed };
			}),
			transport,
		);
		expect(actual.cached).toBe(actual.first);
		expect(actual.first.user.name).toBe("Before");
		expect(actual.refreshed.user.name).toBe("After");
		expect(transport).toHaveBeenCalledTimes(2);
	});

	it("invalidates prepared views explicitly", async () => {
		let renders = 0;
		const actual = await run(
			Effect.gen(function* () {
				const services = yield* makeRequestServices(incoming("caller"), env);
				const view: PreparedView = Effect.gen(function* () {
					const current = yield* RequestServices;
					return `${current.url.pathname}:${++renders}`;
				});
				const prepare = services
					.prepare(view)
					.pipe(Effect.provideService(RequestServices, services));
				const a = yield* prepare;
				const cached = yield* prepare;
				yield* services.invalidate;
				const refreshed = yield* prepare;
				return { a, cached, refreshed };
			}),
			async () => Response.json([]),
		);
		expect(actual.a).toBe(actual.cached);
		expect(actual.refreshed).not.toBe(actual.a);
		expect(renders).toBe(2);
	});

	it("does not permanently cache a failed pre-stream render", async () => {
		let attempts = 0;
		const actual = await run(
			Effect.gen(function* () {
				const services = yield* makeRequestServices(incoming("caller"), env);
				const view: PreparedView = Effect.suspend(() =>
					++attempts === 1
						? Effect.fail(new ApiError("network", 502, "Temporarily unavailable."))
						: Effect.succeed("Recovered"),
				);
				const prepare = services
					.prepare(view)
					.pipe(Effect.provideService(RequestServices, services));
				const first = yield* prepare.pipe(Effect.result);
				const second = yield* prepare;
				return { first, second };
			}),
			async () => Response.json([]),
		);
		expect(actual.first._tag).toBe("Failure");
		expect(actual.second).toBe("Recovered");
		expect(attempts).toBe(2);
	});
});
