import { Hono } from 'hono'
import { makeCoreClient } from 'projektor/core-client'

import type { HonoEnv } from '#types'

import { serviceErrToResponse } from '../http/error-adapter.ts'
import { getWorkflow } from '../services/workflow.ts'

const router = new Hono<HonoEnv>()

router.get('/', async (httpContext) => {
  try {
    /*
     * Normally a single string; a repeated `?ifVersion=` is passed through as an
     * array so the service's Zod schema rejects it as an invalid type (400), the
     * same as MCP's `ifVersion` failing to type-check as a string.
     */
    const ifVersionValues = httpContext.req.queries('ifVersion')
    const ifVersion =
      ifVersionValues === undefined ? undefined : ifVersionValues.length === 1 ? ifVersionValues[0] : ifVersionValues
    return httpContext.json(
      await getWorkflow(
        { core: makeCoreClient(httpContext.env.CORE), actor: httpContext.get('coreActor') },
        { ifVersion },
      ),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as workflowRouter }
