import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { serviceErrToResponse } from '../http/error-adapter.ts'
import { getCodeHeatmap } from '../services/code-heatmap.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

router.get('/:id/code-heatmap', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const since = httpContext.req.query('since')
    const until = httpContext.req.query('until')
    const prefix = httpContext.req.query('prefix')
    const mode = httpContext.req.query('mode')
    return httpContext.json(
      await getCodeHeatmap(ctx, {
        projectId: httpContext.req.param('id'),
        since: since ? Number(since) : undefined,
        until: until ? Number(until) : undefined,
        prefix,
        mode,
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as codeHeatmapRouter }
