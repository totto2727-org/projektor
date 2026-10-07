import { Effect, Schema } from "effect";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { RequestServices } from "../../request";
import { ApiError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
import { createTestDatabase } from "../../test/database";
import { jsonResponse, testRequestApi } from "../wiki/test-api";
import { ConnectorSchema, GroupDetailSchema, McpInfoSchema, TokenSchema } from "./schemas";
import { renderConnectAgent, renderConnectors, renderGroups, renderTokens } from "./server";

vi.mock("./actions", () => ({
	createGroup: vi.fn(),
	renameGroup: vi.fn(),
	describeGroup: vi.fn(),
	deleteGroup: vi.fn(),
	addGroupMember: vi.fn(),
	removeGroupMember: vi.fn(),
	createGroupGrant: vi.fn(),
	setGroupGrant: vi.fn(),
	removeGroupGrant: vi.fn(),
	createToken: vi.fn(),
	revokeToken: vi.fn(),
	disconnectConnector: vi.fn(),
}));
const workspace = { id: "w1", name: "Alpha", slug: "alpha", role: "owner" as const };
const project = {
	id: "p1",
	name: "Project",
	key: "PROJ",
	slug: "project",
	description: null,
	workspace_id: "w1",
	workspace_name: "Alpha",
	workspace_slug: "alpha",
	open_issue_count: 0,
	backlog_issue_count: 0,
	archived_at: null,
	created_at: 1,
	updated_at: 1,
};
const scope: RequestScope = {
	user: { id: "u1", name: "Owner", email: "owner@example.test" },
	workspaces: [workspace],
	projects: [project],
	selection: { kind: "workspace", workspace },
};
const token = {
	id: "t1",
	name: "Agent token",
	scopes: '["read"]',
	lastUsedAt: null,
	expiresAt: null,
	createdAt: 1,
};
const connector = {
	id: "c1",
	client: "Claude",
	clientId: "client-one",
	scopes: ["read", "write"],
	grantedAt: 1,
	expiresAt: 2000000000,
};
const url = new URL("https://front.example/settings?workspace=alpha");
const databases: ReturnType<typeof createTestDatabase>[] = [];
afterEach(() => {
	for (const database of databases.splice(0)) database.close();
});
function fixture(
	currentScope = scope,
	resolve: (path: string) => unknown = (path) =>
		path.endsWith("/connectors") ? [connector] : { mcpUrl: "https://api.example/mcp/w1" },
) {
	const database = createTestDatabase();
	databases.push(database);
	database.sqlite.exec(`
		INSERT INTO users (id,email,name,created_at) VALUES ('u1','owner@example.test','Owner',1);
		INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w1','Alpha','alpha',1),('w2','Beta','beta',1);
		INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',1);
		INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES ('p1','w1','Project','PROJ',1,1),('p2','w2','Private','PRIV',1,1);
		INSERT INTO user_groups (id,workspace_id,name,description,created_at) VALUES ('g1','w1','Team','Description',1),('g2','w1','Other group',NULL,1),('foreign','w2','Private group',NULL,1);
		INSERT INTO user_group_members (group_id,user_id,added_at,added_by) VALUES ('g1','u1',1,'u1');
		INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','member');
		INSERT INTO api_tokens (id,user_id,workspace_id,name,token_hash,scopes,created_at) VALUES ('t1','u1','w1','Agent token','secret-token-hash','["read"]',1),('foreign-token','u1','w2','Private token','private-hash','["read"]',1);
	`);
	const calls: string[] = [];
	const api = testRequestApi((outgoing) => {
		calls.push(outgoing.url);
		if (!outgoing.url.endsWith("/connectors") && !outgoing.url.endsWith("/mcp-info"))
			return Effect.die("Pure settings reads must use DB");
		const value = resolve(outgoing.url);
		return value instanceof ApiError ? Effect.fail(value) : jsonResponse(outgoing, value);
	});
	const request = new Request(url);
	const services = {
		api,
		request,
		env: { API_BASE: "https://api.example", DB: database.db },
		db: database.db,
		url,
		scope: () => Effect.succeed(currentScope),
		prepare: <T,>(view: T) => view,
		invalidate: Effect.void,
	};
	function run<T, E>(effect: Effect.Effect<T, E, RequestServices>) {
		return Effect.runPromise(effect.pipe(Effect.provideService(RequestServices, services)));
	}
	return { ...database, api, calls, run };
}

describe("settings authorized direct D1 SSR", () => {
	it.each(["groups", "members"] as const)(
		"keeps canonical native URL %s view and original DTOs",
		async (view) => {
			const f = fixture();
			const node = await f.run(
				renderGroups(
					f.api,
					scope,
					new URL(`https://front.example/settings/groups?workspace=alpha&view=${view}`),
				),
			);
			expect(node.props.view).toBe(view);
			expect(node.props.initialData.groups.map((group: { id: string }) => group.id)).toEqual([
				"g2",
				"g1",
			]);
			expect(
				node.props.initialData.details.find((group: { id: string }) => group.id === "g1"),
			).toMatchObject({
				id: "g1",
				memberCount: 1,
				grantCount: 1,
				members: [{ userId: "u1", name: "Owner", email: "owner@example.test" }],
				grants: [{ projectId: "p1", projectName: "Project", projectKey: "PROJ", role: "member" }],
			});
			expect(node.props.initialData.projects.map((project: { id: string }) => project.id)).toEqual([
				"p1",
			]);
			expect(node.props.initialData.memberGroups).toEqual([
				{ userId: "u1", groups: [{ id: "g1", name: "Team" }] },
			]);
			expect(f.calls).toEqual([]);
			expect(renderToStaticMarkup(node)).toContain(`id="group-tabpanel-${view}"`);
		},
	);
	it("rejects malformed view before database queries", async () => {
		const f = fixture();
		const prepare = vi.spyOn(f.db, "prepare");
		await expect(
			f.run(
				renderGroups(f.api, scope, new URL("https://front.example/settings/groups?view=unknown")),
			),
		).rejects.toMatchObject({ _tag: "ScopeError", status: 400 });
		expect(prepare).not.toHaveBeenCalled();
	});
	it("filters member groups and avoids every management detail/member-group query for nonadmins", async () => {
		const member = { ...workspace, role: "member" as const };
		const memberScope: RequestScope = {
			...scope,
			workspaces: [member],
			selection: { kind: "workspace", workspace: member },
		};
		const f = fixture(memberScope);
		const prepare = vi.spyOn(f.db, "prepare");
		const node = await f.run(
			renderGroups(
				f.api,
				memberScope,
				new URL("https://front.example/settings/groups?view=members"),
			),
		);
		expect(node.props.view).toBe("groups");
		expect(node.props.initialData.groups.map((group: { id: string }) => group.id)).toEqual(["g1"]);
		expect(node.props.initialData.details).toEqual([]);
		expect(node.props.initialData.memberGroups).toEqual([]);
		expect(prepare).toHaveBeenCalledTimes(2);
		expect(renderToStaticMarkup(node)).toContain("Only owners and admins manage groups.");
	});
	it("loads token metadata only from selected workspace and never serializes credential hashes", async () => {
		const f = fixture();
		const node = await f.run(renderTokens(f.api, scope, url));
		expect(node.props.initialTokens).toEqual([token]);
		expect(node.props.initialGrants).toEqual([connector]);
		expect(node.props.mcpCommandTemplate).toContain('--header "Authorization: Bearer {{TOKEN}}"');
		expect(node.props.mcpCommandTemplate).toContain('--header "X-Workspace-Slug: alpha"');
		expect(JSON.stringify(node.props)).not.toContain("secret-token-hash");
		expect(f.calls.sort()).toEqual([
			"/api/workspaces/alpha/connectors",
			"/api/workspaces/alpha/mcp-info",
		]);
		expect(renderToStaticMarkup(node)).toContain("Agent token");
	});
	it("denies member token reads before DB while preserving personal connector and guide controls", async () => {
		const member = { ...workspace, role: "member" as const };
		const memberScope: RequestScope = {
			...scope,
			workspaces: [member],
			selection: { kind: "workspace", workspace: member },
		};
		const f = fixture(memberScope);
		const prepare = vi.spyOn(f.db, "prepare");
		const node = await f.run(renderTokens(f.api, memberScope, url));
		expect(prepare).not.toHaveBeenCalled();
		expect(node.props.initialTokens).toEqual([]);
		expect(node.props.tokensDenied).toBe(true);
		expect(node.props.initialGrants).toEqual([connector]);
		const html = renderToStaticMarkup(node);
		expect(html).toContain("Connect Claude Code");
		expect(html).toContain("Disconnect");
		expect(html).toContain("Access denied.");
	});
	it("uses API auth boundary only for connector credentials and MCP auth configuration", async () => {
		const f = fixture();
		const connectors = await f.run(renderConnectors(f.api, scope, url));
		expect(connectors.props.initialGrants).toEqual([connector]);
		const guide = await f.run(renderConnectAgent(f.api, scope, url));
		expect(guide.props.mcpUrl).toBe("https://api.example/mcp/w1");
		expect(f.calls).toEqual(["/api/workspaces/alpha/connectors", "/api/workspaces/alpha/mcp-info"]);
	});
	it("rejects forged selected workspace membership before DB", async () => {
		const deniedScope: RequestScope = { ...scope, workspaces: [] };
		const f = fixture(deniedScope);
		const prepare = vi.spyOn(f.db, "prepare");
		expect(renderToStaticMarkup(await f.run(renderGroups(f.api, deniedScope, url)))).toContain(
			"Only workspace owners and admins",
		);
		expect(prepare).not.toHaveBeenCalled();
	});
	it("preserves forbidden connector guidance and optional unavailable MCP metadata", async () => {
		const f = fixture(
			scope,
			(path) => new ApiError("http", path.endsWith("/connectors") ? 403 : 503, "Unavailable"),
		);
		const node = await f.run(renderTokens(f.api, scope, url));
		expect(node.props.initialTokens).toEqual([token]);
		expect(node.props.connectorsDenied).toBe(true);
		expect(node.props.mcpUrl).toBeNull();
		expect(renderToStaticMarkup(node)).toContain("Signed-in members only.");
		expect(renderToStaticMarkup(await f.run(renderConnectors(f.api, scope, url)))).toContain(
			"Signed-in members only.",
		);
	});
	it("propagates core DB failures with redacted diagnostics", async () => {
		const f = fixture();
		f.sqlite.exec("DROP TABLE user_groups");
		const error = await f.run(
			renderGroups(f.api, scope, url).pipe(Effect.catch((error) => Effect.succeed(error))),
		);
		expect(error).toMatchObject({
			_tag: "ApiError",
			status: 500,
			message: "Unable to load project data.",
		});
		expect(JSON.stringify(error)).not.toContain("user_groups");
	});
	it("keeps concrete DTO validation for metadata, group roles and MCP config", () => {
		expect(() => Schema.decodeUnknownSync(TokenSchema)({ ...token, scopes: ["read"] })).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(ConnectorSchema)({ ...connector, expiresAt: "tomorrow" }),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(GroupDetailSchema)({
				id: "g1",
				name: "Team",
				description: null,
				members: [],
				grants: [{ projectId: "p1", projectName: "Project", projectKey: "PROJ", role: "owner" }],
			}),
		).toThrow();
		expect(() => Schema.decodeUnknownSync(McpInfoSchema)({ mcpUrl: 42 })).toThrow();
	});
});
