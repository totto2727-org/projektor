import { Cause, Effect, Exit } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";
import { HttpClientLive } from "../http-client-layer";
import { makeRequestServices, RequestServices } from "../request";
import {
	type FunctionOptions,
	type FunctionSelector,
	resolveFunctionContext,
} from "./function-context";
import type { AuthSession, ProjectSummary } from "./request-context";

vi.mock("@effront/core/workers", async () => {
	const { Effect } = await import("effect");
	return {
		getWorkersRequestContext: () =>
			Effect.die("Host context is not used by request-factory tests."),
	};
});

const session: AuthSession = {
	user: { id: "user-a", email: "a@example.test", name: "A" },
	workspaces: [
		{ id: "workspace-a", slug: "alpha", name: "Alpha", role: "member" },
		{ id: "workspace-b", slug: "beta", name: "Beta", role: "viewer" },
	],
};
const project: ProjectSummary = {
	id: "project-a",
	name: "Project A",
	key: "ALPHA",
	slug: "alpha-project",
	description: null,
	workspace_id: "workspace-a",
	workspace_name: "Alpha",
	workspace_slug: "alpha",
	open_issue_count: 0,
	backlog_issue_count: 0,
	archived_at: null,
	created_at: 1,
	updated_at: 2,
};

function fixture(
	path = "/_effront/query",
	auth: AuthSession = session,
	catalog: readonly ProjectSummary[] = [project]
) {
	const invalidated = vi.fn();
	const transport = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
		const incoming = new Request(input, init);
		expect(incoming.headers.get("authorization")).toBe("Bearer actual-user");
		expect(incoming.headers.get("x-workspace-slug")).toBeNull();
		return Response.json(new URL(incoming.url).pathname === "/auth/me" ? auth : catalog);
	});
	function run<A, E>(operation: Effect.Effect<A, E, RequestServices>) {
		return Effect.runPromise(
			Effect.gen(function* () {
				const request = new Request(`https://front.example.test${path}`, {
					method: "POST",
					headers: { authorization: "Bearer actual-user", origin: "https://front.example.test" },
				});
				const services = yield* makeRequestServices(request, {
					API_BASE: "https://api.example.test",
				});
				return yield* operation.pipe(
					Effect.provideService(RequestServices, {
						...services,
						invalidate: services.invalidate.pipe(Effect.tap(() => Effect.sync(invalidated))),
					})
				);
			}).pipe(
				Effect.provide(HttpClientLive),
				Effect.provideService(FetchHttpClient.Fetch, transport)
			)
		);
	}
	return { run, transport, invalidated };
}

describe("independent ServerFn authentication and semantic selection", () => {
	it("resolves a workspace query without a page URL or inferred project", async () => {
		const { run, invalidated, transport } = fixture();
		const context = await run(
			resolveFunctionContext({ workspaceSlug: "alpha" }, { requireWorkspace: true })
		);
		expect(context.workspaceSlug).toBe("alpha");
		expect(context.projectId).toBeUndefined();
		expect(context.scope.selection.kind).toBe("workspace");
		expect(transport).toHaveBeenCalledTimes(2);
		expect(invalidated).not.toHaveBeenCalled();
	});

	it("uses an explicit project ID to derive its authenticated workspace", async () => {
		const { run } = fixture();
		const context = await run(
			resolveFunctionContext(
				{ projectId: "project-a" },
				{ requireProject: true, requireWorkspace: true }
			)
		);
		expect(context.workspaceSlug).toBe("alpha");
		expect(context.projectId).toBe("project-a");
	});

	it("does not inherit workspace/project hints from the invoking page", async () => {
		const { run } = fixture("/issues?workspace=alpha&projectId=project-a");
		const context = await run(resolveFunctionContext({}));
		expect(context.scope.selection).toEqual({ kind: "global" });
		expect(context.workspaceSlug).toBeUndefined();
		expect(context.projectId).toBeUndefined();
	});

	it("lets explicit workspace selection replace unrelated page context", async () => {
		const { run } = fixture("/issues?workspace=alpha&projectId=project-a");
		const context = await run(
			resolveFunctionContext({ workspaceSlug: "beta" }, { requireWorkspace: true })
		);
		expect(context.workspaceSlug).toBe("beta");
		expect(context.projectId).toBeUndefined();
	});

	it.each([
		[{ requireWorkspace: true }, "Select a workspace for this operation."],
		[{ requireProject: true }, "Select a project for this operation."],
	] satisfies readonly (readonly [FunctionOptions, string])[])(
		"rejects missing explicit selectors even with a unique catalog: %o",
		async (options, message) => {
			const { run } = fixture("/_effront/query", {
				...session,
				workspaces: [session.workspaces[0]],
			});
			await expect(run(resolveFunctionContext({}, options))).rejects.toMatchObject({
				_tag: "ScopeError",
				status: 400,
				message,
			});
		}
	);

	it.each([{ workspaceSlug: "" }, { projectId: "" }] satisfies readonly FunctionSelector[])(
		"rejects malformed semantic selection: %o",
		async (selector) => {
			const { run, transport } = fixture();
			await expect(run(resolveFunctionContext(selector))).rejects.toMatchObject({
				_tag: "ScopeError",
				status: 400,
			});
			expect(transport).not.toHaveBeenCalled();
		}
	);

	it("rejects a workspace outside current membership", async () => {
		const { run } = fixture();
		await expect(run(resolveFunctionContext({ workspaceSlug: "missing" }))).rejects.toMatchObject({
			_tag: "ScopeError",
			status: 403,
		});
	});

	it("rejects contradictory workspace/project selection", async () => {
		const { run } = fixture();
		await expect(
			run(resolveFunctionContext({ workspaceSlug: "beta", projectId: "project-a" }))
		).rejects.toMatchObject({ _tag: "ScopeError", status: 404 });
	});

	it("requires actual project IDs, not a matching key or slug alias", async () => {
		const { run } = fixture();
		await expect(run(resolveFunctionContext({ projectId: "ALPHA" }))).rejects.toMatchObject({
			_tag: "ScopeError",
			status: 404,
		});
	});

	it("rejects catalog entities whose membership has been revoked", async () => {
		const { run } = fixture("/_effront/query", { ...session, workspaces: [] });
		await expect(run(resolveFunctionContext({ projectId: "project-a" }))).rejects.toMatchObject({
			_tag: "ScopeError",
			status: 403,
		});
	});

	it("preserves typed authentication failures and never invalidates during resolution", async () => {
		const { run, transport, invalidated } = fixture();
		transport.mockImplementation(async () => new Response("private failure", { status: 401 }));
		await expect(run(resolveFunctionContext({}))).rejects.toMatchObject({
			_tag: "ApiError",
			status: 401,
		});
		expect(invalidated).not.toHaveBeenCalled();
	});

	it("does not catch defects or transform interruption into a result abstraction", async () => {
		const { run } = fixture();
		const failure = new Error("programmer defect");
		const defect = await run(
			Effect.gen(function* () {
				const services = yield* RequestServices;
				return yield* resolveFunctionContext({}).pipe(
					Effect.provideService(RequestServices, { ...services, scope: () => Effect.die(failure) }),
					Effect.exit
				);
			})
		);
		expect(Exit.isFailure(defect) && Cause.hasDies(defect.cause)).toBe(true);
		const interrupted = await run(
			Effect.gen(function* () {
				const services = yield* RequestServices;
				return yield* resolveFunctionContext({}).pipe(
					Effect.provideService(RequestServices, { ...services, scope: () => Effect.interrupt }),
					Effect.exit
				);
			})
		);
		expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBe(true);
	});
});
