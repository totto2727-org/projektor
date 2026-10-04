import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createRequestApi, type RequestApi } from "../../server/api-client";
import type { ApiError, ScopeError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
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
const scope: RequestScope = {
	user: { id: "u1", name: "Owner", email: "owner@example.test" },
	workspaces: [workspace],
	projects: [],
	selection: { kind: "workspace", workspace },
};
const group = { id: "g1", name: "Team", description: "Description", memberCount: 1, grantCount: 1 };
const detail = {
	id: "g1",
	name: "Team",
	description: "Description",
	members: [{ userId: "u1", name: "Owner", email: "owner@example.test" }],
	grants: [{ projectId: "p1", projectName: "Project", projectKey: "PROJ", role: "member" }],
};
const member = { id: "u1", name: "Owner", email: "owner@example.test", role: "owner" };
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
type Calls = { path: string; workspace: string | null }[];
function runWithApi<T>(
	resolve: (url: URL) => unknown | Promise<unknown>,
	calls: Calls,
	use: (api: RequestApi) => Effect.Effect<T, ApiError | ScopeError>
): Promise<T> {
	const transport: typeof fetch = async (input, options) => {
		const incoming = new URL(String(input));
		calls.push({
			path: incoming.pathname + incoming.search,
			workspace: new Headers(options?.headers).get("X-Workspace-Slug"),
		});
		const value = await resolve(incoming);
		return value instanceof Response ? value : Response.json(value);
	};
	return Effect.runPromise(
		Effect.gen(function* () {
			const api = yield* createRequestApi(new Request(url), { apiBaseUrl: "https://api.example" });
			return yield* use(api);
		}).pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.provideService(FetchHttpClient.Fetch, transport)
		)
	);
}
function groupPayload(path: string, role = "owner") {
	if (path === "/api/workspaces/alpha/groups") return [group];
	if (path === "/api/workspaces/alpha") return { currentUserRole: role, members: [member] };
	if (path === "/api/projects")
		return [
			{ id: "p1", key: "PROJ", name: "Project", workspace_slug: "alpha" },
			{ id: "p2", key: "OTHER", name: "Other", workspace_slug: "beta" },
		];
	if (path === "/api/workspaces/alpha/member-groups")
		return [{ userId: "u1", groups: [{ id: "g1", name: "Team" }] }];
	return detail;
}

describe("settings native Effect SSR preloads", () => {
	it.each(["groups", "members"] as const)(
		"renders groups %s mode from validated server URL props",
		async (view) => {
			const node = await runWithApi(
				(incoming) => groupPayload(incoming.pathname),
				[],
				(api) =>
					renderGroups(
						api,
						scope,
						new URL(`https://front.example/settings/groups?workspace=alpha&view=${view}`)
					)
			);
			expect(node.props.view).toBe(view);
			const html = renderToStaticMarkup(node);
			expect(html).toContain(`id="group-tabpanel-${view}"`);
			expect(html).toContain(`view=${view}`);
		}
	);
	it("rejects malformed groups view before HTTP loads", async () => {
		const calls: Calls = [];
		await expect(
			runWithApi(
				() => ({}),
				calls,
				(api) =>
					renderGroups(api, scope, new URL("https://front.example/settings/groups?view=unknown"))
			)
		).rejects.toMatchObject({ _tag: "ScopeError", status: 400 });
		expect(calls).toEqual([]);
	});
	it("keeps the personal connector and guide controls when API tokens are forbidden to a member", async () => {
		const node = await runWithApi(
			(incoming) =>
				incoming.pathname.endsWith("/tokens")
					? new Response("private", { status: 403 })
					: incoming.pathname.endsWith("/connectors")
						? [connector]
						: { mcpUrl: "https://api.example/mcp/w1" },
			[],
			(api) => renderTokens(api, scope, url)
		);
		const html = renderToStaticMarkup(node);
		expect(html).toContain("Connect Claude Code");
		expect(html).toContain("Connected applications");
		expect(html).toContain("Disconnect");
		expect(html).toContain("Access denied.");
	});
	it("SSR-builds the original fallback MCP authorization/workspace template without exposing token secrets", async () => {
		const node = await runWithApi(
			(incoming) =>
				incoming.pathname.endsWith("/tokens")
					? [token]
					: incoming.pathname.endsWith("/connectors")
						? []
						: { mcpUrl: "https://api.example/mcp/w1" },
			[],
			(api) => renderTokens(api, scope, url)
		);
		expect(node.props.mcpCommandTemplate).toContain('--header "Authorization: Bearer {{TOKEN}}"');
		expect(node.props.mcpCommandTemplate).toContain('--header "X-Workspace-Slug: alpha"');
	});
	it("loads every original group control DTO server-side, derives detail counts, and filters cross-workspace projects", async () => {
		const calls: Calls = [];
		const node = await runWithApi(
			(incoming) => groupPayload(incoming.pathname),
			calls,
			(api) => renderGroups(api, scope, url)
		);
		expect(node.props.initialData.details[0]).toMatchObject({
			...detail,
			memberCount: 1,
			grantCount: 1,
		});
		expect(node.props.initialData.projects.map((project: { id: string }) => project.id)).toEqual([
			"p1",
		]);
		expect(node.props.initialData.memberGroups).toHaveLength(1);
		expect(calls.map((call) => call.path)).toEqual([
			"/api/workspaces/alpha/groups",
			"/api/workspaces/alpha",
			"/api/projects",
			"/api/workspaces/alpha/member-groups",
			"/api/workspaces/alpha/groups/g1",
		]);
		expect(calls.every((call) => call.workspace === "alpha")).toBe(true);
		expect(renderToStaticMarkup(node)).toContain("Team");
	});
	it("uses the live workspace role and avoids every admin-only detail/member-groups read for nonadmins", async () => {
		const calls: Calls = [];
		const node = await runWithApi(
			(incoming) => groupPayload(incoming.pathname, "member"),
			calls,
			(api) => renderGroups(api, scope, url)
		);
		expect(node.props.initialData.role).toBe("member");
		expect(node.props.initialData.details).toEqual([]);
		expect(node.props.initialData.memberGroups).toEqual([]);
		expect(calls).toHaveLength(3);
		expect(renderToStaticMarkup(node)).toContain("Only owners and admins manage groups.");
	});
	it("bounds detail preload fan-out to four while still preloading all groups", async () => {
		let active = 0;
		let maximum = 0;
		const node = await runWithApi(
			async (incoming) => {
				if (incoming.pathname === "/api/workspaces/alpha/groups")
					return Array.from({ length: 9 }, (_, index) => ({ ...group, id: `g${index}` }));
				if (incoming.pathname.startsWith("/api/workspaces/alpha/groups/")) {
					active += 1;
					maximum = Math.max(maximum, active);
					await new Promise((resolve) => setTimeout(resolve, 5));
					active -= 1;
					return { ...detail, id: incoming.pathname.split("/").at(-1) };
				}
				return groupPayload(incoming.pathname);
			},
			[],
			(api) => renderGroups(api, scope, url)
		);
		expect(node.props.initialData.details).toHaveLength(9);
		expect(maximum).toBe(4);
	});
	it("preloads tokens/templates, connector grants, and guide URLs without storing browser-side primary data", async () => {
		const info = {
			mcpUrl: "https://api.example/mcp/w1",
			mcpAddCommandTemplate: "claude {{TOKEN}} https://api.example/mcp/w1",
		};
		const tokens = await runWithApi(
			(incoming) =>
				incoming.pathname.endsWith("/tokens")
					? [token]
					: incoming.pathname.endsWith("/connectors")
						? [connector]
						: info,
			[],
			(api) => renderTokens(api, scope, url)
		);
		expect(tokens.props.initialTokens).toEqual([token]);
		expect(tokens.props.mcpCommandTemplate).toBe(info.mcpAddCommandTemplate);
		expect(renderToStaticMarkup(tokens)).toContain("Agent token");
		expect(tokens.props.initialGrants).toEqual([connector]);
		const composed = renderToStaticMarkup(tokens);
		expect(composed).toContain("Connect Claude Code");
		expect(composed).toContain("Connected applications");
		expect(composed).toContain("Disconnect");
		const connectors = await runWithApi(
			() => [connector],
			[],
			(api) => renderConnectors(api, scope, url)
		);
		expect(connectors.props.initialGrants).toEqual([connector]);
		expect(renderToStaticMarkup(connectors)).toContain("Claude");
		const guide = await runWithApi(
			() => info,
			[],
			(api) => renderConnectAgent(api, scope, url)
		);
		expect(guide.props.mcpUrl).toBe(info.mcpUrl);
		expect(renderToStaticMarkup(guide)).toContain(info.mcpUrl);
	});
	it("keeps original forbidden guidance, tolerates unavailable optional MCP metadata, and propagates core failures", async () => {
		const denied = () => new Response("private", { status: 403 });
		const groups = await runWithApi(denied, [], (api) => renderGroups(api, scope, url));
		expect(renderToStaticMarkup(groups)).toContain("Only workspace owners and admins");
		const tokens = await runWithApi(denied, [], (api) => renderTokens(api, scope, url));
		expect(renderToStaticMarkup(tokens)).toContain("Access denied.");
		const connectors = await runWithApi(denied, [], (api) => renderConnectors(api, scope, url));
		expect(renderToStaticMarkup(connectors)).toContain("Signed-in members only.");
		const degraded = await runWithApi(
			(incoming) =>
				incoming.pathname.endsWith("/tokens")
					? [token]
					: incoming.pathname.endsWith("/connectors")
						? []
						: new Response("private", { status: 503 }),
			[],
			(api) => renderTokens(api, scope, url)
		);
		expect(degraded.props.initialTokens).toEqual([token]);
		expect(degraded.props.mcpUrl).toBeNull();
		await expect(
			runWithApi(
				() => new Response("private", { status: 503 }),
				[],
				(api) => renderGroups(api, scope, url)
			)
		).rejects.toMatchObject({ kind: "http", status: 503 });
	});
	it("rejects invalid scope strings, timestamps, grant roles, and metadata types with Schema", () => {
		expect(() => Schema.decodeUnknownSync(TokenSchema)({ ...token, scopes: ["read"] })).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(ConnectorSchema)({ ...connector, expiresAt: "tomorrow" })
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(GroupDetailSchema)({
				...detail,
				grants: [{ ...detail.grants[0], role: "owner" }],
			})
		).toThrow();
		expect(() => Schema.decodeUnknownSync(McpInfoSchema)({ mcpUrl: 42 })).toThrow();
		expect(
			Schema.decodeUnknownSync(McpInfoSchema)({ mcpUrl: "https://api.example/mcp/w1" })
		).toEqual({ mcpUrl: "https://api.example/mcp/w1" });
	});
});
