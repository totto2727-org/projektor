import { Hono } from 'hono'

import { listProjectActivity } from '#commands/project-activity'
import type { HonoEnv } from '#types'

import { serviceErrToResponse } from '../http/error-adapter'
import { ctxFromHono } from '../services/types'

const router = new Hono<HonoEnv>()

router.get('/:id/activity', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    const since = c.req.query('since')
    const limit = c.req.query('limit')
    return c.json(
      await listProjectActivity(ctx, {
        projectId: c.req.param('id'),
        since: since ? Number(since) : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    )
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

export { router as projectActivityRouter }
