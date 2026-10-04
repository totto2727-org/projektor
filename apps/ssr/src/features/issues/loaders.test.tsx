import { Effect } from "effect";
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApiReadOptions, RequestApi } from "../../server/api-client";
import { ApiError } from "../../server/errors";
import {
	filteredIssueQuery,
	loadEpics as loadEpicsEffect,
	loadIssue as loadIssueEffect,
	loadIssues as loadIssuesEffect,
	loadMyIssues as loadMyIssuesEffect,
	renderIssue as renderIssueEffect,
	renderIssues as renderIssuesEffect,
} from "./server";
import {
	comment,
	issue,
	project,
	scope,
	secondProject,
	statuses,
	taskTypes,
	workspace,
} from "./test/fixtures";

const loadIssues = (...args: Parameters<typeof loadIssuesEffect>) =>
	Effect.runPromise(loadIssuesEffect(...args));
const loadIssue = (...args: Parameters<typeof loadIssueEffect>) =>
	Effect.runPromise(loadIssueEffect(...args));
const loadMyIssues = (...args: Parameters<typeof loadMyIssuesEffect>) =>
	Effect.runPromise(loadMyIssuesEffect(...args));
const loadEpics = (...args: Parameters<typeof loadEpicsEffect>) =>
	Effect.runPromise(loadEpicsEffect(...args));
const renderIssues = (...args: Parameters<typeof renderIssuesEffect>) =>
	Effect.runPromise(renderIssuesEffect(...args));
const renderIssue = (...args: Parameters<typeof renderIssueEffect>) =>
	Effect.runPromise(renderIssueEffect(...args));
vi.mock("../../attachment-actions", () => ({
	uploadAttachment: vi.fn(),
	uploadInlineImage: vi.fn(),
}));
vi.mock("./actions", () => ({
	createIssue: vi.fn(),
	updateIssue: vi.fn(),
	readIssue: vi.fn(),
	readIssuePage: vi.fn(),
	searchIssues: vi.fn(),
	readComments: vi.fn(),
	addComment: vi.fn(),
	editComment: vi.fn(),
	deleteComment: vi.fn(),
	readLinks: vi.fn(),
	addIssueLink: vi.fn(),
	deleteIssueLink: vi.fn(),
	shareIssue: vi.fn(),
	readAttachments: vi.fn(),
	addAttachmentLink: vi.fn(),
	deleteAttachment: vi.fn(),
	searchWikiAttachments: vi.fn(),
	updateSprint: vi.fn(),
}));
function apiFixture(resolve?: (path: string, options?: ApiReadOptions) => unknown) {
	const calls: Array<{ path: string; workspaceSlug?: string }> = [];
	const api: RequestApi = {
		get(path, options = {}) {
			return HttpClientRequest.get(path).pipe(
				HttpClientRequest.setHeader("x-workspace-slug", options.workspaceSlug ?? "")
			);
		},
		send(path, options) {
			return HttpClientRequest.make(options.method)(path);
		},
		raw(path) {
			return HttpClientRequest.get(path);
		},
		execute(request) {
			return Effect.suspend(() => {
				if (request.method !== "GET")
					return Effect.fail(new ApiError("request", 500, "SSR loaders must not mutate"));
				const path = request.url;
				const options = { workspaceSlug: request.headers["x-workspace-slug"] };
				calls.push({ path, workspaceSlug: options?.workspaceSlug });
				let value = resolve?.(path, options);
				if (value === undefined) {
					if (path === "/api/task-statuses") value = statuses;
					else if (path === "/api/task-types") value = taskTypes;
					else if (path.startsWith("/api/sprints?")) value = { items: [] };
					else if (path.endsWith("/comments")) value = [comment];
					else if (path.endsWith("/links")) value = [];
					else if (path.startsWith("/api/files?"))
						value = [
							{
								id: "file-a",
								kind: "url",
								filename: "Reference",
								contentType: "text/uri-list",
								size: 0,
								createdAt: 1,
								url: "https://example.test/reference",
								wikiPage: null,
							},
						];
					else if (path.startsWith("/api/workspaces/")) value = { members: [scope.user] };
					else if (path.startsWith("/api/issues?"))
						value = { items: [issue()], nextCursor: null, total: 1 };
					else if (path.startsWith("/api/issues/")) value = issue();
					else throw new Error(`Unexpected read ${path}`);
				}
				return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(value)));
			});
		},
	};
	return { api, calls };
}
describe("complete issues SSR loaders", () => {
	it("keeps workspace-wide issues and the full authorized project selector", async () => {
		const { api, calls } = apiFixture();
		const result = await loadIssues(
			api,
			scope,
			new URL("https://app.test/issues?workspace=workspace")
		);
		expect(result?.initialData.project).toBeNull();
		expect(result?.initialData.projects.map((entry) => entry.id)).toEqual([
			project.id,
			secondProject.id,
		]);
		expect(result?.initialData.page.items[0].customFields[0].value).toBe("3");
		for (const { path, workspaceSlug } of calls) {
			expect(workspaceSlug).toBe(workspace.slug);
			if (path.startsWith("/api/issues?"))
				expect(new URL(path, "https://app.test").searchParams.has("project")).toBe(false);
		}
	});
	it("maps original filters and project UUID to the list wire DTO", () => {
		const qs = filteredIssueQuery(
			new URL(
				"https://app.test/issues?projectId=project-a&status=todo,done&priority=high&hideEpics=1&dateField=completed&dateFrom=2026-10-01&dateTo=2026-10-04"
			),
			scope.projects,
			taskTypes,
			project
		);
		expect(qs.get("project")).toBe(project.id);
		expect(qs.has("projectId")).toBe(false);
		expect(qs.get("statusIds")).toBe("todo,done");
		expect(qs.get("priorities")).toBe("high");
		expect(qs.get("excludeTypeIds")).toBe("epic-type");
		expect(qs.has("completedAfter")).toBe(true);
		expect(qs.has("completedBefore")).toBe(true);
	});
	it("SSR-renders original rows, selectors, story points, and modal trigger before effects", async () => {
		const { api } = apiFixture();
		const html = renderToString(
			await renderIssues(api, scope, new URL("https://app.test/issues?workspace=workspace"))
		);
		expect(html).toContain("Original issue");
		expect(html).toContain("3");
		expect(html).toContain("New issue");
		expect(html).toContain("Filter by project");
		expect(html).toContain("workspace=workspace");
		expect(html).not.toContain("Loading issues");
	});
	it("resolves a UUID in its authorized membership before selecting its catalog project", async () => {
		const { api, calls } = apiFixture();
		const result = await loadIssue(
			api,
			{
				...scope,
				selection: { kind: "selection-required", target: "project", reason: "ambiguous" },
			},
			new URL("https://app.test/issues/view?id=issue-a&workspace=workspace")
		);
		expect(calls[0]).toEqual({ path: "/api/issues/issue-a", workspaceSlug: workspace.slug });
		expect(result?.scope.selection).toEqual({ kind: "project", workspace, project });
		expect(result?.initialData.currentUserId).toBe(scope.user.id);
		expect(result?.initialData.comments[0].author_id).toBe(scope.user.id);
		expect(result?.initialData.attachments[0].kind).toBe("url");
	});
	it("renders the actual created-issue detail wire shape without the list-only assignee_name alias", async () => {
		// Captured from a real locally created issue GET /api/issues/:ref, with fixture identities substituted.
		// Unlike the list DTO, getIssue does not join the assignee's name.
		const detailDto = {
			id: "issue-a",
			workspace_id: workspace.id,
			project_id: project.id,
			number: 1,
			title: "Acceptance native issue",
			body: "Acceptance persisted body",
			status: "backlog",
			priority: "medium",
			assignee_id: null,
			labels: "[]",
			parent_id: null,
			type_id: "task-type",
			status_id: "backlog-status",
			status_category: "todo",
			sprint_id: null,
			created_by_id: scope.user.id,
			author_kind: "human",
			created_at: 1791102213,
			updated_at: 1791102213,
			completed_at: null,
			needs_audit: false,
			project_key: project.key,
			project_name: project.name,
			type_key: "task",
			type_name: "Task",
			status_key: "backlog",
			status_name: "Backlog",
			rollup: { total: 0, byStatus: {}, done: 0, remaining: 0 },
			links: [],
			customFields: [],
			url: "/projects/A/issues/1/acceptance-native-issue",
		};
		const selectedScope = { ...scope, selection: { kind: "project" as const, workspace, project } };
		const url = new URL(
			"https://app.test/projects/a/issues/1/acceptance-native-issue?workspace=workspace"
		);
		const params = { projectSlug: "a", issueNumber: "1", titleSlug: "acceptance-native-issue" };
		const { api } = apiFixture((path) => (path === "/api/issues/A-1" ? detailDto : undefined));
		const data = await loadIssue(api, selectedScope, url, params);
		expect(data?.initialData.issue.assignee_name).toBeNull();
		expect(data?.initialData.issue.body).toBe(detailDto.body);
		const html = renderToString(await renderIssue(api, selectedScope, url, params));
		expect(html).toContain(detailDto.title);
		expect(html).toContain(detailDto.body);
		// Optional does not mean unvalidated when the backend actually provides the alias.
		const invalid = apiFixture((path) =>
			path === "/api/issues/A-1" ? { ...detailDto, assignee_name: 42 } : undefined
		);
		const error = await Effect.runPromise(
			Effect.flip(loadIssueEffect(invalid.api, selectedScope, url, params))
		);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ kind: "schema", status: 502 });
	});
	it("does not fetch an unauthorized workspace or expand an unauthorized catalog project", async () => {
		const first = apiFixture();
		expect(
			await loadIssue(
				first.api,
				scope,
				new URL("https://app.test/issues/view?id=issue-a&workspace=foreign")
			)
		).toBeNull();
		expect(first.calls).toHaveLength(0);
		const second = apiFixture((path) =>
			path === "/api/issues/issue-a" ? issue({ project_id: "foreign-project" }) : undefined
		);
		expect(
			await loadIssue(
				second.api,
				scope,
				new URL("https://app.test/issues/view?id=issue-a&workspace=workspace")
			)
		).toBeNull();
		expect(second.calls).toHaveLength(1);
	});
	it("renders complete detail description, comments, files, custom fields and author edit controls in SSR", async () => {
		const { api, calls } = apiFixture();
		const html = renderToString(
			await renderIssue(
				api,
				{ ...scope, selection: { kind: "project", workspace, project } },
				new URL("https://app.test/projects/a/issues/1/outdated-title?workspace=workspace"),
				{ projectSlug: "a", issueNumber: "1", titleSlug: "outdated-title" }
			)
		);
		expect(calls[0]).toEqual({ path: "/api/issues/A-1", workspaceSlug: workspace.slug });
		expect(html).toContain("Original issue");
		expect(html).toContain("<strong>Original description</strong>");
		expect(html).toContain("Existing comment");
		expect(html).toContain("Reference");
		expect(html).toContain("Edit story points");
		expect(html).not.toContain("No issue ID");
	});
	it("pages through each authenticated membership for MyIssues without imposing the selected project", async () => {
		const other = { ...workspace, id: "workspace-b", slug: "other" };
		const { api, calls } = apiFixture((path, options) => {
			if (!path.startsWith("/api/issues?")) return undefined;
			const p = new URL(path, "https://app.test").searchParams;
			return {
				items: [issue({ id: `${options?.workspaceSlug}-${p.get("cursor") ?? "first"}` })],
				nextCursor: p.has("cursor") ? null : "second",
				total: 2,
			};
		});
		const result = await loadMyIssues(
			api,
			{
				...scope,
				workspaces: [workspace, other],
				selection: { kind: "project", workspace, project },
			},
			new URL("https://app.test/my-issues?projectId=project-a")
		);
		expect(result.issues).toHaveLength(4);
		expect(new Set(result.issues.map((entry) => entry.workspaceSlug))).toEqual(
			new Set([workspace.slug, other.slug])
		);
		expect(calls).toHaveLength(4);
		for (const call of calls) {
			const p = new URL(call.path, "https://app.test").searchParams;
			expect(p.get("assignee")).toBe("me");
			expect(p.has("project")).toBe(false);
			expect(p.has("projectId")).toBe(false);
		}
	});
	it("loads canonical board working sets completely and preserves the search-specific projectId contract", async () => {
		const { api, calls } = apiFixture((path) => {
			if (path.startsWith("/api/issues/search?")) return [];
			if (!path.startsWith("/api/issues?")) return undefined;
			const params = new URL(path, "https://app.test").searchParams;
			if (params.has("typeId")) return { items: [], nextCursor: null, total: 0 };
			return {
				items: [issue({ id: params.has("cursor") ? "second-row" : "first-row" })],
				nextCursor: params.has("cursor") ? null : "next-page",
				total: 2,
			};
		});
		const result = await loadIssues(
			api,
			{ ...scope, selection: { kind: "project", workspace, project } },
			new URL("https://app.test/issues?workspace=workspace&projectId=project-a&view=board&q=needle")
		);
		expect(result?.initialData.view).toBe("board");
		expect(result?.initialData.page.items).toHaveLength(2);
		expect(result?.initialData.page.nextCursor).toBeNull();
		const search = calls.find((entry) => entry.path.startsWith("/api/issues/search?"));
		expect(new URL(search?.path ?? "/", "https://app.test").searchParams.get("projectId")).toBe(
			project.id
		);
		for (const call of calls.filter((entry) => entry.path.startsWith("/api/issues?")))
			expect(new URL(call.path, "https://app.test").searchParams.get("project")).toBe(project.id);
	});
	it("keeps schema and cursor failures in the typed Effect error channel", async () => {
		const malformed = apiFixture((path) =>
			path === "/api/task-statuses" ? [{ id: 42 }] : undefined
		);
		const invalid = await Effect.runPromise(
			Effect.flip(
				loadIssuesEffect(
					malformed.api,
					scope,
					new URL("https://app.test/issues?workspace=workspace")
				)
			)
		);
		expect(invalid).toBeInstanceOf(ApiError);
		expect(invalid.kind).toBe("schema");
		const repeated = apiFixture((path) =>
			path.startsWith("/api/issues?")
				? { items: [issue()], nextCursor: "repeat", total: 2 }
				: undefined
		);
		const error = await Effect.runPromise(
			Effect.flip(
				loadIssuesEffect(
					repeated.api,
					scope,
					new URL("https://app.test/issues?workspace=workspace&view=board")
				)
			)
		);
		expect(error).toBeInstanceOf(ApiError);
		expect(error.message).toContain("repeated issue cursor");
	});
	it("loads epic rollups with includeRollups=1 and no per-epic detail fanout", async () => {
		const { api, calls } = apiFixture();
		await loadEpics(
			api,
			{ ...scope, selection: { kind: "project", workspace, project } },
			new URL("https://app.test/epics?projectId=project-a")
		);
		const lists = calls.filter((entry) => entry.path.startsWith("/api/issues?"));
		expect(lists).toHaveLength(1);
		const p = new URL(lists[0].path, "https://app.test").searchParams;
		expect(p.get("includeRollups")).toBe("1");
		expect(p.get("project")).toBe(project.id);
		expect(p.get("typeId")).toBe("epic-type");
	});
});
