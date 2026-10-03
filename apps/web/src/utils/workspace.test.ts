import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentProject } from "../lib/project-context";
import { resolveWorkspaceSlug } from "./workspace";

beforeEach(() => history.replaceState(null, "", "/"));

describe("resolveWorkspaceSlug", () => {
	it("prefers explicit call scope over URL and cached project", () => {
		history.replaceState(null, "", "/?workspace=beta");
		currentProject.value = {
			id: "p1",
			key: "P",
			name: "Project",
			slug: "project",
			workspace_slug: "alpha",
		};
		expect(resolveWorkspaceSlug("explicit")).toBe("explicit");
		expect(resolveWorkspaceSlug()).toBe("beta");
	});
	it("does not guess a workspace from custom deployment domains", () => {
		vi.stubGlobal("location", { hostname: "app.example.com", search: "", pathname: "/" });
		expect(resolveWorkspaceSlug()).toBe("");
	});
	it("uses compatible resolved project metadata, not a stale project on a switch", () => {
		currentProject.value = {
			id: "p1",
			key: "P",
			name: "Project",
			slug: "project",
			workspace_slug: "alpha",
		};
		expect(resolveWorkspaceSlug()).toBe("alpha");
		history.replaceState(null, "", "/?projectId=p2");
		expect(resolveWorkspaceSlug()).toBe("");
	});
});
