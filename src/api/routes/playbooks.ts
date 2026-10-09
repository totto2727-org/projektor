import { Hono } from 'hono'

import { composePlaybook } from '#commands/playbook-compose'
import { getPlaybook, listPlaybooks } from '#commands/playbooks'
import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body'
import { serviceErrToResponse } from '../http/error-adapter'
import { ctxFromHono } from '../services/types'

const router = new Hono<HonoEnv>()

router.get('/', (c) => c.json(listPlaybooks()))

router.post('/:name/compose', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await composePlaybook(ctx, { name: c.req.param('name'), params: await jsonBody(c) }))
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.get('/:name', (c) => {
  try {
    return c.json(getPlaybook(c.req.param('name')))
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

export { router as playbooksRouter }
