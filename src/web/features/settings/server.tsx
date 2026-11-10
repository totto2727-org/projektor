import { Effect, Schema } from 'effect'

import { browserRequest, coreResult } from '../../core'
import { RequestServices } from '../../request'
import { runBrowserCommand } from '../../server/browser-command'
import { requireDataWorkspace } from '../../server/data-context'
import { ScopeError } from '../../server/errors'
import type { RequestScope, WorkspaceMembership } from '../../server/request-context'
import { GroupViewSchema } from './input-schemas'
import { ConnectorsSchema, McpInfoSchema, SettingsGroupsSchema, SettingsTokensSchema } from './schemas'
import type { ConnectorGrant, Token } from './types'
import { ConnectAgentGuide, ConnectorManager, GroupManager, TokenManager } from './widgets'

const choose = (scope: RequestScope): WorkspaceMembership | null =>
  scope.selection.kind === 'workspace' || scope.selection.kind === 'project' ? scope.selection.workspace : null
const forbidden = (error: { status: number }) => error.status === 403
function selected(scope: RequestScope) {
  return Effect.try({
    try: () => requireDataWorkspace(scope),
    catch: (cause) => (cause instanceof ScopeError ? cause : new ScopeError(403, 'Select an accessible workspace.')),
  })
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
  workspaceSlug: string
  initialTokens: Token[]
  initialGrants: ConnectorGrant[]
  mcpUrl: string | null
  mcpCommandTemplate: string | null
  tokensDenied: boolean
  connectorsDenied: boolean
}) {
  return (
    <div>
      <header className='mb-6'>
        <h1 className='m-0 mb-1 text-2xl font-bold text-text-base'>Connect Claude Code</h1>
        <p className='m-0 text-sm text-text-muted'>
          Any workspace member can connect their own agent, access is automatically scoped to your role and group
          grants.
        </p>
      </header>
      <ConnectAgentGuide workspaceSlug={workspaceSlug} mcpUrl={mcpUrl} />
      <header className='mt-10 mb-6'>
        <h2 className='m-0 mb-1 text-xl font-bold text-text-base'>Connected applications</h2>
        <p className='m-0 text-sm text-text-muted'>
          Applications you have authorized to reach this workspace on your behalf. Yours only, other members manage
          their own.
        </p>
      </header>
      {connectorsDenied ? (
        <div className='p-4 bg-surface border border-border rounded-md text-text-muted'>
          <strong>Signed-in members only.</strong> Connectors are personal credentials, so the shared read-only demo
          viewer has none to show.
        </div>
      ) : (
        <ConnectorManager workspaceSlug={workspaceSlug} initialGrants={initialGrants} />
      )}
      <header className='mt-10 mb-6'>
        <h2 className='m-0 mb-1 text-xl font-bold text-text-base'>API tokens, admins only</h2>
        <p className='m-0 text-sm text-text-muted'>
          Shared workspace tokens for agents and scripts that can't use the connector sign-in flow above.
        </p>
      </header>
      {tokensDenied ? (
        <div className='p-4 bg-surface border border-border rounded-md text-text-muted'>
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
  )
}
export function renderGroups(scope: RequestScope, url: URL) {
  return Effect.gen(function* () {
    const workspace = choose(scope)
    if (!workspace) return <p className='text-text-muted'>Select a workspace to manage groups.</p>
    yield* selected(scope)
    const view = yield* Schema.decodeUnknownEffect(GroupViewSchema)(url.searchParams.get('view') ?? 'groups').pipe(
      Effect.mapError(() => new ScopeError(400, 'Invalid groups view.')),
    )
    const services = yield* RequestServices
    const data = yield* coreResult(
      SettingsGroupsSchema,
      services.core.webSettingsGroups(browserRequest(services.request), workspace.id),
    )
    return (
      <GroupManager
        key={workspace.slug}
        workspaceSlug={workspace.slug}
        view={data.role === 'owner' || data.role === 'admin' ? view : 'groups'}
        initialData={{
          ...data,
          details: data.details.map((detail) => ({
            ...detail,
            memberCount: detail.members.length,
            grantCount: detail.grants.length,
          })),
        }}
      />
    )
  }).pipe(
    Effect.catchIf(forbidden, () =>
      Effect.succeed(
        <div className='border border-border rounded-lg bg-surface p-4 mb-4'>
          Only workspace owners and admins can manage groups.
        </div>,
      ),
    ),
  )
}
export function renderTokens(scope: RequestScope, _url: URL) {
  return Effect.gen(function* () {
    const workspace = choose(scope)
    if (!workspace) return <p className='text-text-muted'>Select a workspace to manage tokens.</p>
    yield* selected(scope)
    const data = yield* runBrowserCommand({ scope, workspaceSlug: workspace.slug }, (client) =>
      coreResult(SettingsTokensSchema, client.core.webSettingsTokens(client.proof)),
    )
    const info = data.info
    const template =
      info?.mcpAddCommandTemplate ??
      (info?.mcpUrl
        ? [
            `claude mcp add --transport http \\`,
            `  --header "Authorization: Bearer {{TOKEN}}" \\`,
            `  --header "X-Workspace-Slug: ${workspace.slug}" \\`,
            `  projektor "${info.mcpUrl}"`,
          ].join('\n')
        : null)
    return (
      <TokenSettings
        key={workspace.slug}
        workspaceSlug={workspace.slug}
        initialTokens={data.tokens}
        initialGrants={data.grants}
        mcpUrl={info?.mcpUrl ?? null}
        mcpCommandTemplate={template}
        tokensDenied={data.tokensDenied}
        connectorsDenied={data.connectorsDenied}
      />
    )
  }).pipe(
    Effect.catchIf(forbidden, () =>
      Effect.succeed(
        <div className='p-4 bg-surface border border-border rounded-md text-text-muted'>
          <strong>Access denied.</strong> Only workspace owners and admins can manage API tokens.
        </div>,
      ),
    ),
  )
}
export function renderConnectAgent(scope: RequestScope, _url: URL) {
  return Effect.gen(function* () {
    const workspace = choose(scope)
    if (!workspace) return <p className='text-text-muted'>Select a workspace to connect an agent.</p>
    const info = yield* runBrowserCommand({ scope, workspaceSlug: workspace.slug }, (client) =>
      coreResult(McpInfoSchema, client.core.webSettingsMcp(client.proof)),
    ).pipe(Effect.catch(() => Effect.succeed(null)))
    return <ConnectAgentGuide key={workspace.slug} workspaceSlug={workspace.slug} mcpUrl={info?.mcpUrl ?? null} />
  })
}
export function renderConnectors(scope: RequestScope, _url: URL) {
  return Effect.gen(function* () {
    const workspace = choose(scope)
    if (!workspace) return <p className='text-text-muted'>Select a workspace to manage connectors.</p>
    const grants = yield* runBrowserCommand({ scope, workspaceSlug: workspace.slug }, (client) =>
      coreResult(ConnectorsSchema, client.core.webSettingsConnectors(client.proof)),
    )
    return <ConnectorManager key={workspace.slug} workspaceSlug={workspace.slug} initialGrants={grants} />
  }).pipe(
    Effect.catchIf(forbidden, () =>
      Effect.succeed(
        <div className='p-4 bg-surface border border-border rounded-md text-text-muted'>
          <strong>Signed-in members only.</strong> Connectors are personal credentials, so the shared read-only demo
          viewer has none to show.
        </div>,
      ),
    ),
  )
}
