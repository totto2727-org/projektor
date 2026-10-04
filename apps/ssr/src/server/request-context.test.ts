import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";
import { HttpClientLive } from "../http-client-layer";
import { createRequestApi } from "./api-client";
import {
	type AuthSession,
	decodeAuthSession,
	decodeProjectCatalog,
	loadRequestScope,
	type ProjectSummary,
	readProjectHint,
	resolveScope,
} from "./request-context";

const session: AuthSession = {
	user: { id: "user-a", email: "a@example.test", name: "A" },
	workspaces: [
		{ id: "workspace-a", slug: "alpha", name: "Alpha", role: "member" },
		{ id: "workspace-b", slug: "beta", name: "Beta", role: "viewer" },
	],
};

const project: ProjectSummary = {
	id: "project-a",
	key: "ALPHA",
	slug: "alpha-project",
	name: "Project A",
	description: null,
	workspace_id: "workspace-a",
	workspace_slug: "alpha",
	workspace_name: "Alpha",
	open_issue_count: 3,
	backlog_issue_count: 1,
	archived_at: null,
	created_at: 1,
	updated_at: 2,
};
const otherProject: ProjectSummary = {
	...project,
	id: "project-b",
	key: "BETA",
	slug: "beta-project",
	workspace_id: "workspace-b",
	workspace_slug: "beta",
	workspace_name: "Beta",
};
const projects = [project, otherProject];
const page = (path: string) => new URL(path, "https://front.example.test");

describe("request scope selection", () => {
	it.each(["/", "/my-issues", "/settings/groups", "/settings/tokens"])(
		"does not require a project or choose a default tenant on %s",
		(path) => {
			expect(resolveScope(session, projects, page(path)).selection).toEqual({ kind: "global" });
		}
	);

	it.each(["project-a", "ALPHA", "alpha-project"])(
		"resolves explicit project %s from its authenticated catalog",
		(hint) => {
			expect(resolveScope(session, projects, page(`/issues?projectId=${hint}`)).selection).toEqual({
				kind: "project",
				project,
				workspace: session.workspaces[0],
			});
		}
	);

	it("uses a membership-only workspace without needing a project", () => {
		expect(
			resolveScope(session, projects, page("/settings/groups?workspace=beta"), {
				requireWorkspace: true,
			}).selection
		).toEqual({
			kind: "workspace",
			workspace: session.workspaces[1],
		});
	});

	it("does not pick the first of multiple workspaces or projects", () => {
		expect(
			resolveScope(session, projects, page("/settings/groups"), { requireWorkspace: true })
				.selection
		).toEqual({
			kind: "selection-required",
			target: "workspace",
			reason: "ambiguous",
		});
		expect(
			resolveScope(session, projects, page("/projects/view"), { requireProject: true }).selection
		).toEqual({
			kind: "selection-required",
			target: "project",
			reason: "ambiguous",
		});
	});

	it("distinguishes empty selection from ambiguity", () => {
		const noMemberships = { ...session, workspaces: [] };
		expect(
			resolveScope(noMemberships, [], page("/settings/groups"), { requireWorkspace: true })
				.selection
		).toEqual({
			kind: "selection-required",
			target: "workspace",
			reason: "empty",
		});
		expect(
			resolveScope(noMemberships, [], page("/issues"), { requireProject: true }).selection
		).toEqual({
			kind: "selection-required",
			target: "project",
			reason: "empty",
		});
	});

	it("selects a unique required project, but not for a global page", () => {
		expect(
			resolveScope(session, [project], page("/projects/view"), { requireProject: true }).selection
		).toMatchObject({ kind: "project", project });
		expect(resolveScope(session, [project], page("/")).selection).toEqual({ kind: "global" });
	});

	it("fails closed on unknown workspace or contradictory project/workspace", () => {
		expect(() =>
			resolveScope(session, projects, page("/settings/groups?workspace=missing"))
		).toThrow("Selected workspace is not accessible.");
		expect(() =>
			resolveScope(session, projects, page("/issues?projectId=project-a&workspace=beta"))
		).toThrow("Selected project is not accessible.");
	});

	it("does not trust a catalog project without the matching current membership", () => {
		expect(() =>
			resolveScope({ ...session, workspaces: [] }, projects, page("/issues?projectId=project-a"))
		).toThrow("Selected project is not accessible.");
	});

	it("requires selection when project keys collide across workspaces", () => {
		const collision = { ...otherProject, key: "ALPHA" };
		expect(
			resolveScope(session, [project, collision], page("/issues?project=ALPHA")).selection
		).toEqual({
			kind: "selection-required",
			target: "project",
			reason: "ambiguous",
		});
		expect(
			resolveScope(session, [project, collision], page("/issues?project=ALPHA&workspace=beta"))
				.selection
		).toMatchObject({ kind: "project", project: collision });
	});

	it.each(["/issues/view?id=entity", "/wiki/view?id=entity", "/feedback/view?id=entity"])(
		"does not reinterpret entity id on %s as a project",
		(path) => {
			expect(readProjectHint(page(path))).toBeUndefined();
		}
	);

	it("reads legacy query ids and accepts project identity supplied by the framework route", () => {
		expect(readProjectHint(page("/projects/view?id=project-a"))).toBe("project-a");
		expect(readProjectHint(page("/projects/view/alpha-project/"))).toBeUndefined();
		expect(
			resolveScope(session, projects, page("/projects/view/alpha-project"), {
				projectHint: "alpha-project",
			}).selection
		).toMatchObject({ kind: "project", project });
		expect(readProjectHint(page("/projects/alpha-project/issues/12/title"))).toBeUndefined();
	});

	it("rejects conflicting repeated hints without parsing path encoding again", () => {
		expect(() => readProjectHint(page("/issues?projectId=a&projectId=b"))).toThrow(
			"Ambiguous projectId parameter."
		);
		expect(readProjectHint(page("/projects/%E0%A4/issues/12/title"))).toBeUndefined();
	});
});

describe("server scope loading", () => {
	it("loads authenticated global data server-side without an inherited workspace header", async () => {
		const transport = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
			expect(new Headers(init?.headers).get("x-workspace-slug")).toBeNull();
			return Response.json(String(input).endsWith("/auth/me") ? session : projects);
		});
		const request = new Request(page("/issues?projectId=project-a"), {
			headers: { authorization: "Bearer caller", "x-workspace-slug": "unrelated" },
		});
		const scope = await Effect.runPromise(
			createRequestApi(request, { apiBaseUrl: "https://api.example.test" }).pipe(
				Effect.flatMap((api) => loadRequestScope(api, new URL(request.url))),
				Effect.provide(HttpClientLive),
				Effect.provideService(FetchHttpClient.Fetch, transport)
			)
		);
		expect(scope.selection).toMatchObject({ kind: "project", project });
		expect(transport).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(scope)).not.toContain("Bearer caller");
	});

	it("retries archived catalog exactly once for a missing explicit project", async () => {
		const archived = { ...project, archived_at: 42 };
		const transport = vi.fn<typeof fetch>().mockImplementation(async (input) => {
			const url = new URL(String(input));
			return Response.json(url.pathname === "/auth/me" ? session : url.search ? [archived] : []);
		});
		const scope = await Effect.runPromise(
			createRequestApi(new Request(page("/")), { apiBaseUrl: "https://api.example.test" }).pipe(
				Effect.flatMap((api) => loadRequestScope(api, page("/issues?projectId=project-a"))),
				Effect.provide(HttpClientLive),
				Effect.provideService(FetchHttpClient.Fetch, transport)
			)
		);
		expect(scope.selection).toMatchObject({ kind: "project", project: archived });
		expect(transport).toHaveBeenCalledTimes(3);
	});

	it.each(["/auth/me", "/api/projects", "/api/projects?includeArchived=true"])(
		"rejects malformed HTTP data at %s with a typed schema failure",
		async (invalidPath) => {
			const transport = vi.fn<typeof fetch>().mockImplementation(async (input) => {
				const url = new URL(String(input));
				const path = `${url.pathname}${url.search}`;
				return Response.json(
					path === invalidPath ? { malformed: true } : url.pathname === "/auth/me" ? session : []
				);
			});
			await expect(
				Effect.runPromise(
					createRequestApi(new Request(page("/")), { apiBaseUrl: "https://api.example.test" }).pipe(
						Effect.flatMap((api) => loadRequestScope(api, page("/issues?projectId=project-a"))),
						Effect.provide(HttpClientLive),
						Effect.provideService(FetchHttpClient.Fetch, transport)
					)
				)
			).rejects.toMatchObject({ _tag: "ApiError", kind: "schema", status: 502 });
		}
	);

	it("rejects weak/malformed membership and project payloads instead of casting them", () => {
		expect(() =>
			decodeAuthSession({ user: session.user, workspaces: [{ slug: "alpha", role: "owner" }] })
		).toThrow();
		expect(() => decodeProjectCatalog([{ ...project, workspace_slug: null }])).toThrow();
	});
});
