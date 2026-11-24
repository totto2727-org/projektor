import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { serviceErrToResponse } from '../http/error-adapter.ts'
import { listProjectActivity } from '../services/project-activity.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

router.get('/:id/activity', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const since = httpContext.req.query('since')
    const limit = httpContext.req.query('limit')
    return httpContext.json(
      await listProjectActivity(ctx, {
        projectId: httpContext.req.param('id'),
        since: since ? Number(since) : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as projectActivityRouter }
