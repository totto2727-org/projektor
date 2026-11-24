import { Hono } from 'hono'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import {
  completeSprint,
  createSprint,
  deleteSprint,
  getSprint,
  listSprints,
  moveIssuesToSprint,
  updateSprint,
} from '#api/services/sprints.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { HTTP_CREATED } from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

export const sprintsRouter = new Hono<HonoEnv>()

sprintsRouter.get('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const { projectId } = httpContext.req.query()
  try {
    return httpContext.json(await listSprints(ctx, { projectId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

sprintsRouter.post('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await createSprint(ctx, await jsonBody(httpContext)), HTTP_CREATED)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

sprintsRouter.get('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await getSprint(ctx, httpContext.req.param('id')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

sprintsRouter.patch('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await updateSprint(ctx, httpContext.req.param('id'), await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

sprintsRouter.post('/:id/complete', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await completeSprint(ctx, httpContext.req.param('id')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

sprintsRouter.delete('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await deleteSprint(ctx, httpContext.req.param('id')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

sprintsRouter.post('/:id/move-issues', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const body = (await jsonBody(httpContext)) as Record<string, unknown>
  try {
    return httpContext.json(await moveIssuesToSprint(ctx, { ...body, sprintId: httpContext.req.param('id') }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})
