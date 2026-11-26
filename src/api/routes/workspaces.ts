import { Hono } from 'hono'

import { jsonBody } from '#api/http/body.ts'
import { coreFileRequest } from '#api/http/core-files.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { requireInteractiveHuman } from '#api/middleware/auth.ts'
import { listConnectorGrants, revokeConnectorGrant } from '#api/services/oauth.ts'
import { ctxFromHono } from '#api/services/types.ts'
import {
  createToken,
  deleteWorkspace,
  deleteWorkspaceLogo,
  getWorkspaceBrand,
  getWorkspaceMcpInfo,
  getWorkspaceWithMembers,
  inviteMember,
  listTokens,
  removeMember,
  revokeToken,
  updateMemberRole,
  updateWorkspace,
  updateWorkspaceBrand,
} from '#api/services/workspaces.ts'
import { HTTP_CREATED } from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

export const workspacesRouter = new Hono<HonoEnv>()

// GET / and POST / are handled inline in worker.ts (no workspace context yet at that point)

workspacesRouter.get('/:slug', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const workspace = httpContext.get('workspace')
  try {
    return httpContext.json(await getWorkspaceWithMembers(ctx, workspace))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.patch('/:slug', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await updateWorkspace(ctx, await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.post('/:slug/members', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await inviteMember(ctx, await jsonBody(httpContext)), HTTP_CREATED)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.delete('/:slug/members/:userId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await removeMember(ctx, httpContext.req.param('userId')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.patch('/:slug/members/:userId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await updateMemberRole(ctx, httpContext.req.param('userId'), await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

/*
 * PROJ-917: workspace tokens follow the same rule as personal access tokens
 * (PROJ-903, routes/auth.ts) — minted and revoked only from an interactive human
 * session. Otherwise an agent's pk_ token or OAuth grant could mint a sibling token
 * with wider scopes than its own, and the new secret would land in an agent's
 * context. Chosen over "new scopes must be a subset of the caller's": there is no
 * machine use case for minting workspace tokens. Listing stays open to admins on any
 * credential — it returns no secrets.
 */
const WORKSPACE_TOKEN_HUMAN_ONLY =
  'Workspace tokens can only be created or revoked from a signed-in browser session, not with an API token or connected app.'

workspacesRouter.post('/:slug/tokens', async (httpContext) => {
  const denied = requireInteractiveHuman(httpContext, WORKSPACE_TOKEN_HUMAN_ONLY)
  if (denied) {
    return denied
  }
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await createToken(ctx, await jsonBody(httpContext)), HTTP_CREATED)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.get('/:slug/tokens', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await listTokens(ctx))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.delete('/:slug/tokens/:tokenId', async (httpContext) => {
  const denied = requireInteractiveHuman(httpContext, WORKSPACE_TOKEN_HUMAN_ONLY)
  if (denied) {
    return denied
  }
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await revokeToken(ctx, httpContext.req.param('tokenId')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

/*
 * PROJ-659. Deliberately not mirrored as MCP tools: withdrawing a credential is a
 * sensitive operation, and one a connector should not be able to perform on itself.
 *
 * The shared PUBLIC_READ_ONLY viewer is one identity for every anonymous visitor on the
 * internet and a real `viewer` member of the default workspace, so "your own grants"
 * would mean "everyone's grants" for it. It cannot consent to a grant in the first place
 * (routes/oauth.ts), which makes the list provably empty today — but that is an
 * invariant enforced two files away, and this endpoint should not depend on it.
 */
const connectorsDenied = function connectorsDenied(httpContext: Parameters<typeof ctxFromHono>[0]): Response | null {
  return requireInteractiveHuman(
    httpContext,
    'Connectors are personal credentials and need a signed-in browser session, not an API token or connected app',
  )
}

workspacesRouter.get('/:slug/connectors', async (httpContext) => {
  const denied = connectorsDenied(httpContext)
  if (denied) {
    return denied
  }
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await listConnectorGrants(ctx))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.delete('/:slug/connectors/:grantId', async (httpContext) => {
  const denied = connectorsDenied(httpContext)
  if (denied) {
    return denied
  }
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await revokeConnectorGrant(ctx, httpContext.req.param('grantId')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.delete('/:slug', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(
      await deleteWorkspace(ctx, httpContext.req.param('slug'), httpContext.env.DEFAULT_WORKSPACE_SLUG ?? 'projektor'),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.get('/:slug/brand', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const workspace = httpContext.get('workspace') as { slug: string }
  try {
    return httpContext.json(await getWorkspaceBrand(ctx, workspace.slug))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.patch('/:slug/brand', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const workspace = httpContext.get('workspace') as { slug: string }
  try {
    return httpContext.json(await updateWorkspaceBrand(ctx, workspace.slug, await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.post('/:slug/brand/logo', (httpContext) =>
  coreFileRequest(httpContext, '/workspace-logo', httpContext.req.raw.body, httpContext.req.header('Content-Type')),
)

workspacesRouter.delete('/:slug/brand/logo', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    await deleteWorkspaceLogo(ctx)
    return new Response(undefined, { status: 204 })
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

workspacesRouter.get('/:slug/brand/logo', (httpContext) => coreFileRequest(httpContext, '/workspace-logo'))

workspacesRouter.get('/:slug/mcp-info', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const workspace = httpContext.get('workspace')
  const { origin } = new URL(httpContext.req.url)
  try {
    return httpContext.json(await getWorkspaceMcpInfo(ctx, workspace, origin))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})
