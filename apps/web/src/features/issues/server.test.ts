import { describe, expect, it } from "vite-plus/test";
import { issueListQuery } from "./query";

const workspace = {
	id: "workspace-a",
	name: "Workspace",
	slug: "workspace",
	role: "member" as const,
};
const projectA = {
	id: "project-a",
	name: "Project A",
	key: "A",
	slug: "a",
	description: null,
	workspace_id: workspace.id,
	workspace_name: workspace.name,
	workspace_slug: workspace.slug,
	open_issue_count: 1,
	backlog_issue_count: 0,
	archived_at: null,
	created_at: 1,
	updated_at: 1,
};
const projectB = { ...projectA, id: "project-b", name: "Project B", key: "B", slug: "b" };
describe("issue SSR loaders", () => {
	it("uses the backend list endpoint's project parameter in a workspace with multiple projects", async () => {
		const url = new URL(
			"https://ssr.example.test/issues?projectId=project-a&workspace=workspace&status=todo",
		);
		const query = issueListQuery(url, { project: projectA.id });
		expect(projectA.workspace_id).toBe(projectB.workspace_id);
		expect(projectA.id).not.toBe(projectB.id);
		expect(query).toContain("project=project-a");
		expect(query).not.toContain("projectId=project-a");
		expect(query).toContain("status=todo");
	});

	it("uses the same project filter for epics", async () => {
		const query = issueListQuery(new URL("https://ssr.example.test/epics?projectId=project-a"), {
			project: projectA.id,
			typeId: "epic-type",
			includeRollups: "true",
		});
		expect(query).toContain("project=project-a");
		expect(query).toContain("typeId=epic-type");
	});
});
