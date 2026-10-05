// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../effront", () => ({ EFFRONT: { ServerFn: { make: vi.fn(() => vi.fn()) } } }));

vi.mock("./actions", () => ({
	createProject: vi.fn(),
	updateDescription: vi.fn(),
	archiveProject: vi.fn(),
}));
vi.mock("../../client/functions", () => ({
	unwrapResult: <T,>(result: { ok: true; value: T } | { ok: false; message: string }) => {
		if (!result.ok) throw new Error(result.message);
		return result.value;
	},
}));

import { RuntimeProvider } from "../../client/runtime";
import { createProject } from "./actions";
import { ProjectLanding } from "./ProjectLanding";
import { ProjectList } from "./ProjectList";
import type { FlowMetrics, Project, RecentIssue, RecentWikiPage } from "./schemas";

const catalogProject = (name: string) => ({
	id: "project-1",
	name,
	key: "PROJ",
	slug: "project",
	description: "Server description",
	workspace_id: "workspace-1",
	workspace_name: "Workspace",
	workspace_slug: "workspace",
	open_issue_count: 1,
	backlog_issue_count: 0,
	archived_at: null,
	created_at: 1,
	updated_at: 1,
});

const project = (description: string): Project => ({
	id: "project-1",
	name: "Project",
	key: "PROJ",
	slug: "project",
	description,
	archivedAt: null,
	workspaceId: "workspace-1",
	createdAt: 1,
	updatedAt: 1,
});

const emptyIssues: readonly RecentIssue[] = [];
const emptyWiki: readonly RecentWikiPage[] = [];
const emptyFlow: FlowMetrics = { throughputOverTime: [], cfdOverTime: [] };

function withRuntime(node: React.ReactNode) {
	return (
		<RuntimeProvider scope={null} url="https://frontend.test/projects/view?projectId=project-1">
			{node}
		</RuntimeProvider>
	);
}

describe("project server-prop refresh", () => {
	afterEach(cleanup);

	it("replaces an optimistic catalog with same-URL canonical server props", () => {
		const view = render(
			withRuntime(
				<ProjectList initialProjects={[catalogProject("Optimistic project")]} memberships={[]} />,
			),
		);
		expect(screen.getByText("Optimistic project")).toBeTruthy();

		view.rerender(
			withRuntime(
				<ProjectList initialProjects={[catalogProject("Canonical project")]} memberships={[]} />,
			),
		);
		expect(screen.getByText("Canonical project")).toBeTruthy();
		expect(screen.queryByText("Optimistic project")).toBeNull();
	});

	it("renders only canonical props after a successful create", async () => {
		vi.mocked(createProject).mockResolvedValue({
			ok: true,
			value: { id: "project-2", name: "Created optimistically", key: "NEW", slug: "created" },
		});
		const memberships = [
			{ id: "workspace-1", name: "Workspace", slug: "workspace", role: "owner" as const },
		];
		const view = render(
			withRuntime(
				<ProjectList
					initialProjects={[catalogProject("Existing project")]}
					memberships={memberships}
				/>,
			),
		);
		fireEvent.click(screen.getByText("+ New project"));
		fireEvent.change(screen.getByPlaceholderText("My Project"), {
			target: { value: "Created optimistically" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create project" }));

		await waitFor(() => expect(createProject).toHaveBeenCalledOnce());
		const sent = vi.mocked(createProject).mock.calls[0][1];
		expect(sent.get("workspaceSlug")).toBe("workspace");
		expect(sent.get("name")).toBe("Created optimistically");
		await waitFor(() =>
			expect(screen.getByText("+ New project").closest("details")?.open).toBe(false),
		);
		expect(screen.queryByText("Created optimistically")).toBeNull();
		expect(screen.getByText("Existing project")).toBeTruthy();
		view.rerender(
			withRuntime(
				<ProjectList
					initialProjects={[catalogProject("Canonical catalog")]}
					memberships={memberships}
				/>,
			),
		);
		await waitFor(() => expect(screen.getByText("Canonical catalog")).toBeTruthy());
		expect(screen.queryByText("Created optimistically")).toBeNull();
	});

	it("uses a native GET form for the addressable archived catalog", () => {
		render(withRuntime(<ProjectList initialProjects={[]} memberships={[]} showArchived />));
		const checkbox = screen.getByRole("checkbox", { name: "Show archived" }) as HTMLInputElement;
		const form = checkbox.form;
		expect(form?.method).toBe("get");
		expect(form?.getAttribute("action")).toBe("/projects/view");
		expect(form && new FormData(form).get("includeArchived")).toBe("true");
		expect(form && new FormData(form).get("projectId")).toBe("project-1");
	});

	it("adopts refreshed overview props without erasing an active description draft", () => {
		const view = render(
			withRuntime(
				<ProjectLanding
					initialProject={project("Original description")}
					initialIssues={emptyIssues}
					initialWiki={emptyWiki}
					initialFlow={emptyFlow}
					workspaceSlug="workspace"
					canEdit
				/>,
			),
		);
		fireEvent.click(screen.getByLabelText("Edit project description"));
		const input = screen.getByLabelText("Project description") as HTMLTextAreaElement;
		fireEvent.change(input, { target: { value: "Unsaved draft" } });

		view.rerender(
			withRuntime(
				<ProjectLanding
					initialProject={project("Canonical server description")}
					initialIssues={emptyIssues}
					initialWiki={emptyWiki}
					initialFlow={emptyFlow}
					workspaceSlug="workspace"
					canEdit
				/>,
			),
		);
		expect((screen.getByLabelText("Project description") as HTMLTextAreaElement).value).toBe(
			"Unsaved draft",
		);

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		return waitFor(() => expect(screen.getByText("Canonical server description")).toBeTruthy());
	});
});
