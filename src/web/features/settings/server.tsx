import * as groupQueries from "#services/groups";
import { listWorkspaceMembers, listWorkspaceTokenMetadata } from "#services/workspaces";
import { Effect, Schema } from "effect";
import { RequestServices } from "../../request";
import { dataError, makeDataContext } from "../../server/data-context";
import { HttpClientResponse } from "effect/http";
import type { RequestApi } from "../../server/api-client";
import { responseError, ScopeError } from "../../server/errors";
import type { RequestScope, WorkspaceMembership } from "../../server/request-context";
import { GroupViewSchema } from "./input-schemas";
import {
	ConnectorsSchema,
	GroupDetailSchema,
	GroupsSchema,
	McpInfoSchema,
	MemberGroupsSchema,
	ProjectsSchema,
	TokensSchema,
} from "./schemas";
import type { ConnectorGrant, Token } from "./types";
import { ConnectAgentGuide, ConnectorManager, GroupManager, TokenManager } from "./widgets";

const choose = (scope: RequestScope): WorkspaceMembership | null =>
	scope.selection.kind === "workspace" || scope.selection.kind === "project"
		? scope.selection.workspace
		: null;
const forbidden = (error: { status: number }) => error.status === 403;
const isAdmin = (role: string) => role === "owner" || role === "admin";
function dataContext(
	services: Parameters<typeof makeDataContext>[0],
	scope: RequestScope,
	workspaceId: string,
) {
	return Effect.try({
		try: () => makeDataContext(services, scope, workspaceId),
		catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
	});
}

function TokenSettings({
	workspaceSlug,
	initialTokens,
	initialGrants,
	mcpUrl,
	mcpCommandTemplate,
	tokensDenied,
	connectorsDenied,
}: {
	workspaceSlug: string;
	initialTokens: Token[];
	initialGrants: ConnectorGrant[];
	mcpUrl: string | null;
	mcpCommandTemplate: string | null;
	tokensDenied: boolean;
	connectorsDenied: boolean;
}) {
	return (
		<div>
			<header className="mb-6">
				<h1 className="m-0 mb-1 text-2xl font-bold text-text-base">Connect Claude Code</h1>
				<p className="m-0 text-sm text-text-muted">
					Any workspace member can connect their own agent, access is automatically scoped to your
					role and group grants.
				</p>
			</header>
			<ConnectAgentGuide workspaceSlug={workspaceSlug} mcpUrl={mcpUrl} />
			<header className="mt-10 mb-6">
				<h2 className="m-0 mb-1 text-xl font-bold text-text-base">Connected applications</h2>
				<p className="m-0 text-sm text-text-muted">
					Applications you have authorized to reach this workspace on your behalf. Yours only, other
					members manage their own.
				</p>
			</header>
			{connectorsDenied ? (
				<div className="p-4 bg-surface border border-border rounded-md text-text-muted">
					<strong>Signed-in members only.</strong> Connectors are personal credentials, so the
					shared read-only demo viewer has none to show.
				</div>
			) : (
				<ConnectorManager workspaceSlug={workspaceSlug} initialGrants={initialGrants} />
			)}
			<header className="mt-10 mb-6">
				<h2 className="m-0 mb-1 text-xl font-bold text-text-base">API tokens, admins only</h2>
				<p className="m-0 text-sm text-text-muted">
					Shared workspace tokens for agents and scripts that can't use the connector sign-in flow
					above.
				</p>
			</header>
			{tokensDenied ? (
				<div className="p-4 bg-surface border border-border rounded-md text-text-muted">
					<strong>Access denied.</strong> Only workspace owners and admins can manage API tokens.
				</div>
			) : (
				<TokenManager
					workspaceSlug={workspaceSlug}
					initialTokens={initialTokens}
					mcpUrl={mcpUrl}
					mcpCommandTemplate={mcpCommandTemplate}
				/>
			)}
		</div>
	);
}
export function renderGroups(_api: RequestApi, scope: RequestScope, url: URL) {
	return Effect.gen(function* () {
		const workspace = choose(scope);
		if (!workspace) return <p className="text-text-muted">Select a workspace to manage groups.</p>;
		const slug = workspace.slug;
		const view = yield* Schema.decodeUnknownEffect(GroupViewSchema)(
			url.searchParams.get("view") ?? "groups",
		).pipe(Effect.mapError(() => new ScopeError(400, "Invalid groups view.")));
		const services = yield* RequestServices;
		const ctx = yield* dataContext(services, scope, workspace.id);
		const admin = isAdmin(ctx.workspace.role);
		const [groups, members, projects] = yield* Effect.all(
			[
				groupQueries
					.listGroups(ctx.db, ctx.workspaceId, admin ? {} : { memberUserId: ctx.userId })
					.pipe(
						Effect.flatMap(Schema.decodeUnknownEffect(GroupsSchema)),
						Effect.mapError(dataError),
					),
				listWorkspaceMembers(ctx.db, ctx.workspaceId).pipe(Effect.mapError(dataError)),
				Schema.decodeUnknownEffect(ProjectsSchema)(
					scope.projects.filter((project) => project.workspace_id === ctx.workspaceId),
				).pipe(Effect.mapError(dataError)),
			],
			{ concurrency: 3 },
		);
		// Only admins may enumerate the workspace member/group matrix or preload management details.
		const [memberGroups, details] = admin
			? yield* Effect.all(
					[
						groupQueries
							.listMemberGroups(ctx.db, ctx.workspaceId)
							.pipe(
								Effect.flatMap(Schema.decodeUnknownEffect(MemberGroupsSchema)),
								Effect.mapError(dataError),
							),
						Effect.all(
							groups.map((group) =>
								Effect.gen(function* () {
									const [groupMembers, grants] = yield* Effect.all(
										[
											groupQueries.listGroupMembers(ctx.db, ctx.workspaceId, group.id),
											groupQueries.listGroupGrants(ctx.db, ctx.workspaceId, group.id),
										],
										{ concurrency: 2 },
									);
									return yield* Schema.decodeUnknownEffect(GroupDetailSchema)({
										...group,
										members: groupMembers,
										grants,
									});
								}).pipe(Effect.mapError(dataError)),
							),
							{ concurrency: 4 },
						),
					],
					{ concurrency: 2 },
				)
			: [[], []];
		return (
			<GroupManager
				key={slug}
				workspaceSlug={slug}
				view={admin ? view : "groups"}
				initialData={{
					groups,
					details: details.map((detail) => ({
						...detail,
						memberCount: detail.members.length,
						grantCount: detail.grants.length,
					})),
					members: members.map(({ id, email, name, role }) => ({ id, email, name, role })),
					memberGroups,
					projects: projects.filter((project) => project.workspace_slug === slug),
					role: ctx.workspace.role,
				}}
			/>
		);
	}).pipe(
		Effect.catchIf(forbidden, () =>
			Effect.succeed(
				<div className="border border-border rounded-lg bg-surface p-4 mb-4">
					Only workspace owners and admins can manage groups.
				</div>,
			),
		),
	);
}
export function renderTokens(api: RequestApi, scope: RequestScope, _url: URL) {
	return Effect.gen(function* () {
		const workspace = choose(scope);
		if (!workspace) return <p className="text-text-muted">Select a workspace to manage tokens.</p>;
		const slug = workspace.slug;
		const services = yield* RequestServices;
		const ctx = yield* dataContext(services, scope, workspace.id);
		const [tokenSection, connectorSection, info] = yield* Effect.all(
			[
				isAdmin(ctx.workspace.role)
					? listWorkspaceTokenMetadata(ctx.db, ctx.workspaceId).pipe(
							Effect.map((tokens) =>
								tokens.map((token) => ({ ...token, scopes: JSON.stringify(token.scopes) })),
							),
							Effect.flatMap(Schema.decodeUnknownEffect(TokensSchema)),
							Effect.mapError(dataError),
							Effect.map((tokens) => ({ tokens, denied: false })),
						)
					: Effect.succeed({ tokens: [], denied: true }),
				api
					.execute(
						api.get(`/api/workspaces/${encodeURIComponent(slug)}/connectors`, {
							workspaceSlug: slug,
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(ConnectorsSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					)
					.pipe(
						Effect.map((grants) => ({ grants, denied: false })),
						Effect.catchIf(forbidden, () => Effect.succeed({ grants: [], denied: true })),
					),
				api
					.execute(
						api.get(`/api/workspaces/${encodeURIComponent(slug)}/mcp-info`, {
							workspaceSlug: slug,
						}),
					)
					.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(McpInfoSchema)),
						Effect.mapError(responseError),
						Effect.scoped,
					)
					.pipe(Effect.catch(() => Effect.succeed(null))),
			],
			{ concurrency: 3 },
		);
		const template =
			info?.mcpAddCommandTemplate ??
			(info?.mcpUrl
				? [
						`claude mcp add --transport http \\`,
						`  --header "Authorization: Bearer {{TOKEN}}" \\`,
						`  --header "X-Workspace-Slug: ${slug}" \\`,
						`  projektor "${info.mcpUrl}"`,
					].join("\n")
				: null);
		return (
			<TokenSettings
				key={slug}
				workspaceSlug={slug}
				initialTokens={tokenSection.tokens}
				initialGrants={connectorSection.grants}
				mcpUrl={info?.mcpUrl ?? null}
				mcpCommandTemplate={template}
				tokensDenied={tokenSection.denied}
				connectorsDenied={connectorSection.denied}
			/>
		);
	}).pipe(
		Effect.catchIf(forbidden, () =>
			Effect.succeed(
				<div className="p-4 bg-surface border border-border rounded-md text-text-muted">
					<strong>Access denied.</strong> Only workspace owners and admins can manage API tokens.
				</div>,
			),
		),
	);
}
export function renderConnectAgent(api: RequestApi, scope: RequestScope, _url: URL) {
	return Effect.gen(function* () {
		const workspace = choose(scope);
		if (!workspace)
			return <p className="text-text-muted">Select a workspace to connect an agent.</p>;
		const info = yield* api
			.execute(
				api.get(`/api/workspaces/${encodeURIComponent(workspace.slug)}/mcp-info`, {
					workspaceSlug: workspace.slug,
				}),
			)
			.pipe(
				Effect.flatMap(HttpClientResponse.schemaBodyJson(McpInfoSchema)),
				Effect.mapError(responseError),
				Effect.scoped,
			)
			.pipe(Effect.catch(() => Effect.succeed(null)));
		return (
			<ConnectAgentGuide
				key={workspace.slug}
				workspaceSlug={workspace.slug}
				mcpUrl={info?.mcpUrl ?? null}
			/>
		);
	});
}
export function renderConnectors(api: RequestApi, scope: RequestScope, _url: URL) {
	return Effect.gen(function* () {
		const workspace = choose(scope);
		if (!workspace)
			return <p className="text-text-muted">Select a workspace to manage connectors.</p>;
		const grants = yield* api
			.execute(
				api.get(`/api/workspaces/${encodeURIComponent(workspace.slug)}/connectors`, {
					workspaceSlug: workspace.slug,
				}),
			)
			.pipe(
				Effect.flatMap(HttpClientResponse.schemaBodyJson(ConnectorsSchema)),
				Effect.mapError(responseError),
				Effect.scoped,
			);
		return (
			<ConnectorManager
				key={workspace.slug}
				workspaceSlug={workspace.slug}
				initialGrants={grants}
			/>
		);
	}).pipe(
		Effect.catchIf(forbidden, () =>
			Effect.succeed(
				<div className="p-4 bg-surface border border-border rounded-md text-text-muted">
					<strong>Signed-in members only.</strong> Connectors are personal credentials, so the
					shared read-only demo viewer has none to show.
				</div>,
			),
		),
	);
}
