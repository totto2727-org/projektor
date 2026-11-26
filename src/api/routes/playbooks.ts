import { Hono } from 'hono'
import { makeCoreClient } from 'projektor/core-client'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { composePlaybook } from '#api/services/playbook-compose.ts'
import { getPlaybook, listPlaybooks } from '#api/services/playbooks.ts'
import { ctxFromHono } from '#api/services/types.ts'
import type { HonoEnv } from '#types'

export const playbooksRouter = new Hono<HonoEnv>()

playbooksRouter.get('/', async (httpContext) => {
  try {
    return httpContext.json(
      await listPlaybooks({ core: makeCoreClient(httpContext.env.CORE), actor: httpContext.get('coreActor') }),
    )
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})

playbooksRouter.post('/:name/compose', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(
      await composePlaybook(ctx, { name: httpContext.req.param('name'), params: await jsonBody(httpContext) }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

playbooksRouter.get('/:name', async (httpContext) => {
  try {
    return httpContext.json(
      await getPlaybook(
        { core: makeCoreClient(httpContext.env.CORE), actor: httpContext.get('coreActor') },
        httpContext.req.param('name'),
      ),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})
