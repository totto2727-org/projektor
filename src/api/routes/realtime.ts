import type { Context } from 'hono'
import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { CORE_ACTOR_HEADER } from '../../core/contract'
import { authMiddleware } from '../middleware/auth'
import { workspaceMiddleware } from '../middleware/workspace'

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
function buildHubRequest(c: Context<HonoEnv>): Request {
  const headers = new Headers(c.req.raw.headers)
  headers.delete(INTERNAL_USER_ID_HEADER)
  headers.delete(INTERNAL_WORKSPACE_ID_HEADER)
  headers.delete(INTERNAL_ROLE_HEADER)
  headers.delete(CORE_ACTOR_HEADER)

  const workspace = c.get('workspace')

  headers.set(CORE_ACTOR_HEADER, JSON.stringify(c.get('coreActor')))
  headers.set(INTERNAL_WORKSPACE_ID_HEADER, workspace.id)

  return new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers,
  })
}

const router = new Hono<HonoEnv>()

// GET /api/workspaces/:slug/realtime
// Opens an opt-in WebSocket connection to the workspace's Durable Object hub.
router.get('/workspaces/:slug/realtime', authMiddleware, workspaceMiddleware, async (c) => {
  if (!c.env.WORKSPACE_HUB) {
    return c.json(
      {
        error:
          'Realtime WebSockets are not enabled on this instance. Configure WORKSPACE_HUB in wrangler.toml to enable.',
      },
      501,
    )
  }

  const upgradeHeader = c.req.header('Upgrade')
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426)
  }

  const workspace = c.get('workspace')
  const id = c.env.WORKSPACE_HUB.idFromName(workspace.id)
  const stub = c.env.WORKSPACE_HUB.get(id)

  return stub.fetch(buildHubRequest(c))
})

// GET /api/realtime (workspace resolved via header or fallback query param)
router.get('/realtime', authMiddleware, workspaceMiddleware, async (c) => {
  if (!c.env.WORKSPACE_HUB) {
    return c.json(
      {
        error:
          'Realtime WebSockets are not enabled on this instance. Configure WORKSPACE_HUB in wrangler.toml to enable.',
      },
      501,
    )
  }

  const upgradeHeader = c.req.header('Upgrade')
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426)
  }

  const workspace = c.get('workspace')
  const id = c.env.WORKSPACE_HUB.idFromName(workspace.id)
  const stub = c.env.WORKSPACE_HUB.get(id)

  return stub.fetch(buildHubRequest(c))
})

export { router as realtimeRouter }
