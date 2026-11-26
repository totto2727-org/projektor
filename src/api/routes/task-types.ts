import { Hono } from 'hono'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { createTaskType, deleteTaskType, listTaskTypes, updateTaskType } from '#api/services/task-types.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { HTTP_CREATED } from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

export const taskTypesRouter = new Hono<HonoEnv>()

taskTypesRouter.get('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await listTaskTypes(ctx))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

taskTypesRouter.post('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await createTaskType(ctx, await jsonBody(httpContext)), HTTP_CREATED)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

taskTypesRouter.patch('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await updateTaskType(ctx, httpContext.req.param('id'), await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

taskTypesRouter.delete('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await deleteTaskType(ctx, httpContext.req.param('id')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})
