import { Effect } from 'effect'
import type { Context, Next } from 'hono'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'
import { CorePublicError } from 'projektor/core-client'

import { ApiWorkspace } from '#contracts/api-auth.ts'
import type { HonoEnv } from '#types'

export const subdomainRoutingEnabled = function subdomainRoutingEnabled(value: string | undefined): boolean {
  return ['true', '1', 'yes'].includes(value?.trim().toLowerCase() ?? '')
}

export const mcpWorkspaceIdFromPath = function mcpWorkspaceIdFromPath(path: string): string | undefined {
  return /^\/mcp\/([^/]+)$/.exec(path)?.[1]
}

const warnIfIgnoredSubdomain = async function warnIfIgnoredSubdomain(
  httpContext: Context<HonoEnv>,
  routingEnabled: boolean,
): Promise<void> {
  if (routingEnabled) {
    return
  }
  const hostname = httpContext.req.header('host')?.split(':')[0]
  if (!hostname || hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return
  }
  const labels = hostname.split('.')
  if (labels.length < 3 || !labels[0]) {
    return
  }
  try {
    await Effect.runPromise(
      decodeCoreReply(
        ApiWorkspace,
        makeCoreClient(httpContext.env.CORE).apiResolveWorkspace(httpContext.get('coreActor'), {
          kind: 'slug',
          value: labels[0],
        }),
      ),
    )
    console.warn(
      'An authorized workspace subdomain was ignored because WORKSPACE_SUBDOMAIN_ROUTING is off; rejecting request',
    )
  } catch {
    // This optional diagnostic must not replace the fail-closed missing-target response.
  }
}

/** Routing chooses a target only. Core resolves membership and scope for every operation. */
export const workspaceMiddleware = async function workspaceMiddleware(httpContext: Context<HonoEnv>, next: Next) {
  const routingEnabled = subdomainRoutingEnabled(httpContext.env.WORKSPACE_SUBDOMAIN_ROUTING)
  const slug =
    httpContext.req.header('X-Workspace-Slug') ??
    (routingEnabled ? httpContext.req.header('host')?.split('.')[0] : undefined) ??
    (httpContext.get('allowQueryWorkspaceFallback') ? httpContext.req.query('workspace') : undefined)
  const workspaceId = slug ? undefined : mcpWorkspaceIdFromPath(httpContext.req.path)
  if (!slug && !workspaceId) {
    await warnIfIgnoredSubdomain(httpContext, routingEnabled)
    return httpContext.json(
      {
        error: routingEnabled ? 'Workspace not specified' : 'Workspace not specified: missing X-Workspace-Slug header',
      },
      400,
    )
  }
  const target = slug ? { kind: 'slug' as const, value: slug } : { kind: 'id' as const, value: workspaceId ?? '' }
  try {
    const workspace = await Effect.runPromise(
      decodeCoreReply(
        ApiWorkspace,
        makeCoreClient(httpContext.env.CORE).apiResolveWorkspace(httpContext.get('coreActor'), target),
      ),
    )
    httpContext.set('workspace', { id: workspace.id, name: workspace.name, slug: workspace.slug })
    httpContext.set('role', workspace.role)
    return next()
  } catch (error) {
    if (!(error instanceof CorePublicError)) {
      throw error
    }
    return Response.json({ error: error.message }, { status: error.status })
  }
}
