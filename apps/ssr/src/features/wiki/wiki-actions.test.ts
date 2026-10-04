import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { type PreparedView, RequestServices } from "../../request";
import type { RequestApi } from "../../server/api-client";
import { ApiError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
import { createWikiPage, duplicateWikiPage, getWikiDraft, saveWikiPage } from "./actions";
import { jsonResponse, testRequestApi } from "./test-api";

type Definition = {
	input: Schema.Decoder<unknown>;
	handler: (input: never) => Effect.Effect<unknown, unknown, RequestServices>;
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
const scope: RequestScope = {
	user: { id: "user", name: "Alice", email: "alice@example.test" },
	workspaces: [workspace],
	projects: [],
	selection: { kind: "workspace", workspace },
};
const page = {
	id: "page",
	slug: "guide",
	title: "Guide",
	content: "Body",
	revisionId: "revision",
	project_id: null,
	parent_id: null,
	updated_at: 1,
	type: null,
	tags: [],
	status: null,
	verified_at: null,
	verified_by: null,
	owners: [],
	verify_interval: null,
	freshness: null,
};
function fixture(options: { origin?: string; writeFailure?: ApiError; pageProject?: string } = {}) {
	const reads: string[] = [];
	const writes: { path: string; mutation: Parameters<RequestApi["send"]>[1] }[] = [];
	const invalidate = vi.fn();
	const api = testRequestApi((outgoing) =>
		Effect.suspend(() => {
			const path = outgoing.url;
			if (outgoing.method === "GET") {
				reads.push(path);
				return jsonResponse(
					outgoing,
					path.endsWith("/draft") ? null : { ...page, project_id: options.pageProject ?? null }
				);
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
			return options.writeFailure
				? Effect.fail(options.writeFailure)
				: jsonResponse(
						outgoing,
						path === "/api/wiki" ? { id: "copy", slug: "guide-copy" } : { ok: true }
					);
		})
	);
	const request = new Request("https://app.test/_effront/function", {
		method: "POST",
		headers: { Origin: options.origin ?? "https://app.test" },
	});
	const services = {
		api,
		request,
		env: { API_BASE: "https://api.test" },
		url: new URL(request.url),
		scope: () => Effect.succeed(scope),
		prepare: (view: PreparedView) => view,
		invalidate: Effect.sync(invalidate),
	};
	function run(operation: unknown, input: unknown) {
		const definition = definitions.get(operation);
		if (!definition) throw new Error("Missing operation definition");
		return Effect.runPromise(
			Schema.decodeUnknownEffect(definition.input)(input).pipe(
				Effect.flatMap((value) => definition.handler(value as never)),
				Effect.provideService(RequestServices, services)
			)
		);
	}
	return { run, reads, writes, invalidate };
}
describe("Wiki semantic ServerFn contracts", () => {
	it("rejects cross-origin writes before any backend request and invalidates failed mutation scope", async () => {
		const test = fixture({ origin: "https://attacker.test" });
		expect(
			await test.run(saveWikiPage, {
				workspaceSlug: "team",
				slug: "guide",
				title: "Draft",
				content: "Body",
				baseRevisionId: "revision",
			})
		).toEqual({ ok: false, status: 403, message: expect.any(String) });
		expect(test.writes).toEqual([]);
		expect(test.invalidate).toHaveBeenCalledTimes(1);
	});
	it("rejects an unauthorized workspace before constructing a backend mutation", async () => {
		const test = fixture();
		expect(
			await test.run(saveWikiPage, {
				workspaceSlug: "other",
				slug: "guide",
				title: "Draft",
				content: "Body",
			})
		).toEqual({ ok: false, status: 403, message: expect.any(String) });
		expect(test.writes).toEqual([]);
	});
	it("keeps expected409 conflicts typed and does not clear an unseen draft after failed save", async () => {
		const test = fixture({ writeFailure: new ApiError("http", 409, "Concurrent edit") });
		expect(
			await test.run(saveWikiPage, {
				workspaceSlug: "team",
				slug: "guide",
				title: "My title",
				content: "Mine",
				baseRevisionId: "revision",
			})
		).toEqual({ ok: false, status: 409, message: "Concurrent edit" });
		expect(test.writes).toHaveLength(1);
		expect(test.writes[0].mutation.json).toEqual({
			title: "My title",
			content: "Mine",
			baseRevisionId: "revision",
		});
	});
	it("reads a draft without invalidating and resolves the explicit authorized workspace", async () => {
		const test = fixture();
		expect(await test.run(getWikiDraft, { workspaceSlug: "team", slug: "guide" })).toEqual({
			ok: true,
			value: null,
		});
		expect(test.reads).toEqual(["/api/wiki/guide/draft"]);
		expect(test.invalidate).not.toHaveBeenCalled();
	});
	it("duplicates server-authorized content and preserves the source entity project", async () => {
		const test = fixture({ pageProject: "source-project" });
		expect(await test.run(duplicateWikiPage, { workspaceSlug: "team", slug: "guide" })).toEqual({
			ok: true,
			value: { id: "copy", slug: "guide-copy" },
		});
		expect(test.writes[0].mutation.json).toEqual(
			expect.objectContaining({
				title: "Guide (copy)",
				content: "Body",
				projectId: "source-project",
			})
		);
		expect(test.writes[0].mutation.json).not.toHaveProperty("parentId");
	});
	it("rejects mutually-exclusive template/content before reaching the request handler", async () => {
		const test = fixture();
		await expect(
			test.run(createWikiPage, {
				workspaceSlug: "team",
				title: "Guide",
				slug: "guide",
				content: "Body",
				templateSlug: "template",
			})
		).rejects.toThrow();
		expect(test.writes).toEqual([]);
	});
});
