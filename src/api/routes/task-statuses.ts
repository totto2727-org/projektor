import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body.ts'
import { serviceErrToResponse } from '../http/error-adapter.ts'
import { createTaskStatus, deleteTaskStatus, listTaskStatuses, updateTaskStatus } from '../services/task-statuses.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

router.get('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await listTaskStatuses(ctx))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await createTaskStatus(ctx, await jsonBody(httpContext)), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.patch('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await updateTaskStatus(ctx, httpContext.req.param('id'), await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.delete('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await deleteTaskStatus(ctx, httpContext.req.param('id')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as taskStatusesRouter }
