import { Predicate } from 'effect'
import { Hono } from 'hono'
import { makeCoreClient } from 'projektor/core-client'

import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { getWorkflow } from '#api/services/workflow.ts'
import { hasSingleItem } from '#contracts/item-count.ts'
import type { HonoEnv } from '#types'

export const workflowRouter = new Hono<HonoEnv>()

workflowRouter.get('/', async (httpContext) => {
  try {
    /*
     * Normally a single string; a repeated `?ifVersion=` is passed through as an
     * array so the service's Zod schema rejects it as an invalid type (400), the
     * same as MCP's `ifVersion` failing to type-check as a string.
     */
    const ifVersionValues = httpContext.req.queries('ifVersion')
    const ifVersion = Predicate.isNullish(ifVersionValues)
      ? undefined
      : hasSingleItem(ifVersionValues)
        ? ifVersionValues[0]
        : ifVersionValues
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
