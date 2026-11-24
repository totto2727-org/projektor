import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body.ts'
import { serviceErrToResponse } from '../http/error-adapter.ts'
import { listMessages, postMessage } from '../services/agent-messages.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

router.get('/', async (c) => {
  const ctx = ctxFromHono(c)
  const { scope, cursor, limit } = c.req.query()
  try {
    return c.json(await listMessages(ctx, { scope, cursor, limit }))
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.post('/', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await postMessage(ctx, await jsonBody(c)), 201)
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

export { router as agentMessagesRouter }
