// MyIssues island — mock-fetch tests.
//
// MyIssues fetches /api/issues?assignee=me (server-resolved to the calling
// user, PROJ-444) and displays the results in one table. The pattern: stub
// global fetch to branch on URL, render, and await the post-load UI
// (view-mode buttons in IssueList's pattern don't apply here — instead wait
// for the issue count which only renders post-load).
import { cleanup, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "./board-utils";
import MyIssues from "./MyIssues";

const USER_ID = "user-1";

const OPEN_ISSUE_PROJ_A: Issue = {
	id: "i1",
	number: 1,
	title: "Open issue in Alpha",
	priority: "high",
	assignee_id: USER_ID,
	assignee_name: "Test User",
	parent_id: null,
	project_key: "ALPHA",
	project_name: "Alpha Project",
	type_key: null,
	type_name: null,
	status_id: "st-todo",
	status_key: "todo",
	status_name: "Todo",
	status_category: "todo",
	sprint_id: null,
	updated_at: 1000,
	created_at: 1000,
};

const DONE_ISSUE_PROJ_A: Issue = {
	id: "i2",
	number: 2,
	title: "Done issue in Alpha",
	priority: "low",
	assignee_id: USER_ID,
	assignee_name: "Test User",
	parent_id: null,
	project_key: "ALPHA",
	project_name: "Alpha Project",
	type_key: null,
	type_name: null,
	status_id: "st-done",
	status_key: "done",
	status_name: "Done",
	status_category: "done",
	sprint_id: null,
	updated_at: 2000,
	created_at: 1000,
};

const OPEN_ISSUE_PROJ_B: Issue = {
	id: "i3",
	number: 5,
	title: "Open issue in Beta",
	priority: "medium",
	assignee_id: USER_ID,
	assignee_name: "Test User",
	parent_id: null,
	project_key: "BETA",
	project_name: "Beta Project",
	type_key: null,
	type_name: null,
	status_id: "st-todo",
	status_key: "todo",
	status_name: "Todo",
	status_category: "todo",
	sprint_id: null,
	updated_at: 1500,
	created_at: 1000,
};

function setupFetch(
	issues: readonly Issue[] = [OPEN_ISSUE_PROJ_A, DONE_ISSUE_PROJ_A, OPEN_ISSUE_PROJ_B]
) {
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes("/api/issues")) {
			return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: issues }) });
		}
		return Promise.reject(new Error(`unexpected fetch: ${u}`));
	});
}

async function waitForLoaded() {
	await screen.findByText(/^\d+ issues?$/);
}

function tableIssueTitles() {
	return within(screen.getByRole("table"))
		.getAllByRole("row")
		.slice(1)
		.map((row) => within(row).getAllByRole("cell")[1]?.textContent);
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("MyIssues — loading and error states", () => {
	it("shows a loading indicator before data resolves", () => {
		vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
		render(<MyIssues />);
		expect(screen.getByText(/Loading/i)).toBeTruthy();
	});

	it("shows an error message when the issues fetch fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() => Promise.reject(new Error("boom")))
		);
		render(<MyIssues />);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByText(/Failed to load issues/i)).toBeTruthy();
	});
});

describe("MyIssues — cross-project table", () => {
	it("fetches issues scoped to assignee=me (server resolves the calling user)", async () => {
		const mockFetch = setupFetch();
		vi.stubGlobal("fetch", mockFetch);
		render(<MyIssues />);
		await waitForLoaded();

		const calls = (mockFetch.mock.calls as [string, unknown][]).map(([u]) => String(u));
		expect(calls.some((u) => u.includes("/api/issues?assignee=me"))).toBe(true);
	});

	it("shows issues from different projects in one table without project headings or extra columns", async () => {
		vi.stubGlobal("fetch", setupFetch());
		render(<MyIssues />);
		await waitForLoaded();

		const table = screen.getByRole("table");
		expect(
			within(table)
				.getAllByRole("columnheader")
				.map((header) => header.textContent)
		).toEqual(["#", "Title", "Priority", "Status"]);
		expect(within(table).getAllByRole("row")).toHaveLength(3);
		expect(within(table).getByRole("link", { name: "ALPHA-1" }).getAttribute("href")).toBe(
			"/projects/ALPHA/issues/1/open-issue-in-alpha"
		);
		expect(within(table).getByRole("link", { name: "BETA-5" }).getAttribute("href")).toBe(
			"/projects/BETA/issues/5/open-issue-in-beta"
		);
		expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
		expect(screen.queryByText("Alpha Project")).toBeNull();
		expect(screen.queryByText("Beta Project")).toBeNull();
	});

	it("sorts interleaved projects by progress before priority or recency", async () => {
		const statuses = [
			{ key: "backlog", category: "todo", priority: "urgent", updatedAt: 9000 },
			{ key: "todo", category: "todo", priority: "urgent", updatedAt: 8000 },
			{ key: "in_progress", category: "in_progress", priority: "high", updatedAt: 7000 },
			{ key: "in_review", category: "in_progress", priority: "low", updatedAt: 1000 },
		];
		vi.stubGlobal(
			"fetch",
			setupFetch(
				statuses.map((status, index) => ({
					...(index % 2 === 0 ? OPEN_ISSUE_PROJ_A : OPEN_ISSUE_PROJ_B),
					id: status.key,
					title: status.key,
					status_key: status.key,
					status_category: status.category,
					priority: status.priority,
					updated_at: status.updatedAt,
				}))
			)
		);
		render(<MyIssues />);
		await waitForLoaded();

		expect(tableIssueTitles()).toEqual(["in_review", "in_progress", "todo", "backlog"]);
	});

	it("sorts the same status by priority before recency", async () => {
		const priorities = ["none", "low", "medium", "high", "urgent"];
		vi.stubGlobal(
			"fetch",
			setupFetch(
				priorities.map((priority, index) => ({
					...OPEN_ISSUE_PROJ_A,
					id: priority,
					title: priority,
					priority,
					updated_at: 5000 - index * 1000,
				}))
			)
		);
		render(<MyIssues />);
		await waitForLoaded();

		expect(tableIssueTitles()).toEqual(["urgent", "high", "medium", "low", "none"]);
	});

	it("sorts the same status and priority by most recently updated first", async () => {
		vi.stubGlobal(
			"fetch",
			setupFetch(
				[1000, 3000, 2000].map((updatedAt) => ({
					...OPEN_ISSUE_PROJ_A,
					id: String(updatedAt),
					title: String(updatedAt),
					updated_at: updatedAt,
				}))
			)
		);
		render(<MyIssues />);
		await waitForLoaded();

		expect(tableIssueTitles()).toEqual(["3000", "2000", "1000"]);
	});

	it("uses progress categories for custom status keys", async () => {
		vi.stubGlobal(
			"fetch",
			setupFetch([
				OPEN_ISSUE_PROJ_A,
				{ ...OPEN_ISSUE_PROJ_B, status_key: "doing", status_category: "in_progress" },
				{
					...OPEN_ISSUE_PROJ_A,
					id: "review",
					title: "Custom review",
					status_key: "qa",
					status_category: "in_progress",
				},
			])
		);
		render(<MyIssues />);
		await waitForLoaded();

		expect(tableIssueTitles()).toEqual([
			"Custom review",
			"Open issue in Beta",
			"Open issue in Alpha",
		]);
	});

	it("excludes completed and cancelled issues without an include-done control", async () => {
		vi.stubGlobal(
			"fetch",
			setupFetch([
				OPEN_ISSUE_PROJ_A,
				DONE_ISSUE_PROJ_A,
				{ ...OPEN_ISSUE_PROJ_B, status_key: "cancelled", status_category: "cancelled" },
			])
		);
		render(<MyIssues />);
		await waitForLoaded();

		expect(tableIssueTitles()).toEqual(["Open issue in Alpha"]);
		expect(screen.queryByText("Done issue in Alpha")).toBeNull();
		expect(screen.queryByText("Open issue in Beta")).toBeNull();
		expect(screen.getByText("1 issue")).toBeTruthy();
		expect(screen.queryByRole("checkbox")).toBeNull();
	});

	it("counts only open issues", async () => {
		vi.stubGlobal("fetch", setupFetch());
		render(<MyIssues />);
		await waitForLoaded();

		await waitFor(() => expect(screen.getByText("2 issues")).toBeTruthy());
	});

	it("loads subsequent pages before sorting so older actionable issues are not omitted", async () => {
		const laterPageIssue = {
			...OPEN_ISSUE_PROJ_B,
			status_key: "in_review",
			status_category: "in_progress",
		};
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [DONE_ISSUE_PROJ_A, OPEN_ISSUE_PROJ_A],
					nextCursor: "1000:i1",
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ items: [laterPageIssue], nextCursor: null }),
			});
		vi.stubGlobal("fetch", mockFetch);
		render(<MyIssues />);
		await waitForLoaded();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockFetch.mock.calls[1]?.[0]).toContain("cursor=1000%3Ai1");
		expect(tableIssueTitles()).toEqual(["Open issue in Beta", "Open issue in Alpha"]);
		expect(screen.getByText("2 issues")).toBeTruthy();
	});
});

describe("MyIssues — empty states", () => {
	it("shows the open-issues empty state when there are no assigned issues", async () => {
		vi.stubGlobal("fetch", setupFetch([]));
		render(<MyIssues />);
		await waitForLoaded();

		expect(screen.getByText("No open issues assigned to you")).toBeTruthy();
		expect(screen.getByText("0 issues")).toBeTruthy();
		expect(screen.queryByRole("table")).toBeNull();
	});

	it("shows the open-issues empty state when all assigned issues are completed", async () => {
		vi.stubGlobal("fetch", setupFetch([DONE_ISSUE_PROJ_A]));
		render(<MyIssues />);
		await waitForLoaded();

		expect(screen.getByText("You have no open issues across any project.")).toBeTruthy();
		expect(screen.getByText("0 issues")).toBeTruthy();
		expect(screen.queryByRole("table")).toBeNull();
	});
});

describe("MyIssues — workspace-slug header contract", () => {
	it("includes X-Workspace-Slug header when workspaceSlug prop is passed", async () => {
		const mockFetch = setupFetch();
		vi.stubGlobal("fetch", mockFetch);
		render(<MyIssues workspaceSlug="my-workspace" />);
		await waitForLoaded();

		const calls = mockFetch.mock.calls as [string, RequestInit][];
		for (const [, init] of calls) {
			const headers = (init?.headers as Record<string, string>) ?? {};
			expect(headers["X-Workspace-Slug"]).toBe("my-workspace");
		}
	});

	it("omits X-Workspace-Slug header when workspaceSlug prop is not passed", async () => {
		const mockFetch = setupFetch();
		vi.stubGlobal("fetch", mockFetch);
		render(<MyIssues />);
		await waitForLoaded();

		const calls = mockFetch.mock.calls as [string, RequestInit][];
		for (const [, init] of calls) {
			const headers = (init?.headers as Record<string, string>) ?? {};
			expect(headers["X-Workspace-Slug"]).toBeUndefined();
		}
	});
});
