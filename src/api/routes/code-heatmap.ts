import { Hono } from 'hono'

import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { getCodeHeatmap } from '#api/services/code-heatmap.ts'
import { ctxFromHono } from '#api/services/types.ts'
import type { HonoEnv } from '#types'

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
