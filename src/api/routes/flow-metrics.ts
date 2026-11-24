import { String, Predicate } from 'effect'
import { Hono } from 'hono'

import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { getFlowMetrics } from '#api/services/flow-metrics.ts'
import { ctxFromHono } from '#api/services/types.ts'
import type { HonoEnv } from '#types'

export const flowMetricsRouter = new Hono<HonoEnv>()

flowMetricsRouter.get('/:id/flow-metrics', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const since = httpContext.req.query('since')
    const until = httpContext.req.query('until')
    const granularity = httpContext.req.query('granularity')
    return httpContext.json(
      await getFlowMetrics(ctx, {
        projectId: httpContext.req.param('id'),
        since: Predicate.isNotNullish(since) && String.isNonEmpty(since) ? Number(since) : undefined,
        until: Predicate.isNotNullish(until) && String.isNonEmpty(until) ? Number(until) : undefined,
        granularity,
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})
