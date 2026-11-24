import { Hono } from 'hono'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import {
  createCustomFieldDef,
  deleteCustomFieldDef,
  listCustomFieldDefs,
  updateCustomFieldDef,
} from '#api/services/custom-fields.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { HTTP_CREATED } from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

export const customFieldsRouter = new Hono<HonoEnv>()

customFieldsRouter.get('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.query('projectId')
  try {
    return httpContext.json(await listCustomFieldDefs(ctx, projectId))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

customFieldsRouter.post('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await createCustomFieldDef(ctx, await jsonBody(httpContext)), HTTP_CREATED)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

customFieldsRouter.patch('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await updateCustomFieldDef(ctx, httpContext.req.param('id'), await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

customFieldsRouter.delete('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await deleteCustomFieldDef(ctx, httpContext.req.param('id')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})
