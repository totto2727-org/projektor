import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { serviceErrToResponse } from '../http/error-adapter.ts'
import { getFlowMetrics } from '../services/flow-metrics.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

router.get('/:id/flow-metrics', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const since = httpContext.req.query('since')
    const until = httpContext.req.query('until')
    const granularity = httpContext.req.query('granularity')
    return httpContext.json(
      await getFlowMetrics(ctx, {
        projectId: httpContext.req.param('id'),
        since: since ? Number(since) : undefined,
        until: until ? Number(until) : undefined,
        granularity,
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as flowMetricsRouter }
