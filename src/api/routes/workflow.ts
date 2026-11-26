import { Predicate } from 'effect'
import { Hono } from 'hono'
import { makeCoreClient } from 'projektor/core-client'

import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { getWorkflow } from '#api/services/workflow.ts'
import { hasSingleItem } from '#contracts/item-count.ts'
import type { HonoEnv } from '#types'

const workflowVersionParameter = function workflowVersionParameter(
  values: string[] | undefined,
): string | string[] | undefined {
  if (Predicate.isNullish(values)) {
    return undefined
  }
  return hasSingleItem(values) ? values[0] : values
}

export const workflowRouter = new Hono<HonoEnv>()

workflowRouter.get('/', async (httpContext) => {
  try {
    /*
     * Normally a single string; a repeated `?ifVersion=` is passed through as an
     * array so the service's Zod schema rejects it as an invalid type (400), the
     * same as MCP's `ifVersion` failing to type-check as a string.
     */
    const ifVersion = workflowVersionParameter(httpContext.req.queries('ifVersion'))
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
