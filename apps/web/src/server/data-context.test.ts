import type { D1Database } from "@cloudflare/workers-types";
import { schema } from "@projektor/db";
import { describe, expect, it } from "vite-plus/test";
import {
	authorizeDataEntity,
	dataError,
	makeDataContext,
	requireDataProject,
	requireDataWorkspace,
	visibleProjectPredicate,
} from "./data-context";
import { ApiError } from "./errors";
import type { RequestScope } from "./request-context";

const workspace = { id: "wa", slug: "alpha", name: "Alpha", role: "member" } as const;
const project = {
	id: "pa",
	key: "ALPHA",
	slug: "alpha-project",
	name: "Alpha",
	description: null,
	workspace_id: "wa",
	workspace_slug: "alpha",
	workspace_name: "Alpha",
	open_issue_count: 0,
	backlog_issue_count: 0,
	archived_at: null,
	created_at: 1,
	updated_at: 1,
};
const scope: RequestScope = {
	user: { id: "u", email: "user@example.test", name: "User" },
	workspaces: [workspace],
	projects: [project],
	selection: { kind: "global" },
};

describe("frontend application data authorization", () => {
	it("requires explicit or selected authenticated workspace, never a first membership", () => {
		expect(() => requireDataWorkspace(scope)).toThrow("Selected workspace is not accessible.");
		expect(requireDataWorkspace(scope, "wa")).toBe(workspace);
		expect(requireDataWorkspace({ ...scope, selection: { kind: "workspace", workspace } })).toBe(
			workspace,
		);
		expect(() => requireDataWorkspace(scope, "other")).toThrow(
			"Selected workspace is not accessible.",
		);
	});
	it("hides inaccessible project existence and enforces matching workspace catalog membership", () => {
		expect(requireDataProject(scope, "pa", "wa")).toBe(project);
		for (const [current, id, workspaceId] of [
			[scope, "hidden", "wa"],
			[scope, "pa", "other"],
			[{ ...scope, workspaces: [] }, "pa", "wa"],
			[{ ...scope, workspaces: [{ ...workspace, slug: "renamed" }] }, "pa", "wa"],
		] as const) {
			try {
				requireDataProject(current, id, workspaceId);
				throw new Error("Expected denial");
			} catch (error) {
				expect(error).toMatchObject({ _tag: "ScopeError", status: 404 });
			}
		}
	});
	it("authorizes workspace wiki rows with null project and project entities against the visible catalog", () => {
		const wiki = { projectId: null, title: "Workspace page" };
		expect(authorizeDataEntity(scope, "wa", wiki)).toBe(wiki);
		expect(authorizeDataEntity(scope, "wa", { projectId: "pa" })).toEqual({ projectId: "pa" });
		expect(() => authorizeDataEntity(scope, "wa", { projectId: "hidden" })).toThrow(
			"Selected project is not accessible.",
		);
		expect(() => authorizeDataEntity(scope, "wa", undefined)).toThrow("Not found.");
		expect(() => authorizeDataEntity({ ...scope, workspaces: [] }, "wa", wiki)).toThrow(
			"Selected workspace is not accessible.",
		);
	});
	it("keeps role/grant predicate policy in the web app with owner/admin bypass only", () => {
		expect(visibleProjectPredicate(scope, "wa", schema.issues.projectId)).toBeDefined();
		for (const role of ["owner", "admin"] as const) {
			expect(
				visibleProjectPredicate(
					{ ...scope, workspaces: [{ ...workspace, role }] },
					"wa",
					schema.issues.projectId,
				),
			).toBeUndefined();
		}
		expect(() => visibleProjectPredicate(scope, "other", schema.issues.projectId)).toThrow(
			"Selected workspace is not accessible.",
		);
	});
	it("binds data context to request services and rejects missing bindings", () => {
		const db = { prepare: () => {} } as unknown as D1Database;
		expect(makeDataContext({ db }, scope, "wa")).toMatchObject({
			db,
			scope,
			workspace,
			workspaceId: "wa",
			userId: "u",
		});
		expect(() => makeDataContext({ db: undefined as unknown as D1Database }, scope, "wa")).toThrow(
			"The application database is not configured.",
		);
	});
	it("does not accept anonymous public membership as authenticated workspace authorization", () => {
		const publicScope = {
			...scope,
			user: { ...scope.user, email: "public-viewer@projektor.local" },
		};
		expect(() => requireDataWorkspace(publicScope, "wa")).toThrow(
			"An interactive browser session is required.",
		);
	});
	it("redacts driver causes and preserves existing typed API errors", () => {
		const error = dataError(new Error("SQL private credentials"));
		expect(error).toMatchObject({
			_tag: "ApiError",
			status: 500,
			message: "Unable to load project data.",
		});
		expect(JSON.stringify(error)).not.toContain("SQL private credentials");
		const existing = new ApiError("configuration", 500, "Unavailable");
		expect(dataError(existing)).toBe(existing);
	});
});
