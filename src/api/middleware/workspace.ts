import { String, Predicate } from 'effect'
import type { Context, Next } from 'hono'
import { makeCoreClient, CorePublicError } from 'projektor/core-client'

import { apiReply } from '#api/services/reply.ts'
import { ApiWorkspace } from '#contracts/api-auth.ts'
import { HTTP_BAD_REQUEST } from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

export const subdomainRoutingEnabled = function subdomainRoutingEnabled(value: string | undefined): boolean {
  return ['true', '1', 'yes'].includes(value?.trim().toLowerCase() ?? '')
}

export const mcpWorkspaceIdFromPath = function mcpWorkspaceIdFromPath(path: string): string | undefined {
  return /^\/mcp\/(?<workspaceId>[^/]+)$/u.exec(path)?.groups?.workspaceId
}

const warnIfIgnoredSubdomain = async function warnIfIgnoredSubdomain(
  httpContext: Context<HonoEnv>,
  routingEnabled: boolean,
): Promise<void> {
  if (routingEnabled) {
    return
  }
  const hostname = httpContext.req.header('host')?.split(':')[0]
  if (
    Predicate.isNullish(hostname) ||
    String.isEmpty(hostname) ||
    hostname === 'localhost' ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)
  ) {
    return
  }
  const labels = hostname.split('.')
  if (labels.length < 3 || !labels[0]) {
    return
  }
  try {
    await apiReply(
      ApiWorkspace,
      makeCoreClient(httpContext.env.CORE).apiResolveWorkspace(httpContext.get('coreActor'), {
        kind: 'slug',
        value: labels[0],
      }),
    )
    console.warn(
      'An authorized workspace subdomain was ignored because WORKSPACE_SUBDOMAIN_ROUTING is off; rejecting request',
    )
  } catch {
    // This optional diagnostic must not replace the fail-closed missing-target response.
  }
}

/**
 * Routing chooses a target only. Core resolves membership and scope for every operation.
 *
 * @param {Context<HonoEnv>} httpContext The Hono request context from which to read workspace selectors.
 * @param {Next} next The downstream handler invoked after a workspace is resolved.
 * @returns {Promise<void | Response>} A workspace error response or the downstream completion.
 */
export const workspaceMiddleware = async function workspaceMiddleware(
  httpContext: Context<HonoEnv>,
  next: Next,
): Promise<void | Response> {
  const routingEnabled = subdomainRoutingEnabled(httpContext.env.WORKSPACE_SUBDOMAIN_ROUTING)
  const slug =
    httpContext.req.header('X-Workspace-Slug') ??
    (routingEnabled ? httpContext.req.header('host')?.split('.')[0] : undefined) ??
    (httpContext.get('allowQueryWorkspaceFallback') === true ? httpContext.req.query('workspace') : undefined)
  const workspaceId =
    Predicate.isNotNullish(slug) && String.isNonEmpty(slug) ? undefined : mcpWorkspaceIdFromPath(httpContext.req.path)
  if (
    (Predicate.isNullish(slug) || String.isEmpty(slug)) &&
    (Predicate.isNullish(workspaceId) || String.isEmpty(workspaceId))
  ) {
    await warnIfIgnoredSubdomain(httpContext, routingEnabled)
    return httpContext.json(
      {
        error: routingEnabled ? 'Workspace not specified' : 'Workspace not specified: missing X-Workspace-Slug header',
      },
      HTTP_BAD_REQUEST,
    )
  }
  const target =
    Predicate.isNotNullish(slug) && String.isNonEmpty(slug)
      ? { kind: 'slug' as const, value: slug }
      : { kind: 'id' as const, value: workspaceId ?? '' }
  try {
    const workspace = await apiReply(
      ApiWorkspace,
      makeCoreClient(httpContext.env.CORE).apiResolveWorkspace(httpContext.get('coreActor'), target),
    )
    httpContext.set('workspace', { id: workspace.id, name: workspace.name, slug: workspace.slug })
    httpContext.set('role', workspace.role)
    // oxlint-disable-next-line typescript/return-await -- This catch handles synchronous continuation failures. Downstream rejections still reach Hono.
    return next()
  } catch (error) {
    if (!(error instanceof CorePublicError)) {
      throw error
    }
    return Response.json({ error: error.message }, { status: error.status })
  }
}
