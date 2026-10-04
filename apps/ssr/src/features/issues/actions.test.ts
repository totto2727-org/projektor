import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";
import { makeRequestServices, RequestServices } from "../../request";
import {
	createIssue,
	deleteAttachment,
	readIssue,
	readIssuePage,
	searchIssues,
	updateIssue,
} from "./actions";
import { issue, project, scope, workspace } from "./test/fixtures";

// The framework invokes schema-validated definitions in its request runtime. Capture that
// boundary while exercising our real Effect HttpClient, authorization and fixed endpoints.
vi.mock("../../effront", () => ({
	EFFRONT: { ServerFn: { make: (definition: unknown) => ({ definition }) } },
}));
vi.mock("@effront/core/workers", async () => {
	const { Effect } = await import("effect");
	return {
		getWorkersRequestContext: () =>
			Effect.die("Worker context is supplied by this operation test."),
	};
});
interface Definition {
	readonly input: Schema.Decoder<unknown> | ReadonlyArray<Schema.Decoder<unknown>>;
	readonly handler: (
		...input: readonly unknown[]
	) => Effect.Effect<unknown, unknown, RequestServices>;
}
function fixture(
	options: { issueProject?: string; origin?: string; attachments?: readonly { id: string }[] } = {}
) {
	const invalidated = vi.fn();
	const requests: Request[] = [];
	const transport = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
		const request = new Request(input, init);
		requests.push(request);
		const url = new URL(request.url);
		if (url.pathname === "/auth/me")
			return Response.json({ user: scope.user, workspaces: scope.workspaces });
		if (url.pathname === "/api/projects") return Response.json(scope.projects);
		expect(request.headers.get("x-workspace-slug")).toBe(workspace.slug);
		if (url.pathname === "/api/issues/search") return Response.json([]);
		if (url.pathname === "/api/issues" && request.method === "GET")
			return Response.json({ items: [issue()], nextCursor: null, total: 1 });
		if (url.pathname === "/api/issues" && request.method === "POST")
			return Response.json({ id: "created", number: 2 });
		if (url.pathname === "/api/issues/issue-a" && request.method === "GET")
			return Response.json(issue({ project_id: options.issueProject ?? project.id }));
		if (url.pathname === "/api/issues/issue-a" && request.method === "PATCH")
			return Response.json({ ok: true });
		if (url.pathname === "/api/files" && request.method === "GET")
			return Response.json(options.attachments ?? []);
		throw new Error(`Unexpected issue operation request ${request.method} ${url.pathname}`);
	});
	async function invoke(action: unknown, input: unknown) {
		const definition = (action as { definition: Definition }).definition;
		const multiple = Array.isArray(definition.input);
		const inputSchema = multiple
			? Schema.Tuple(definition.input as ReadonlyArray<Schema.Decoder<unknown>>)
			: (definition.input as Schema.Decoder<unknown>);
		const decoded = await Effect.runPromise(Schema.decodeUnknownEffect(inputSchema)(input));
		const request = new Request("https://front.test/_effront/query", {
			method: "POST",
			headers: {
				authorization: "Bearer authenticated-user",
				origin: options.origin ?? "https://front.test",
			},
		});
		const services = await Effect.runPromise(
			makeRequestServices(request, { API_BASE: "https://api.test" }).pipe(
				Effect.provide(FetchHttpClient.layer),
				Effect.provideService(FetchHttpClient.Fetch, transport)
			)
		);
		return Effect.runPromise(
			definition.handler(...(multiple ? (decoded as readonly unknown[]) : [decoded])).pipe(
				Effect.provideService(RequestServices, {
					...services,
					invalidate: services.invalidate.pipe(Effect.tap(() => Effect.sync(invalidated))),
				}),
				Effect.provide(FetchHttpClient.layer),
				Effect.provideService(FetchHttpClient.Fetch, transport)
			)
		);
	}
	return { invoke, requests, invalidated };
}

describe("individual issue ServerFn authorization and contracts", () => {
	it("resolves an entity in the explicit workspace and checks its authorized catalog project", async () => {
		const valid = fixture();
		expect(
			await valid.invoke(readIssue, { workspaceSlug: workspace.slug, issueId: "issue-a" })
		).toMatchObject({ ok: true, value: { id: "issue-a", workspaceSlug: workspace.slug } });
		expect(valid.invalidated).not.toHaveBeenCalled();
		const hidden = fixture({ issueProject: "not-in-catalog" });
		expect(
			await hidden.invoke(updateIssue, {
				workspaceSlug: workspace.slug,
				issueId: "issue-a",
				patch: { title: "Changed" },
			})
		).toMatchObject({ ok: false, status: 404 });
		expect(hidden.requests.some((request) => request.method === "PATCH")).toBe(false);
		expect(hidden.invalidated).toHaveBeenCalledOnce();
	});
	it("builds project list and search contracts on the server, without query refresh", async () => {
		const { invoke, requests, invalidated } = fixture();
		await invoke(readIssuePage, {
			workspaceSlug: workspace.slug,
			projectId: project.id,
			limit: 30,
			cursor: "next",
		});
		await invoke(searchIssues, {
			workspaceSlug: workspace.slug,
			projectId: project.id,
			query: "term",
		});
		const list = new URL(
			requests.find((request) => new URL(request.url).pathname === "/api/issues")?.url ??
				"https://missing.test"
		);
		const search = new URL(
			requests.find((request) => new URL(request.url).pathname === "/api/issues/search")?.url ??
				"https://missing.test"
		);
		expect(list.searchParams.get("project")).toBe(project.id);
		expect(list.searchParams.has("projectId")).toBe(false);
		expect(list.searchParams.get("cursor")).toBe("next");
		expect(search.searchParams.get("projectId")).toBe(project.id);
		expect(search.searchParams.get("q")).toBe("term");
		expect(invalidated).not.toHaveBeenCalled();
	});
	it("rejects cross-origin writes before any backend read and invalidates expected failures", async () => {
		const { invoke, requests, invalidated } = fixture({ origin: "https://evil.test" });
		const data = new FormData();
		data.set("workspaceSlug", workspace.slug);
		data.set("projectId", project.id);
		data.set("title", "Created");
		expect(await invoke(createIssue, [null, data])).toMatchObject({ ok: false, status: 403 });
		expect(requests).toHaveLength(0);
		expect(invalidated).toHaveBeenCalledOnce();
	});
	it("sends only schema-selected issue fields to the fixed mutation endpoint", async () => {
		const native = fixture();
		const formData = new FormData();
		formData.set("workspaceSlug", workspace.slug);
		formData.set("projectId", project.id);
		formData.set("title", "  Created natively  ");
		formData.set("priority", "medium");
		formData.set("method", "DELETE");
		formData.set("path", "/api/workspaces/other");
		expect(await native.invoke(createIssue, [null, formData])).toMatchObject({ ok: true });
		const nativeWrite = native.requests.find((request) => request.method === "POST");
		expect(new URL(nativeWrite?.url ?? "https://missing.test").pathname).toBe("/api/issues");
		expect(await nativeWrite?.json()).toEqual({
			projectId: project.id,
			title: "Created natively",
			priority: "medium",
		});
		expect(native.invalidated).toHaveBeenCalledOnce();
		const { invoke, requests, invalidated } = fixture();
		expect(
			await invoke(updateIssue, {
				workspaceSlug: workspace.slug,
				issueId: "issue-a",
				patch: { title: "Changed", path: "/api/workspaces/other" },
				method: "DELETE",
			})
		).toMatchObject({ ok: true });
		const write = requests.find((request) => request.method === "PATCH");
		expect(new URL(write?.url ?? "https://missing.test").pathname).toBe("/api/issues/issue-a");
		expect(await write?.json()).toEqual({ title: "Changed" });
		expect(invalidated).toHaveBeenCalledOnce();
	});
	it("will not delete an attachment absent from the issue's server-loaded attachment set", async () => {
		const { invoke, requests } = fixture();
		expect(
			await invoke(deleteAttachment, {
				workspaceSlug: workspace.slug,
				issueId: "issue-a",
				attachmentId: "foreign-attachment",
			})
		).toMatchObject({ ok: false, status: 404 });
		expect(requests.some((request) => request.method === "DELETE")).toBe(false);
	});
});
