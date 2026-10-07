import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createTestDatabase } from "../../test/database";
import { type PreparedView, RequestServices } from "../../request";
import type { RequestApi } from "../../server/api-client";
import type { RequestScope } from "../../server/request-context";
import { jsonResponse, testRequestApi } from "../wiki/test-api";
import {
	createFeedbackSource,
	markFeedbackReviewed,
	markSelectedFeedbackReviewed,
} from "./actions";

type Definition = {
	input: Schema.Decoder<unknown> | readonly Schema.Decoder<unknown>[];
	handler: (...input: never[]) => Effect.Effect<unknown, unknown, RequestServices>;
};
const definitions = vi.hoisted(() => new Map<unknown, Definition>());
vi.mock("@effront/core/workers", async () => {
	const { Effect } = await import("effect");
	return { getWorkersRequestContext: () => Effect.die("No Workers runtime in handler unit tests") };
});
vi.mock("../../effront", () => ({
	EFFRONT: {
		ServerFn: {
			make: (definition: Definition) => {
				const operation = () => undefined;
				definitions.set(operation, definition);
				return operation;
			},
		},
	},
}));
const workspace = { id: "workspace", slug: "team", name: "Team", role: "member" as const };
const project = {
	id: "project",
	key: "PROJ",
	name: "Project",
	slug: null,
	description: null,
	workspace_id: "workspace",
	workspace_name: "Team",
	workspace_slug: "team",
	open_issue_count: 0,
	backlog_issue_count: 0,
	archived_at: null,
	created_at: 1,
	updated_at: 1,
};
const scope: RequestScope = {
	user: { id: "user", name: "Alice", email: "alice@example.test" },
	workspaces: [workspace],
	projects: [project],
	selection: { kind: "project", workspace, project },
};
const databases: ReturnType<typeof createTestDatabase>[] = [];
afterEach(() => {
	for (const database of databases.splice(0)) database.close();
});
function fixture(origin = "https://app.test") {
	const database = createTestDatabase();
	databases.push(database);
	const reads: string[] = [];
	const writes: { path: string; mutation: Parameters<RequestApi["send"]>[1] }[] = [];
	const invalidate = vi.fn();
	const api = testRequestApi((outgoing) =>
		Effect.suspend(() => {
			const path = outgoing.url;
			if (outgoing.method === "GET") {
				reads.push(path);
				return jsonResponse(outgoing, []);
			}
			writes.push({
				path,
				mutation: {
					method: outgoing.method as Parameters<RequestApi["send"]>[1]["method"],
					workspaceSlug: outgoing.headers["x-workspace-slug"],
					...(outgoing.body._tag === "Uint8Array"
						? { json: JSON.parse(new TextDecoder().decode(outgoing.body.body)) }
						: {}),
				},
			});
			return jsonResponse(outgoing, { ok: true, id: "source", token: "secret-source-token" });
		}),
	);
	const request = new Request("https://app.test/_effront/function", {
		method: "POST",
		headers: { Origin: origin },
	});
	const services = {
		api,
		request,
		env: { API_BASE: "https://api.test", DB: database.db },
		db: database.db,
		url: new URL(request.url),
		scope: () => Effect.succeed(scope),
		prepare: (view: PreparedView) => view,
		invalidate: Effect.sync(invalidate),
	};
	function run(operation: unknown, input: unknown) {
		const definition = definitions.get(operation);
		if (!definition) throw new Error("Missing operation definition");
		const spread = Array.isArray(definition.input);
		const decoder = spread
			? Schema.Tuple(definition.input as readonly Schema.Decoder<unknown>[])
			: (definition.input as Schema.Decoder<unknown>);
		const encoded = operation === createFeedbackSource ? [null, new FormData()] : input;
		if (operation === createFeedbackSource && Array.isArray(encoded)) {
			const data = encoded[1] as FormData;
			for (const [key, value] of Object.entries(input as Record<string, string>))
				data.set(key, value);
		}
		return Effect.runPromise(
			Schema.decodeUnknownEffect(decoder)(encoded).pipe(
				Effect.flatMap((value) =>
					spread ? definition.handler(...(value as never[])) : definition.handler(value as never),
				),
				Effect.provideService(RequestServices, services),
			),
		);
	}
	return { run, reads, writes, invalidate };
}
describe("Feedback concrete ServerFn contracts", () => {
	it("parses original origins form and emits only known source configuration fields", async () => {
		const test = fixture();
		expect(
			await test.run(createFeedbackSource, {
				workspaceSlug: "team",
				projectId: "project",
				name: " Customers ",
				description: " Notes ",
				origins: "https://one.test\nhttps://two.test, ",
			}),
		).toEqual({ ok: true, value: { id: "source", token: "secret-source-token" } });
		expect(test.writes).toEqual([
			{
				path: "/api/projects/project/feedback-sources",
				mutation: {
					method: "POST",
					workspaceSlug: "team",
					json: {
						name: "Customers",
						description: "Notes",
						allowedOrigins: ["https://one.test", "https://two.test"],
					},
				},
			},
		]);
		expect(test.invalidate).toHaveBeenCalledTimes(1);
	});
	it("rejects an inaccessible explicit project before backend reads or writes", async () => {
		const test = fixture();
		expect(
			await test.run(markFeedbackReviewed, {
				workspaceSlug: "team",
				projectId: "other",
				feedbackId: "feedback",
			}),
		).toEqual({ ok: false, status: 404, message: expect.any(String) });
		expect(test.reads).toEqual([]);
	});
	it("rejects cross-origin Feedback mutations before any backend work", async () => {
		const test = fixture("https://attacker.test");
		expect(
			await test.run(markFeedbackReviewed, {
				workspaceSlug: "team",
				projectId: "project",
				feedbackId: "feedback",
			}),
		).toEqual({ ok: false, status: 403, message: expect.any(String) });
		expect(test.reads).toEqual([]);
		expect(test.writes).toEqual([]);
		expect(test.invalidate).toHaveBeenCalledTimes(1);
	});
	it("rejects empty/oversized bulk selections and oversized origins using actual input schemas", async () => {
		const test = fixture();
		for (const feedbackIds of [[], Array.from({ length: 501 }, (_, i) => String(i))])
			await expect(
				test.run(markSelectedFeedbackReviewed, {
					workspaceSlug: "team",
					projectId: "project",
					feedbackIds,
				}),
			).rejects.toThrow();
		await expect(
			test.run(createFeedbackSource, {
				workspaceSlug: "team",
				projectId: "project",
				name: "Source",
				description: "",
				origins: "x".repeat(2001),
			}),
		).rejects.toThrow();
		expect(test.writes).toEqual([]);
	});
});
