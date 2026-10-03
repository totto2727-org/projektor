import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { useEffect, useState } from "preact/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetProjectStoreForTests, currentProject, projectReady } from "../lib/project-context";
import { apiFetch } from "../utils/api-client";
import ConnectAgentGuide from "./ConnectAgentGuide";
import EpicList from "./EpicList";
import FeedbackSourceGrid from "./FeedbackSourceGrid";
import IssueDetail from "./IssueDetail";
import IssueList from "./IssueList";
import MetricsDashboard from "./MetricsDashboard";
import MyIssues from "./MyIssues";
import ProjectLanding from "./ProjectLanding";
import ProjectList from "./ProjectList";
import SprintManager from "./SprintManager";
import WikiPage from "./WikiPage";
import WorkspaceBoundary, { ProjectWorkspaceBoundary } from "./WorkspaceBoundary";

const PROJECTS = [
	{ id: "pa", key: "SAME", name: "Alpha", slug: "same", workspace_slug: "alpha" },
	{ id: "pb", key: "SAME", name: "Beta", slug: "same", workspace_slug: "beta" },
];
const MEMBERSHIPS = [
	{ slug: "alpha", name: "Alpha workspace" },
	{ slug: "beta", name: "Beta workspace" },
];
const ISSUE = {
	id: "issue-1",
	number: 1,
	title: "An issue",
	body: null,
	priority: "low",
	project_key: "SAME",
	project_name: "Project",
	parent_id: null,
	assignee_id: null,
	status_id: "todo",
	status_key: "todo",
	status_name: "Todo",
	status_category: "todo",
	created_at: 0,
	updated_at: 0,
	customFields: [],
};
const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

function stubApi(projects: Promise<unknown> = ok(PROJECTS)) {
	const mock = vi.fn((path: string, _init?: RequestInit): Promise<unknown> => {
		if (path === "/api/projects" || path === "/api/projects?includeArchived=true") return projects;
		if (path === "/api/workspaces") return ok(MEMBERSHIPS);
		if (path.startsWith("/auth/")) return ok({ user: { id: "u1", email: "user@example.com" } });
		if (path.includes("flow-metrics")) return ok(null);
		if (path.includes("/task-types")) return ok([{ id: "epic", key: "epic", name: "Epic" }]);
		if (/^\/api\/projects\/[^/]+$/.test(path)) return ok({ ...PROJECTS[1], description: null });
		if (path.startsWith("/api/workspaces/")) return ok({ members: [], currentUserRole: "owner" });
		if (path.includes("/comments") || path.includes("/links") || path.startsWith("/api/files"))
			return ok([]);
		if (/^\/api\/issues\/[^?]+$/.test(path)) return ok(ISSUE);
		if (path.startsWith("/api/issues?") || path.startsWith("/api/sprints?"))
			return ok({ items: [], total: 0, nextCursor: null });
		return ok([]);
	});
	vi.stubGlobal("fetch", mock);
	return mock;
}

beforeEach(() => {
	__resetProjectStoreForTests();
	localStorage.clear();
	history.replaceState(null, "", "/");
});

function Probe({ slug }: { slug: string }) {
	const [count, setCount] = useState(0);
	useEffect(() => {
		void apiFetch("/api/task-statuses", { workspaceSlug: slug });
	}, [slug]);
	return (
		<button type="button" onClick={() => setCount(count + 1)}>
			{slug}:{count}
		</button>
	);
}

describe("workspace request boundary", () => {
	it("does not mount scoped callers while global project discovery is pending", async () => {
		history.replaceState(null, "", "/issues?projectId=pb");
		let finish!: (value: unknown) => void;
		const mock = stubApi(
			new Promise((resolve) => {
				finish = resolve;
			})
		);
		render(<ProjectWorkspaceBoundary>{(slug) => <Probe slug={slug} />}</ProjectWorkspaceBoundary>);
		await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
		expect(mock.mock.calls[0][0]).toBe("/api/projects");
		expect(mock.mock.calls[0][1]?.headers).toEqual({});
		await act(async () => {
			finish(await ok(PROJECTS));
		});
		expect(await screen.findByText("beta:0")).toBeTruthy();
		await waitFor(() =>
			expect(mock.mock.calls.find(([path]) => path === "/api/task-statuses")?.[1]?.headers).toEqual(
				{ "X-Workspace-Slug": "beta" }
			)
		);
	});

	it("never mounts cached project A for an explicit project B URL and remounts local state", async () => {
		stubApi();
		currentProject.value = PROJECTS[0];
		projectReady.value = true;
		history.replaceState(null, "", "/issues?projectId=pa");
		const view = render(
			<ProjectWorkspaceBoundary>{(slug) => <Probe slug={slug} />}</ProjectWorkspaceBoundary>
		);
		fireEvent.click(await screen.findByText("alpha:0"));
		expect(screen.getByText("alpha:1")).toBeTruthy();
		history.replaceState(null, "", "/issues?projectId=pb");
		view.rerender(
			<ProjectWorkspaceBoundary>{(slug) => <Probe slug={slug} />}</ProjectWorkspaceBoundary>
		);
		expect(screen.queryByText("alpha:1")).toBeNull();
		expect(await screen.findByText("beta:0")).toBeTruthy();
	});

	it("requires usable project choice for ambiguous keys and does not revive localStorage identity", async () => {
		history.replaceState(null, "", "/projects/view/same");
		localStorage.setItem("projektor-last-project-id", "pa");
		const mock = stubApi();
		render(
			<ProjectWorkspaceBoundary requireProject>
				{(slug) => <Probe slug={slug} />}
			</ProjectWorkspaceBoundary>
		);
		expect(await screen.findByLabelText("Project")).toBeTruthy();
		expect(screen.getByRole("link", { name: /Choose a project/ })).toBeTruthy();
		expect(mock.mock.calls.every(([path]) => path === "/api/projects")).toBe(true);
	});

	it("requires selection for multiple memberships, synchronizes sibling islands and resets state", async () => {
		const mock = stubApi();
		render(
			<>
				<WorkspaceBoundary>{(slug) => <Probe slug={slug} />}</WorkspaceBoundary>
				<WorkspaceBoundary>{(slug) => <Probe slug={slug} />}</WorkspaceBoundary>
			</>
		);
		await screen.findAllByLabelText("Workspace");
		expect(mock.mock.calls.every(([path]) => path === "/api/workspaces")).toBe(true);
		fireEvent.change(screen.getAllByLabelText("Workspace")[0], { target: { value: "beta" } });
		await waitFor(() => expect(screen.getAllByText("beta:0")).toHaveLength(2));
		expect(new URLSearchParams(location.search).get("workspace")).toBe("beta");
		fireEvent.click(screen.getAllByText("beta:0")[0]);
		fireEvent.change(screen.getAllByLabelText("Workspace")[1], { target: { value: "alpha" } });
		await waitFor(() => expect(screen.getAllByText("alpha:0")).toHaveLength(2));
	});

	it("selects only an unambiguous sole membership on an entity-only deep link", async () => {
		history.replaceState(null, "", "/issues/view?id=issue-1");
		const mock = vi.fn((path: string) => ok(path === "/api/workspaces" ? [MEMBERSHIPS[1]] : []));
		vi.stubGlobal("fetch", mock);
		render(<ProjectWorkspaceBoundary>{(slug) => <Probe slug={slug} />}</ProjectWorkspaceBoundary>);
		expect(await screen.findByText("beta:0")).toBeTruthy();
		expect(mock.mock.calls.map(([path]) => path)).not.toContain("/api/projects");
	});

	it("honors explicit resource scope rather than the cached current project", async () => {
		currentProject.value = PROJECTS[0];
		projectReady.value = true;
		const mock = stubApi();
		render(
			<ProjectWorkspaceBoundary workspaceSlug="beta" projectHint="pb">
				{(slug) => <Probe slug={slug} />}
			</ProjectWorkspaceBoundary>
		);
		expect(await screen.findByText("beta:0")).toBeTruthy();
		expect(mock.mock.calls.every(([path]) => path !== "/api/projects")).toBe(true);
	});

	it.each([[], "offline"])(
		"handles unavailable memberships without scoped traffic: %s",
		async (result) => {
			const mock = vi.fn(() =>
				typeof result === "string" ? Promise.reject(new Error(result)) : ok(result)
			);
			vi.stubGlobal("fetch", mock);
			render(<WorkspaceBoundary>{(slug) => <Probe slug={slug} />}</WorkspaceBoundary>);
			if (typeof result === "string") expect(await screen.findByRole("alert")).toBeTruthy();
			else expect(await screen.findByText("No accessible workspace.")).toBeTruthy();
			expect(mock).toHaveBeenCalledTimes(1);
		}
	);
});

describe("actual page request owners without build-time workspace props", () => {
	it.each(["/metrics", "/metrics?projectId=unknown"])(
		"Metrics requires usable identity at %s without scoped traffic",
		async (url) => {
			history.replaceState(null, "", url);
			const mock = stubApi();
			render(<MetricsDashboard />);
			expect(await screen.findByLabelText("Project")).toBeTruthy();
			expect(screen.getByRole("link", { name: /Choose a project/ })).toBeTruthy();
			expect(
				mock.mock.calls.every(
					([path]) => path.startsWith("/api/projects") && !path.includes("/flow-metrics")
				)
			).toBe(true);
		}
	);
	it("projectless MCP settings reject an inaccessible URL workspace before scoped traffic", async () => {
		history.replaceState(null, "", "/settings?workspace=unknown");
		const mock = stubApi();
		render(<ConnectAgentGuide />);
		expect(await screen.findByText("Selected workspace is not accessible.")).toBeTruthy();
		expect(mock.mock.calls.every(([path]) => path === "/api/workspaces")).toBe(true);
	});
	it("scoped pending access does not hide another membership on global Projects", async () => {
		currentProject.value = PROJECTS[0];
		const mock = vi.fn((path: string) => {
			if (path === "/api/workspaces") return ok(MEMBERSHIPS);
			if (path === "/api/projects") return ok([PROJECTS[1]]);
			if (path.startsWith("/api/workspaces/")) return ok({ currentUserRole: "member" });
			return ok({ items: [], total: 0 });
		});
		vi.stubGlobal("fetch", mock);
		history.replaceState(null, "", "/issues?workspace=alpha");
		const scoped = render(<IssueList />);
		expect(await screen.findByText(/Access pending/i)).toBeTruthy();
		scoped.unmount();
		history.replaceState(null, "", "/");
		render(<ProjectList />);
		expect(await screen.findByText("Beta")).toBeTruthy();
		expect(screen.queryByText(/Access pending/i)).toBeNull();
	});
	it("public viewer discovery remains global and Overview keeps mutation controls hidden", async () => {
		history.replaceState(null, "", "/projects/view?projectId=pb");
		const mock = stubApi();
		const original = mock.getMockImplementation();
		if (!original) throw new Error("Missing API fixture implementation");
		mock.mockImplementation((path, init) =>
			path === "/auth/me"
				? ok({ user: { id: "public-viewer", email: "public-viewer@projektor.local" } })
				: original(path, init)
		);
		render(<ProjectLanding />);
		await waitFor(() => expect(mock.mock.calls.some(([path]) => path === "/auth/me")).toBe(true));
		expect(mock.mock.calls.find(([path]) => path === "/api/projects")?.[1]?.headers).toEqual({});
		await screen.findByRole("heading", { name: "Beta" });
		await waitFor(() => expect(screen.queryByRole("button", { name: /^Archive$/ })).toBeNull());
	});
	it.each([
		["Overview", ProjectLanding, "/projects/view?projectId=pb", "/api/projects/pb"],
		["Issues", IssueList, "/issues?projectId=pb", "/api/task-statuses"],
		["Issue", IssueDetail, "/projects/SAME/issues/1/an-issue?projectId=pb", "/api/issues/SAME-1"],
		["Sprints", SprintManager, "/sprints?projectId=pb", "/api/sprints?"],
		["Epics", EpicList, "/epics?projectId=pb", "/api/task-types"],
		["Metrics", MetricsDashboard, "/metrics?projectId=pb", "/flow-metrics"],
		["Feedback", FeedbackSourceGrid, "/feedback?projectId=pb", "/feedback-sources"],
		["Wiki", WikiPage, "/wiki?projectId=pb", "/api/wiki/tree"],
	] as const)(
		"%s propagates the selected project's workspace to its complete scoped fan-out",
		async (_name, Component, url, endpoint) => {
			history.replaceState(null, "", url);
			const mock = stubApi();
			render(<Component />);
			await waitFor(() =>
				expect(mock.mock.calls.some(([path]) => path.includes(endpoint))).toBe(true)
			);
			for (const [path, init] of mock.mock.calls) {
				if (path === "/api/projects" || path.startsWith("/auth/")) continue;
				expect(((init?.headers ?? {}) as Record<string, string>)["X-Workspace-Slug"], path).toBe(
					"beta"
				);
			}
		}
	);
});

describe("My Issues across authorized workspace scopes", () => {
	it("aggregates memberships, paginates each scope and retains duplicate-ref link identity", async () => {
		const mock = vi.fn((path: string, init?: RequestInit) => {
			if (path === "/api/workspaces") return ok(MEMBERSHIPS);
			const slug = ((init?.headers ?? {}) as Record<string, string>)["X-Workspace-Slug"];
			const cursor = new URL(path, location.origin).searchParams.get("cursor");
			return ok({
				items: [
					{ ...ISSUE, id: `${slug}-${cursor ?? "first"}`, title: `${slug}-${cursor ?? "first"}` },
				],
				nextCursor: slug === "alpha" && !cursor ? "next" : null,
			});
		});
		vi.stubGlobal("fetch", mock);
		render(<MyIssues />);
		await screen.findByLabelText("Include done");
		expect(screen.getByText("3 issues")).toBeTruthy();
		for (const slug of ["alpha", "beta"]) {
			const links = screen.getAllByRole("link", { name: `${slug}-first` });
			for (const link of links)
				expect(
					new URL(link.getAttribute("href") ?? "", location.origin).searchParams.get("workspace")
				).toBe(slug);
		}
		expect(mock.mock.calls[0][1]?.headers).toEqual({});
		expect(
			mock.mock.calls
				.filter(([path]) => path.startsWith("/api/issues?"))
				.map(([, init]) => ((init?.headers ?? {}) as Record<string, string>)["X-Workspace-Slug"])
				.sort()
		).toEqual(["alpha", "alpha", "beta"]);
	});
});
