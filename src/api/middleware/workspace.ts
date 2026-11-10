import { Effect } from 'effect'
import type { Context, Next } from 'hono'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'
import { CorePublicError } from 'projektor/core-client'

import type { HonoEnv } from '#types'

import { ApiWorkspace } from '../../contracts/api-auth'

export function subdomainRoutingEnabled(value: string | undefined): boolean {
  return ['true', '1', 'yes'].includes(value?.trim().toLowerCase() ?? '')
}

export function mcpWorkspaceIdFromPath(path: string): string | undefined {
  return /^\/mcp\/([^/]+)$/.exec(path)?.[1]
}

/** Routing chooses a target only. Core resolves membership and scope for every operation. */
export async function workspaceMiddleware(c: Context<HonoEnv>, next: Next) {
  const routingEnabled = subdomainRoutingEnabled(c.env.WORKSPACE_SUBDOMAIN_ROUTING)
  const slug =
    c.req.header('X-Workspace-Slug') ??
    (routingEnabled ? c.req.header('host')?.split('.')[0] : undefined) ??
    (c.get('allowQueryWorkspaceFallback') ? c.req.query('workspace') : undefined)
  const workspaceId = slug ? undefined : mcpWorkspaceIdFromPath(c.req.path)
  if (!slug && !workspaceId) {
    return c.json(
      {
        error: routingEnabled ? 'Workspace not specified' : 'Workspace not specified: missing X-Workspace-Slug header',
      },
      400,
    )
  }
  const target = slug ? { kind: 'slug' as const, value: slug } : { kind: 'id' as const, value: workspaceId ?? '' }
  try {
    const workspace = await Effect.runPromise(
      decodeCoreReply(ApiWorkspace, makeCoreClient(c.env.CORE).apiResolveWorkspace(c.get('coreActor'), target)),
    )
    c.set('workspace', { id: workspace.id, name: workspace.name, slug: workspace.slug })
    c.set('role', workspace.role)
    return next()
  } catch (error) {
    if (!(error instanceof CorePublicError)) throw error
    return Response.json({ error: error.message }, { status: error.status })
  }
}
