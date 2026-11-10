import { Hono } from 'hono'

import { getFlowMetrics } from '#commands/flow-metrics'
import type { HonoEnv } from '#types'

import { serviceErrToResponse } from '../http/error-adapter'
import { ctxFromHono } from '../services/types'

const router = new Hono<HonoEnv>()

router.get('/:id/flow-metrics', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    const since = c.req.query('since')
    const until = c.req.query('until')
    const granularity = c.req.query('granularity')
    return c.json(
      await getFlowMetrics(ctx, {
        projectId: c.req.param('id'),
        since: since ? Number(since) : undefined,
        until: until ? Number(until) : undefined,
        granularity,
      }),
    )
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

export { router as flowMetricsRouter }
