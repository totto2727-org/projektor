import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ProjectLookup } from "../islands/board-utils";
import type { ProjectMeta } from "../islands/issue-list/types";
import {
	currentProject,
	ensureProjectResolved,
	type ProjectSummary,
	projectError,
	projectReady,
	projectsList,
	readProjectHint,
} from "./project-context";

const A = { id: "a", key: "SAME", slug: "same", name: "A", workspace_slug: "alpha" };
const B = { ...A, id: "b", name: "B", workspace_slug: "beta" };
function catalog(projects = [A, B]) {
	const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => projects });
	vi.stubGlobal("fetch", fetch);
	return fetch;
}
beforeEach(() => history.replaceState(null, "", "/"));

describe("project workspace identity", () => {
	it("requires workspace identity on every project catalog type", () => {
		expectTypeOf<Pick<ProjectSummary, "workspace_slug">>().toEqualTypeOf<{
			workspace_slug: string;
		}>();
		expectTypeOf<Pick<ProjectLookup, "workspace_slug">>().toEqualTypeOf<{
			workspace_slug: string;
		}>();
		expectTypeOf<Pick<ProjectMeta, "workspace_slug">>().toEqualTypeOf<{
			workspace_slug: string;
		}>();
	});
	it.each(["/issues/view?id=issue", "/wiki/view?id=page", "/feedback/view?id=source"])(
		"does not interpret an entity UUID on %s as project identity",
		(path) => {
			history.replaceState(null, "", path);
			expect(readProjectHint()).toBeNull();
		}
	);
	it("accepts legacy project identity only on the project landing route", () => {
		history.replaceState(null, "", "/projects/view?id=a");
		expect(readProjectHint()).toBe("a");
		history.replaceState(null, "", "/issues?project=SAME&projectId=b");
		expect(readProjectHint()).toBe("b");
	});
	it("global discovery needs no workspace header, and duplicate slugs require choice", async () => {
		const fetch = catalog();
		await ensureProjectResolved(undefined, "same");
		expect(currentProject.value).toBeNull();
		expect(projectError.value).toMatch(/Select a project/);
		expect((fetch.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty("X-Workspace-Slug");
		await ensureProjectResolved("beta", "same");
		expect(currentProject.value).toEqual(B);
	});
	it("explicit workspace prevents a cached project from another membership surviving", async () => {
		currentProject.value = A;
		projectsList.value = [A, B];
		await ensureProjectResolved("beta", null);
		expect(currentProject.value).toEqual(B);
		expect(projectReady.value).toBe(true);
	});
	it("refreshes a missing identity for newly created or archived projects", async () => {
		projectsList.value = [A];
		const fetch = catalog();
		await ensureProjectResolved(undefined, "b");
		expect(currentProject.value).toEqual(B);
		expect(fetch.mock.calls[0][0]).toBe("/api/projects?includeArchived=true");
	});
	it("parallel same-intent resolutions share discovery and settle the latest scope", async () => {
		let resolve!: (value: unknown) => void;
		const fetch = vi.fn().mockReturnValue(
			new Promise((done) => {
				resolve = done;
			})
		);
		vi.stubGlobal("fetch", fetch);
		const first = ensureProjectResolved(undefined, "a");
		const latest = ensureProjectResolved(undefined, "b");
		resolve({ ok: true, json: async () => [A, B] });
		await Promise.all([first, latest]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(currentProject.value).toEqual(B);
		expect(projectReady.value).toBe(true);
	});
});
