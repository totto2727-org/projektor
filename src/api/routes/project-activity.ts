import { String, Predicate } from 'effect'
import { Hono } from 'hono'

import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { listProjectActivity } from '#api/services/project-activity.ts'
import { ctxFromHono } from '#api/services/types.ts'
import type { HonoEnv } from '#types'

const router = new Hono<HonoEnv>()

router.get('/:id/activity', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const since = httpContext.req.query('since')
    const limit = httpContext.req.query('limit')
    return httpContext.json(
      await listProjectActivity(ctx, {
        projectId: httpContext.req.param('id'),
        since: Predicate.isNotNullish(since) && String.isNonEmpty(since) ? Number(since) : undefined,
        limit: Predicate.isNotNullish(limit) && String.isNonEmpty(limit) ? Number(limit) : undefined,
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as projectActivityRouter }
