import { Hono } from 'hono'
import { makeCoreClient } from 'projektor/core-client'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body'
import { serviceErrToResponse } from '../http/error-adapter'
import { composePlaybook } from '../services/playbook-compose'
import { getPlaybook, listPlaybooks } from '../services/playbooks'
import { ctxFromHono } from '../services/types'

const router = new Hono<HonoEnv>()

router.get('/', async (c) => {
  try {
    return c.json(await listPlaybooks({ core: makeCoreClient(c.env.CORE), actor: c.get('coreActor') }))
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})

router.post('/:name/compose', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await composePlaybook(ctx, { name: c.req.param('name'), params: await jsonBody(c) }))
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.get('/:name', async (c) => {
  try {
    return c.json(
      await getPlaybook({ core: makeCoreClient(c.env.CORE), actor: c.get('coreActor') }, c.req.param('name')),
    )
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

export { router as playbooksRouter }
