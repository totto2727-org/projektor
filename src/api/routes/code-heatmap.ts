import { String, Predicate } from 'effect'
import { Hono } from 'hono'

import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { getCodeHeatmap } from '#api/services/code-heatmap.ts'
import { ctxFromHono } from '#api/services/types.ts'
import type { HonoEnv } from '#types'

export const codeHeatmapRouter = new Hono<HonoEnv>()

codeHeatmapRouter.get('/:id/code-heatmap', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const since = httpContext.req.query('since')
    const until = httpContext.req.query('until')
    const prefix = httpContext.req.query('prefix')
    const mode = httpContext.req.query('mode')
    return httpContext.json(
      await getCodeHeatmap(ctx, {
        projectId: httpContext.req.param('id'),
        since: Predicate.isNotNullish(since) && String.isNonEmpty(since) ? Number(since) : undefined,
        until: Predicate.isNotNullish(until) && String.isNonEmpty(until) ? Number(until) : undefined,
        prefix,
        mode,
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})
