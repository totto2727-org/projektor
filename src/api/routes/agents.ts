import { Hono } from 'hono'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import {
  endAgent,
  finishWork,
  heartbeatAgent,
  listActiveAgents,
  registerAgent,
  startWork,
} from '#api/services/agents.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { HTTP_CREATED } from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

export const agentsRouter = new Hono<HonoEnv>()

// PROJ-929: REST parity for the start_work/finish_work MCP tools.
agentsRouter.post('/start-work', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await startWork(ctx, await jsonBody(httpContext)), HTTP_CREATED)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

agentsRouter.post('/finish-work', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await finishWork(ctx, await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

agentsRouter.get('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const { issueId, projectId, includeStale } = httpContext.req.query()
  try {
    return httpContext.json(await listActiveAgents(ctx, { issueId, projectId, includeStale }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

agentsRouter.post('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await registerAgent(ctx, await jsonBody(httpContext)), HTTP_CREATED)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

agentsRouter.post('/:id/heartbeat', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await heartbeatAgent(ctx, { id: httpContext.req.param('id') }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

agentsRouter.post('/:id/end', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await endAgent(ctx, { id: httpContext.req.param('id') }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})
