import { Hono } from 'hono'

import { getCodeHeatmap } from '#commands/code-heatmap'
import type { HonoEnv } from '#types'

import { serviceErrToResponse } from '../http/error-adapter'
import { ctxFromHono } from '../services/types'

const router = new Hono<HonoEnv>()

router.get('/:id/code-heatmap', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    const since = c.req.query('since')
    const until = c.req.query('until')
    const prefix = c.req.query('prefix')
    const mode = c.req.query('mode')
    return c.json(
      await getCodeHeatmap(ctx, {
        projectId: c.req.param('id'),
        since: since ? Number(since) : undefined,
        until: until ? Number(until) : undefined,
        prefix,
        mode,
      }),
    )
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

export { router as codeHeatmapRouter }
