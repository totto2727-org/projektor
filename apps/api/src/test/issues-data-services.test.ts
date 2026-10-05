import { env, SELF } from "cloudflare:test";
import { schema } from "@projektor/db";
import * as queries from "@projektor/data-services/issues";
import { listComments } from "@projektor/data-services/comments";
import { listLinksForIssue } from "@projektor/data-services/issue-links";
import { batchLoadCustomFields, listCustomFieldDefs } from "@projektor/data-services/custom-fields";
import { listTaskStatuses } from "@projektor/data-services/task-statuses";
import { listTaskTypes } from "@projektor/data-services/task-types";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
	authHeaders,
	seedComment,
	seedCustomFieldDef,
	seedCustomFieldValue,
	seedIssue,
	seedProjectFixture,
	seedProject,
	seedTaskStatus,
	seedTaskType,
} from "./helpers";

describe("Shared issue queries over the API D1 pool", () => {
	let fixture: Awaited<ReturnType<typeof seedProjectFixture>>;
	beforeEach(async () => {
		fixture = await seedProjectFixture({ role: "owner" });
	});
	async function api(path: string) {
		const response = await SELF.fetch(`http://localhost/api/${path}`, {
			headers: authHeaders(fixture.token, fixture.slug),
		});
		expect(response.status).toBe(200);
		return response.json() as Promise<Record<string, unknown>>;
	}
	it("preserves single row keys, JSON labels, joined nulls and extras without adding assignee_name", async () => {
		const issue = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, {
			assigneeId: fixture.userId,
		});
		const field = await seedCustomFieldDef(fixture.workspaceId, { key: "size", type: "number" });
		await seedCustomFieldValue(issue.id, field.id, "3");
		await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, {
			parentId: issue.id,
			status: "done",
		});
		await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, {
			parentId: issue.id,
			status: "cancelled",
		});
		const row = await Effect.runPromise(
			queries.getIssue(env.DB, fixture.workspaceId, { ref: `PROJ-0${issue.number}` }),
		);
		expect(row).not.toHaveProperty("assignee_name");
		expect(row?.labels).toBe("[]");
		expect(row?.status_name).toBeNull();
		const extras = await Effect.runPromise(
			queries.getIssueExtras(env.DB, fixture.workspaceId, issue.id),
		);
		expect(extras.rollup).toEqual({
			total: 2,
			byStatus: { done: 1, cancelled: 1 },
			done: 2,
			remaining: 0,
		});
		const result = await api(`issues/${issue.id}`);
		const { url, links, ...actual } = result;
		expect(typeof url).toBe("string");
		expect(links).toEqual([]);
		expect(actual).toEqual({ ...row, ...extras });
	});
	it("keeps cursor tie-breaking, first-page totals, optional body/rollups and assignee metadata", async () => {
		for (let i = 0; i < 3; i++)
			await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, {
				createdAt: 100,
				assigneeId: fixture.userId,
			});
		const page = await Effect.runPromise(
			queries.listIssues(env.DB, fixture.workspaceId, { limit: 2, includeRollups: true }),
		);
		expect(page.total).toBe(3);
		expect(page.items[0]).not.toHaveProperty("body");
		expect(page.items[0].assignee_name).toBe("Test User");
		expect(page.items[0].rollup).toEqual({ total: 0, byStatus: {}, done: 0, remaining: 0 });
		const [createdAt, id] = page.nextCursor!.split(":");
		const next = await Effect.runPromise(
			queries.listIssues(env.DB, fixture.workspaceId, {
				limit: 2,
				cursor: { createdAt: Number(createdAt), id },
				includeBody: true,
			}),
		);
		expect(next.total).toBeNull();
		expect(next.items).toHaveLength(1);
		expect(next.items[0]).toHaveProperty("body", "");
		expect(new Set([...page.items, ...next.items].map((r) => r.id)).size).toBe(3);
		const actual = await api("issues?limit=2&includeRollups=1");
		expect({
			...actual,
			items: (actual.items as Record<string, unknown>[]).map(({ url: _url, ...row }) => row),
		}).toEqual(page);
	});
	it("takes app-supplied visibility and applies numeric custom-field filters without owning authorization", async () => {
		const visible = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId);
		const hiddenProject = await seedProject(fixture.workspaceId, "HIDDEN");
		await seedIssue(fixture.workspaceId, hiddenProject.id, fixture.userId);
		const field = await seedCustomFieldDef(fixture.workspaceId, { key: "size", type: "number" });
		await seedCustomFieldValue(visible.id, field.id, "10");
		const definition = await Effect.runPromise(
			queries.findIssueCustomField(env.DB, fixture.workspaceId, "size"),
		);
		expect(definition?.id).toBe(field.id);
		const page = await Effect.runPromise(
			queries.listIssues(
				env.DB,
				fixture.workspaceId,
				{ limit: 30, customField: { id: field.id, op: "gte", value: "5" } },
				eq(schema.issues.projectId, fixture.projectId),
			),
		);
		expect(page.items.map((r) => r.id)).toEqual([visible.id]);
		expect(
			await Effect.runPromise(queries.findIssueCustomField(env.DB, fixture.workspaceId, "missing")),
		).toBeNull();
	});
	it("preserves batch order, padded refs, deduplication and caller identifiers for missing rows", async () => {
		const first = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId);
		const second = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId);
		const page = await Effect.runPromise(
			queries.getIssuesBatch(env.DB, fixture.workspaceId, {
				refs: [`PROJ-0${second.number}`, "PROJ-999"],
				ids: [first.id, second.id, "missing"],
			}),
		);
		expect(page.items.map((r) => r.id)).toEqual([second.id, first.id]);
		expect(page.missing).toEqual(["PROJ-999", "missing"]);
		expect(page.items[0]).not.toHaveProperty("body");
		const actual = await api(
			`issues/batch?refs=PROJ-0${second.number},PROJ-999&ids=${first.id},${second.id},missing`,
		);
		expect({
			...actual,
			items: (actual.items as Record<string, unknown>[]).map(({ url: _url, ...row }) => row),
		}).toEqual(page);
	});
	it("scopes single rows, comments, fields and links to the workspace independently", async () => {
		const issue = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId);
		await seedComment(issue.id, fixture.userId, "Shared comment");
		const other = await seedProjectFixture({ role: "owner" });
		expect(
			await Effect.runPromise(queries.getIssue(env.DB, other.workspaceId, { id: issue.id })),
		).toBeNull();
		expect(await Effect.runPromise(listComments(env.DB, other.workspaceId, issue.id))).toEqual([]);
		expect(await Effect.runPromise(listLinksForIssue(env.DB, other.workspaceId, issue.id))).toEqual(
			[],
		);
		expect(
			await Effect.runPromise(batchLoadCustomFields(env.DB, other.workspaceId, [issue.id])),
		).toEqual({});
		const rows = await Effect.runPromise(listComments(env.DB, fixture.workspaceId, issue.id));
		const actual = await api(`issues/${issue.id}/comments`);
		expect(actual).toEqual(rows);
	});
	it("preserves directional links and taxonomy/definition data conversion", async () => {
		const source = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId);
		const target = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId);
		await env.DB.prepare(
			"INSERT INTO issue_links (id,workspace_id,source_issue_id,target_issue_id,type,created_by_id,created_at) VALUES (?,?,?,?,?,?,?)",
		)
			.bind(
				crypto.randomUUID(),
				fixture.workspaceId,
				source.id,
				target.id,
				"blocks",
				fixture.userId,
				1,
			)
			.run();
		const links = await Effect.runPromise(
			listLinksForIssue(env.DB, fixture.workspaceId, target.id),
		);
		expect(links[0]).toMatchObject({
			type: "blocked_by",
			linkedIssueId: source.id,
			linkedIssueProjectKey: "PROJ",
		});
		expect(await api(`issues/${target.id}/links`)).toEqual(links);
		await seedTaskStatus(fixture.workspaceId);
		await seedTaskType(fixture.workspaceId);
		await seedCustomFieldDef(fixture.workspaceId, {
			key: "choice",
			type: "select",
			options: ["A", "B"],
		});
		expect(await api("task-statuses")).toEqual(
			await Effect.runPromise(listTaskStatuses(env.DB, fixture.workspaceId)),
		);
		expect(await api("task-types")).toEqual(
			await Effect.runPromise(listTaskTypes(env.DB, fixture.workspaceId)),
		);
		expect(await api("custom-fields")).toEqual(
			await Effect.runPromise(listCustomFieldDefs(env.DB, fixture.workspaceId)),
		);
	});
	it("uses literal FTS sanitization and unchanged search result keys", async () => {
		const issue = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, {
			title: "needle issue",
		});
		await env.DB.prepare(
			"INSERT INTO issues_fts(issue_id,workspace_id,title,body) VALUES (?,?,?,?)",
		)
			.bind(issue.id, fixture.workspaceId, "needle issue", "")
			.run();
		const rows = await Effect.runPromise(
			queries.searchIssues(env.DB, fixture.workspaceId, { query: "needle", limit: 20 }),
		);
		expect(rows[0]).toEqual({
			id: issue.id,
			number: issue.number,
			title: "needle issue",
			status: "backlog",
			priority: "none",
			project_id: fixture.projectId,
			project_key: "PROJ",
			project_name: "Test Project",
		});
		expect(await api("issues/search?q=needle")).toEqual(rows);
		expect(
			await Effect.runPromise(
				queries.searchIssues(env.DB, fixture.workspaceId, { query: "***", limit: 20 }),
			),
		).toEqual([]);
		expect(
			await Effect.runPromise(
				queries.searchIssues(env.DB, fixture.workspaceId, { query: "needle OR", limit: 20 }),
			),
		).toEqual([]);
	});
});
