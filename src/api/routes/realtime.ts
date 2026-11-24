import type { Context } from 'hono'
import { Hono } from 'hono'

import { authMiddleware } from '#api/middleware/auth.ts'
import { workspaceMiddleware } from '#api/middleware/workspace.ts'
import { HTTP_NOT_IMPLEMENTED, HTTP_UPGRADE_REQUIRED } from '#contracts/http-status.ts'
import { CORE_ACTOR_HEADER } from '#core/contract.ts'
import type { HonoEnv } from '#types'

const INTERNAL_USER_ID_HEADER = 'X-Internal-User-Id'
const INTERNAL_WORKSPACE_ID_HEADER = 'X-Internal-Workspace-Id'
const INTERNAL_ROLE_HEADER = 'X-Internal-Role'

/**
 * Build the request forwarded to the Durable Object stub.
 *
 * The private hub receives the original authentication proof. Core reauthorizes it
 * on upgrade and every message or broadcast. Legacy identity hints and any
 * client-supplied proof header are stripped before the adapter sets its own proof.
 */
const buildHubRequest = function buildHubRequest(httpContext: Context<HonoEnv>): Request {
  const headers = new Headers(httpContext.req.raw.headers)
  headers.delete(INTERNAL_USER_ID_HEADER)
  headers.delete(INTERNAL_WORKSPACE_ID_HEADER)
  headers.delete(INTERNAL_ROLE_HEADER)
  headers.delete(CORE_ACTOR_HEADER)

  const workspace = httpContext.get('workspace')

  headers.set(CORE_ACTOR_HEADER, JSON.stringify(httpContext.get('coreActor')))
  headers.set(INTERNAL_WORKSPACE_ID_HEADER, workspace.id)

  return new Request(httpContext.req.raw.url, {
    method: httpContext.req.raw.method,
    headers,
  })
}

export const realtimeRouter = new Hono<HonoEnv>()

// GET /api/workspaces/:slug/realtime
// Opens an opt-in WebSocket connection to the workspace's Durable Object hub.
realtimeRouter.get('/workspaces/:slug/realtime', authMiddleware, workspaceMiddleware, async (httpContext) => {
  if (!httpContext.env.WORKSPACE_HUB) {
    return httpContext.json(
      {
        error:
          'Realtime WebSockets are not enabled on this instance. Configure WORKSPACE_HUB in wrangler.toml to enable.',
      },
      HTTP_NOT_IMPLEMENTED,
    )
  }

  const upgradeHeader = httpContext.req.header('Upgrade')
  if (upgradeHeader !== 'websocket') {
    return httpContext.text('Expected Upgrade: websocket', HTTP_UPGRADE_REQUIRED)
  }

  const workspace = httpContext.get('workspace')
  const id = httpContext.env.WORKSPACE_HUB.idFromName(workspace.id)
  const stub = httpContext.env.WORKSPACE_HUB.get(id)

  return stub.fetch(buildHubRequest(httpContext))
})

// GET /api/realtime (workspace resolved via header or fallback query param)
realtimeRouter.get('/realtime', authMiddleware, workspaceMiddleware, async (httpContext) => {
  if (!httpContext.env.WORKSPACE_HUB) {
    return httpContext.json(
      {
        error:
          'Realtime WebSockets are not enabled on this instance. Configure WORKSPACE_HUB in wrangler.toml to enable.',
      },
      HTTP_NOT_IMPLEMENTED,
    )
  }

  const upgradeHeader = httpContext.req.header('Upgrade')
  if (upgradeHeader !== 'websocket') {
    return httpContext.text('Expected Upgrade: websocket', HTTP_UPGRADE_REQUIRED)
  }

  const workspace = httpContext.get('workspace')
  const id = httpContext.env.WORKSPACE_HUB.idFromName(workspace.id)
  const stub = httpContext.env.WORKSPACE_HUB.get(id)

  return stub.fetch(buildHubRequest(httpContext))
})
