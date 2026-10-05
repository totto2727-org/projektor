import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { afterEach, vi } from "vite-plus/test";
import { createTestDatabase } from "../../test/database";
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
const databases: ReturnType<typeof createTestDatabase>[] = [];
afterEach(() => {
	for (const database of databases.splice(0)) database.close();
});

/** Shared page/action fixtures execute every read against the fully migrated real schema. */
export function featureDatabase() {
	const database = createTestDatabase();
	databases.push(database);
	database.sqlite.exec(`
		INSERT INTO users (id,email,name,created_at) VALUES ('u1','owner@example.test','Owner',1);
		INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w1','Alpha','alpha',1), ('w2','Beta','beta',1);
		INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',1);
		INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES
			('p1','w1','Project','PROJ','project',1,1), ('other','w1','Other','OTHER','other',1,1),
			('foreign','w2','Foreign','FOREIGN','foreign',1,1);
		INSERT INTO sprints (id,workspace_id,project_id,name,status,created_at,updated_at) VALUES
			('s1','w1','p1','Sprint','planned',1,1), ('s2','w1','p1','Next sprint','planned',2,2),
			('foreign-sprint','w2','foreign','Private sprint','planned',1,1);
	`);
	return database;
}

export function actionFixture(
	resolve: (url: URL, options?: RequestInit) => unknown,
	origin = "https://front.example",
) {
	const database = featureDatabase();
	const invalidated = vi.fn();
	const transport = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
		const url = new URL(input instanceof Request ? input.url : input.toString());
		if (url.pathname === "/auth/me")
			return Response.json({
				user: { id: "u1", name: "Owner", email: "owner@example.test" },
				workspaces: [workspace],
			});

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
						headers: { cookie: "CF_Authorization=actual-user", origin },
					}),
					{ API_BASE: "https://api.example", DB: database.db },
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
					}),
				);
			}).pipe(
				Effect.provide(FetchHttpClient.layer),
				Effect.provideService(FetchHttpClient.Fetch, transport),
			),
		);
	}
	return { invoke, transport, invalidated, ...database };
}

/** Native action test boundary uses the browser's actual submitted fields. */
export function formData(values: Record<string, string | number>) {
	const data = new FormData();
	for (const [name, value] of Object.entries(values)) data.set(name, String(value));
	return data;
}
