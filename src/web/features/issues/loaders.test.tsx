import { Effect } from "effect";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiError, ScopeError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
import { readDataIssuePage, searchDataIssues } from "./data";
import {
	filteredIssueQuery,
	loadEpics,
	loadIssue,
	loadIssues,
	loadMyIssues,
	renderIssue,
	renderIssues,
} from "./server";
import { issueDataFixture } from "./test/data-fixture";
import { project, scope, secondProject, taskTypes, workspace } from "./test/fixtures";

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
const databases: ReturnType<typeof issueDataFixture>[] = [];
function fixture() {
	const data = issueDataFixture();
	databases.push(data);
	return data;
}
afterEach(() => {
	for (const data of databases.splice(0)) data.close();
});
const selected: RequestScope = { ...scope, selection: { kind: "project", workspace, project } };
const listUrl = new URL("https://front.test/issues?workspace=workspace");
const detailUrl = new URL("https://front.test/issues/view?id=issue-a&workspace=workspace");

describe("complete direct D1 issues SSR loaders", () => {
	it("keeps workspace-wide issues and the full authorized project selector", async () => {
		const data = fixture();
		const result = await data.run(loadIssues(data.api, scope, listUrl));
		expect(result?.initialData.project).toBeNull();
		expect(result?.initialData.projects.map((entry) => entry.id)).toEqual([
			project.id,
			secondProject.id,
		]);
		expect(result?.initialData.page.items.map((entry) => entry.id)).toEqual(["issue-b", "issue-a"]);
		expect(
			result?.initialData.page.items.find((entry) => entry.id === "issue-a")?.customFields[0].value,
		).toBe("3");
		expect(
			result?.initialData.page.items.every((entry) => entry.workspaceSlug === workspace.slug),
		).toBe(true);
	});
	it("maps original filters and project UUID to the app query DTO", () => {
		const qs = filteredIssueQuery(
			new URL(
				"https://front.test/issues?projectId=project-a&status=todo,done&priority=high&hideEpics=1&dateField=completed&dateFrom=2026-10-01&dateTo=2026-10-04",
			),
			scope.projects,
			taskTypes,
			project,
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
		const data = fixture();
		const html = renderToString(await data.run(renderIssues(data.api, scope, listUrl)));
		expect(html).toContain("Original issue");
		expect(html).toContain("3");
		expect(html).toContain("New issue");
		expect(html).toContain("Filter by project");
		expect(html).toContain("workspace=workspace");
		expect(html).not.toContain("Loading issues");
	});
	it("resolves a UUID in its authorized membership before selecting its catalog project", async () => {
		const data = fixture();
		const result = await data.run(
			loadIssue(
				data.api,
				{
					...scope,
					selection: { kind: "selection-required", target: "project", reason: "ambiguous" },
				},
				detailUrl,
			),
		);
		expect(result?.scope.selection).toEqual({ kind: "project", workspace, project });
		expect(result?.initialData.currentUserId).toBe(scope.user.id);
		expect(result?.initialData.comments[0].author_id).toBe(scope.user.id);
		expect(result?.initialData.attachments[0].kind).toBe("url");
	});
	it("renders the actual detail projection without the list-only assignee_name alias", async () => {
		const data = fixture();
		const url = new URL(
			"https://front.test/projects/a/issues/1/outdated-title?workspace=workspace",
		);
		const params = { projectSlug: "a", issueNumber: "1", titleSlug: "outdated-title" };
		const detail = await data.run(loadIssue(data.api, selected, url, params));
		expect(detail?.initialData.issue.assignee_name).toBeNull();
		expect(detail?.initialData.issue.body).toBe("**Original description**");
		const list = await data.run(
			readDataIssuePage(scope, workspace.id, new URLSearchParams({ project: project.id })),
		);
		expect(list.items[0].assignee_name).toBe("User");
		expect(list.items[0].body).toBeNull();
		const html = renderToString(await data.run(renderIssue(data.api, selected, url, params)));
		expect(html).toContain("Original issue");
		expect(html).toContain("<strong>Original description</strong>");
	});
	it("does not fetch an unauthorized workspace or expand an unauthorized catalog project", async () => {
		const data = fixture();
		expect(
			await data.run(
				loadIssue(
					data.api,
					scope,
					new URL("https://front.test/issues/view?id=issue-a&workspace=foreign"),
				),
			),
		).toBeNull();
		for (const id of ["hidden-issue", "other-issue"]) {
			const error = await data.run(
				Effect.flip(
					loadIssue(
						data.api,
						scope,
						new URL(`https://front.test/issues/view?id=${id}&workspace=workspace`),
					),
				),
			);
			expect(error).toBeInstanceOf(ScopeError);
			expect(error.status).toBe(404);
		}
	});
	it("renders complete detail description, comments, files, custom fields and author controls in SSR", async () => {
		const data = fixture();
		const html = renderToString(
			await data.run(
				renderIssue(
					data.api,
					selected,
					new URL("https://front.test/projects/a/issues/1/outdated-title?workspace=workspace"),
					{ projectSlug: "a", issueNumber: "1", titleSlug: "outdated-title" },
				),
			),
		);
		expect(html).toContain("Original issue");
		expect(html).toContain("<strong>Original description</strong>");
		expect(html).toContain("Existing comment");
		expect(html).toContain("Reference");
		expect(html).toContain("Edit story points");
		expect(html).not.toContain("No issue ID");
	});
	it("pages through each authenticated membership for MyIssues without imposing the selected project", async () => {
		const data = fixture();
		for (let i = 0; i < 103; i++)
			data.insertIssue({
				id: `my-${String(i).padStart(3, "0")}`,
				number: i + 2,
				assigneeId: scope.user.id,
				createdAt: 5,
			});
		const other = { ...workspace, id: "workspace-b", slug: "other" };
		const otherProject = {
			...project,
			id: "other-project",
			key: "O",
			workspace_id: other.id,
			workspace_slug: other.slug,
		};
		const memberships = {
			...selected,
			workspaces: [workspace, other],
			projects: [...scope.projects, otherProject],
		};
		const result = await data.run(
			loadMyIssues(
				data.api,
				memberships,
				new URL("https://front.test/my-issues?projectId=project-a"),
			),
		);
		expect(result.issues).toHaveLength(105);
		expect(new Set(result.issues.map((entry) => entry.id)).size).toBe(105);
		expect(new Set(result.issues.map((entry) => entry.workspaceSlug))).toEqual(
			new Set([workspace.slug, other.slug]),
		);
	});
	it("loads complete board sets and performs project-scoped real FTS search", async () => {
		const data = fixture();
		for (let i = 0; i < 102; i++)
			data.insertIssue({
				id: `board-${String(i).padStart(3, "0")}`,
				number: i + 2,
				title: "needle",
				createdAt: 5,
			});
		const result = await data.run(
			loadIssues(
				data.api,
				selected,
				new URL(
					"https://front.test/issues?workspace=workspace&projectId=project-a&view=board&q=needle",
				),
			),
		);
		expect(result?.initialData.view).toBe("board");
		expect(result?.initialData.page.items).toHaveLength(103);
		expect(result?.initialData.page.nextCursor).toBeNull();
		expect(result?.initialData.search.results).toHaveLength(20);
		expect(
			result?.initialData.search.results?.every((entry) => entry.project_id === project.id),
		).toBe(true);
		expect(await data.run(searchDataIssues(scope, workspace.id, "secret"))).toEqual([]);
	});
	it("keeps query schema and driver failures in the typed Effect error channel", async () => {
		const data = fixture();
		const invalid = await data.run(
			Effect.flip(
				loadIssues(
					data.api,
					scope,
					new URL("https://front.test/issues?workspace=workspace&cursor=not-a-cursor"),
				),
			),
		);
		expect(invalid).toBeInstanceOf(ScopeError);
		expect(invalid.status).toBe(400);
		data.sqlite.exec("DROP TABLE task_statuses");
		const error = await data.run(Effect.flip(loadIssues(data.api, scope, listUrl)));
		expect(error).toBeInstanceOf(ApiError);
		expect(error.status).toBe(500);
		expect(error.message).not.toContain("SELECT");
	});
	it("loads epic rollups from the shared batched query without per-epic detail fanout", async () => {
		const data = fixture();
		data.insertIssue({ id: "epic-a", number: 2, typeId: "epic-type" });
		data.insertIssue({ id: "child-a", number: 3, parentId: "epic-a", statusId: "done" });
		data.sqlite.exec("UPDATE issues SET status='done' WHERE id='child-a'");
		const result = await data.run(
			loadEpics(data.api, selected, new URL("https://front.test/epics?projectId=project-a")),
		);
		expect(result?.initialData.page.items).toHaveLength(1);
		expect(result?.initialData.page.items[0].rollup).toMatchObject({
			total: 1,
			done: 1,
			remaining: 0,
		});
		const detail = await data.run(
			loadIssue(
				data.api,
				scope,
				new URL("https://front.test/issues/view?id=epic-a&workspace=workspace"),
			),
		);
		expect(detail?.initialData.children.map((entry) => entry.id)).toEqual(["child-a"]);
	});
	it("enforces linked wiki visibility without hiding the unavailable attachment row", async () => {
		const data = fixture();
		data.sqlite.exec(
			`INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,linked_wiki_page_id,entity_type,entity_id,created_by_id,created_at) VALUES ('wiki-link','workspace-a','wiki_ref','','Hidden wiki','','0','wiki-hidden','issue','issue-a','user-a',2)`,
		);
		const result = await data.run(loadIssue(data.api, scope, detailUrl));
		expect(
			result?.initialData.attachments.find((entry) => entry.id === "wiki-link")?.wikiPage,
		).toBeNull();
	});
});
