import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body.ts'
import { serviceErrToResponse } from '../http/error-adapter.ts'
import { listMessages, postMessage } from '../services/agent-messages.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

router.get('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const { scope, cursor, limit } = httpContext.req.query()
  try {
    return httpContext.json(await listMessages(ctx, { scope, cursor, limit }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await postMessage(ctx, await jsonBody(httpContext)), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as agentMessagesRouter }
