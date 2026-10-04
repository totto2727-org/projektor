import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { vi } from "vitest";
import { makeRequestServices, RequestServices } from "../../request";

type InputSchema = Schema.Constraint & Schema.Decoder<unknown>;
interface Definition {
	input: InputSchema | readonly InputSchema[];
	handler: (...input: unknown[]) => Effect.Effect<unknown, unknown, RequestServices>;
}
const definitions = vi.hoisted(() => new WeakMap<object, Definition>());
/** Capture only the framework registration. The real schemas, handlers, resolver and HTTP adapter run. */
vi.mock("../../effront", () => ({
	EFFRONT: {
		ServerFn: {
			make: (definition: Definition) => {
				const callable = () =>
					Promise.reject(new Error("Use the maintained action test boundary."));
				definitions.set(callable, definition);
				return callable;
			},
		},
	},
}));
vi.mock("@effront/core/workers", async () => {
	const { Effect } = await import("effect");
	return {
		getWorkersRequestContext: () => Effect.die("Host context is not used by feature action tests."),
	};
});
const workspace = { id: "w1", slug: "alpha", name: "Alpha", role: "owner" };
const project = {
	id: "p1",
	name: "Project",
	key: "PROJ",
	slug: "project",
	description: null,
	workspace_id: "w1",
	workspace_name: "Alpha",
	workspace_slug: "alpha",
	open_issue_count: 0,
	backlog_issue_count: 0,
	archived_at: null,
	created_at: 1,
	updated_at: 1,
};
export function actionFixture(
	resolve: (url: URL, options?: RequestInit) => unknown | Promise<unknown>,
	origin = "https://front.example"
) {
	const invalidated = vi.fn();
	const transport = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
		const url = new URL(String(input));
		if (url.pathname === "/auth/me")
			return Response.json({
				user: { id: "u1", name: "Owner", email: "owner@example.test" },
				workspaces: [workspace],
			});
		if (url.pathname === "/api/projects" && (options?.method ?? "GET") === "GET")
			return Response.json([project]);
		const value = await resolve(url, options);
		return value instanceof Response ? value : Response.json(value);
	});
	function invoke<Input extends unknown[], Output>(
		operation: (...input: Input) => Promise<Output>,
		...input: Input
	) {
		const definition = definitions.get(operation);
		if (!definition) throw new Error("Unregistered feature ServerFn.");
		return Effect.runPromise(
			Effect.gen(function* () {
				const services = yield* makeRequestServices(
					new Request("https://front.example/_effront/functions", {
						method: "POST",
						headers: { authorization: "Bearer actual-user", origin },
					}),
					{ API_BASE: "https://api.example" }
				);
				const spread = Array.isArray(definition.input);
				const schema = spread
					? Schema.Tuple(definition.input as InputSchema[])
					: (definition.input as InputSchema);
				const value = yield* Schema.decodeUnknownEffect(schema)(spread ? input : input[0]);
				return yield* (
					spread ? definition.handler(...(value as unknown[])) : definition.handler(value)
				).pipe(
					Effect.provideService(RequestServices, {
						...services,
						invalidate: services.invalidate.pipe(Effect.tap(() => Effect.sync(invalidated))),
					})
				);
			}).pipe(
				Effect.provide(FetchHttpClient.layer),
				Effect.provideService(FetchHttpClient.Fetch, transport)
			)
		);
	}
	return { invoke, transport, invalidated };
}

/** Native action test boundary uses the browser's actual submitted fields. */
export function formData(values: Record<string, string | number>) {
	const data = new FormData();
	for (const [name, value] of Object.entries(values)) data.set(name, String(value));
	return data;
}
