import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { type PreparedView, RequestServices } from "../../request";
import type { RequestApi } from "../../server/api-client";
import { ApiError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
import {
	createWikiPage,
	duplicateWikiPage,
	getWikiDraft,
	getWikiPage,
	getWikiRevisionDiff,
	restoreWikiRevision,
	saveWikiPage,
} from "./actions";
import { createTestDatabase } from "../../test/database";
import { jsonResponse, testRequestApi } from "./test-api";

type Definition = {
	input: Schema.Decoder<unknown>;
	handler: (input: never) => Effect.Effect<unknown, unknown, RequestServices>;
};
const definitions = vi.hoisted(() => new Map<unknown, Definition>());
vi.mock("@effront/core/workers", async () => {
	const { Effect } = await import("effect");
	return { getWorkersRequestContext: () => Effect.die("No Workers runtime in handler unit tests") };
});
vi.mock("../../effront", () => ({
	EFFRONT: {
		ServerFn: {
			make: (definition: Definition) => {
				const operation = () => undefined;
				definitions.set(operation, definition);
				return operation;
			},
		},
	},
}));
const workspace = { id: "workspace", slug: "team", name: "Team", role: "member" as const };
const scope: RequestScope = {
	user: { id: "user", name: "Alice", email: "alice@example.test" },
	workspaces: [workspace],
	projects: [],
	selection: { kind: "workspace", workspace },
};
const databases: ReturnType<typeof createTestDatabase>[] = [];
afterEach(() => {
	for (const database of databases.splice(0)) database.close();
});
function fixture(
	options: {
		origin?: string;
		writeFailure?: ApiError;
		pageProject?: string;
		inaccessible?: boolean;
		archived?: boolean;
		role?: "owner" | "admin" | "member";
		granted?: boolean;
	} = {},
) {
	const database = createTestDatabase();
	databases.push(database);
	database.sqlite.exec(`
		INSERT INTO workspaces (id,name,slug,created_at) VALUES ('workspace','Team','team',1),('foreign-workspace','Foreign','foreign',1);
		INSERT INTO users (id,email,name,created_at) VALUES ('user','alice@example.test','Alice',1),('other-user','other@example.test','Other',1);
		INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('workspace','user','member',1);
		INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES ('source-project','workspace','Source','SRC','source',1,1);
		INSERT INTO wiki_pages (id,workspace_id,slug,title,content,created_by_id,updated_by_id,created_at,updated_at) VALUES
		 ('page','workspace','guide','Guide','Body','user','user',1,1),('foreign-page','foreign-workspace','guide','Foreign Guide','Secret','user','user',1,1);
		INSERT INTO wiki_revisions (id,page_id,content,author_id,created_at) VALUES ('revision','page','Body','user',1),('foreign-revision','foreign-page','Secret','user',1);
	`);
	if (options.pageProject)
		database.sqlite
			.prepare("UPDATE wiki_pages SET project_id = ? WHERE id = 'page'")
			.run(options.pageProject);
	if (options.archived)
		database.sqlite.exec("UPDATE projects SET archived_at = 2 WHERE id = 'source-project'");
	if (options.role)
		database.sqlite
			.prepare("UPDATE workspace_members SET role = ? WHERE user_id = 'user'")
			.run(options.role);
	if (options.granted)
		database.sqlite.exec(`
			INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('group','workspace','Readers',1);
			INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('group','user','user',1);
			INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('group','source-project','viewer');
		`);
	const currentScope: RequestScope = {
		...scope,
		workspaces: [{ ...workspace, role: options.role ?? workspace.role }],
		projects:
			options.pageProject && !options.inaccessible && !options.archived
				? [
						{
							id: "source-project",
							workspace_id: "workspace",
							workspace_slug: "team",
							workspace_name: "Team",
							name: "Source",
							key: "SRC",
							slug: "source",
							description: null,
							open_issue_count: 0,
							backlog_issue_count: 0,
							archived_at: null,
							created_at: 1,
							updated_at: 1,
						},
					]
				: [],
	};
	const reads: string[] = [];
	const writes: { path: string; mutation: Parameters<RequestApi["send"]>[1] }[] = [];
	const invalidate = vi.fn();
	const api = testRequestApi((outgoing) =>
		Effect.suspend(() => {
			const path = outgoing.url;
			if (outgoing.method === "GET") {
				reads.push(path);
				return Effect.fail(new ApiError("request", 500, "Wiki read unexpectedly used HTTP."));
			}
			writes.push({
				path,
				mutation: {
					method: outgoing.method as Parameters<RequestApi["send"]>[1]["method"],
					workspaceSlug: outgoing.headers["x-workspace-slug"],
					...(outgoing.body._tag === "Uint8Array"
						? { json: JSON.parse(new TextDecoder().decode(outgoing.body.body)) }
						: {}),
				},
			});
			return options.writeFailure
				? Effect.fail(options.writeFailure)
				: jsonResponse(
						outgoing,
						path === "/api/wiki" ? { id: "copy", slug: "guide-copy" } : { ok: true },
					);
		}),
	);
	const request = new Request("https://app.test/_effront/function", {
		method: "POST",
		headers: { Origin: options.origin ?? "https://app.test" },
	});
	const services = {
		api,
		db: database.db,
		request,
		env: { API_BASE: "https://api.test", DB: database.db },
		url: new URL(request.url),
		scope: () => Effect.succeed(currentScope),
		prepare: (view: PreparedView) => view,
		invalidate: Effect.sync(invalidate),
	};
	function run(operation: unknown, input: unknown) {
		const definition = definitions.get(operation);
		if (!definition) throw new Error("Missing operation definition");
		return Effect.runPromise(
			Schema.decodeUnknownEffect(definition.input)(input).pipe(
				Effect.flatMap((value) => definition.handler(value as never)),
				Effect.provideService(RequestServices, services),
			),
		);
	}
	return { run, reads, writes, invalidate, sqlite: database.sqlite };
}
describe("Wiki semantic ServerFn contracts", () => {
	it.each(["owner", "admin", "member"] as const)(
		"reads archived project pages, revisions and personal drafts from a workspace-only selector for %s",
		async (role) => {
			const test = fixture({
				pageProject: "source-project",
				archived: true,
				role,
				granted: role === "member",
			});
			expect(await test.run(getWikiPage, { workspaceSlug: "team", slug: "guide" })).toMatchObject({
				ok: true,
				value: { id: "page", project_id: "source-project" },
			});
			expect(
				await test.run(getWikiRevisionDiff, {
					workspaceSlug: "team",
					slug: "guide",
					revisionId: "revision",
				}),
			).toMatchObject({ ok: true, value: { diff: expect.any(String) } });
			expect(await test.run(getWikiDraft, { workspaceSlug: "team", slug: "guide" })).toEqual({
				ok: true,
				value: null,
			});
			expect(test.reads).toEqual([]);
			expect(test.invalidate).not.toHaveBeenCalled();
		},
	);
	it("does not grant an archived project's page or revision to an ungranted member", async () => {
		const test = fixture({ pageProject: "source-project", archived: true });
		for (const operation of [getWikiPage, getWikiDraft, getWikiRevisionDiff]) {
			expect(
				await test.run(operation, { workspaceSlug: "team", slug: "guide", revisionId: "revision" }),
			).toMatchObject({ ok: false, status: 404 });
		}
		expect(test.reads).toEqual([]);
	});
	it("rejects cross-origin writes before any backend request and invalidates failed mutation scope", async () => {
		const test = fixture({ origin: "https://attacker.test" });
		expect(
			await test.run(saveWikiPage, {
				workspaceSlug: "team",
				slug: "guide",
				title: "Draft",
				content: "Body",
				baseRevisionId: "revision",
			}),
		).toEqual({ ok: false, status: 403, message: expect.any(String) });
		expect(test.writes).toEqual([]);
		expect(test.invalidate).toHaveBeenCalledTimes(1);
	});
	it("rejects an unauthorized workspace before constructing a backend mutation", async () => {
		const test = fixture();
		expect(
			await test.run(saveWikiPage, {
				workspaceSlug: "other",
				slug: "guide",
				title: "Draft",
				content: "Body",
			}),
		).toEqual({ ok: false, status: 403, message: expect.any(String) });
		expect(test.writes).toEqual([]);
	});
	it("keeps expected409 conflicts typed and does not clear an unseen draft after failed save", async () => {
		const test = fixture({ writeFailure: new ApiError("http", 409, "Concurrent edit") });
		expect(
			await test.run(saveWikiPage, {
				workspaceSlug: "team",
				slug: "guide",
				title: "My title",
				content: "Mine",
				baseRevisionId: "revision",
			}),
		).toEqual({ ok: false, status: 409, message: "Concurrent edit" });
		expect(test.writes).toHaveLength(1);
		expect(test.writes[0].mutation.json).toEqual({
			title: "My title",
			content: "Mine",
			baseRevisionId: "revision",
		});
	});
	it("reads a draft without invalidating and resolves the explicit authorized workspace", async () => {
		const test = fixture();
		expect(await test.run(getWikiDraft, { workspaceSlug: "team", slug: "guide" })).toEqual({
			ok: true,
			value: null,
		});
		expect(test.reads).toEqual([]);
		expect(test.invalidate).not.toHaveBeenCalled();
	});
	it("duplicates server-authorized content and preserves the source entity project", async () => {
		const test = fixture({ pageProject: "source-project" });
		expect(await test.run(duplicateWikiPage, { workspaceSlug: "team", slug: "guide" })).toEqual({
			ok: true,
			value: { id: "copy", slug: "guide-copy" },
		});
		expect(test.writes[0].mutation.json).toEqual(
			expect.objectContaining({
				title: "Guide (copy)",
				content: "Body",
				projectId: "source-project",
			}),
		);
		expect(test.writes[0].mutation.json).not.toHaveProperty("parentId");
	});
	it("reads the actual page DTO/revision pointer and only the current user's draft directly", async () => {
		const test = fixture();
		expect(await test.run(getWikiPage, { workspaceSlug: "team", slug: "guide" })).toMatchObject({
			ok: true,
			value: { id: "page", content: "Body", revisionId: "revision", freshness: null },
		});
		test.sqlite.exec(
			`INSERT INTO wiki_drafts (id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at) VALUES ('mine','workspace','user','page','Mine','Personal','revision',2),('theirs','workspace','other-user','page','Secret','Private','revision',3)`,
		);
		expect(await test.run(getWikiDraft, { workspaceSlug: "team", slug: "guide" })).toEqual({
			ok: true,
			value: { title: "Mine", content: "Personal", baseRevisionId: "revision", updatedAt: 2 },
		});
		expect(test.reads).toEqual([]);
		expect(test.invalidate).not.toHaveBeenCalled();
	});
	it("re-authorizes the actual entity project rather than trusting a page selector", async () => {
		const test = fixture({ pageProject: "source-project", inaccessible: true });
		for (const operation of [getWikiPage, getWikiDraft, duplicateWikiPage])
			expect(await test.run(operation, { workspaceSlug: "team", slug: "guide" })).toMatchObject({
				ok: false,
				status: 404,
			});
		expect(test.reads).toEqual([]);
		expect(test.writes).toEqual([]);
	});
	it("binds revision diffs and restore reads to the authorized page and workspace", async () => {
		const test = fixture();
		test.sqlite.exec("UPDATE wiki_pages SET content = 'Current' WHERE id = 'page'");
		expect(
			await test.run(getWikiRevisionDiff, {
				workspaceSlug: "team",
				slug: "guide",
				revisionId: "revision",
			}),
		).toEqual({
			ok: true,
			value: { diff: "--- base\n+++ current\n@@ -1,1 +1,1 @@\n-Body\n+Current" },
		});
		for (const operation of [getWikiRevisionDiff, restoreWikiRevision])
			expect(
				await test.run(operation, {
					workspaceSlug: "team",
					slug: "guide",
					revisionId: "foreign-revision",
					baseRevisionId: "revision",
				}),
			).toMatchObject({ ok: false, status: 404 });
		expect(test.writes).toEqual([]);
		expect(
			await test.run(restoreWikiRevision, {
				workspaceSlug: "team",
				slug: "guide",
				revisionId: "revision",
				baseRevisionId: "revision",
			}),
		).toEqual({ ok: true, value: { ok: true } });
		expect(test.writes[0].mutation.json).toEqual({
			content: "Body",
			baseRevisionId: "revision",
			summary: "Restored from revision dated 1970-01-01T00:00:01.000Z",
		});
		expect(test.reads).toEqual([]);
	});
	it("rejects mutually-exclusive template/content before reaching the request handler", async () => {
		const test = fixture();
		await expect(
			test.run(createWikiPage, {
				workspaceSlug: "team",
				title: "Guide",
				slug: "guide",
				content: "Body",
				templateSlug: "template",
			}),
		).rejects.toThrow();
		expect(test.writes).toEqual([]);
	});
});
