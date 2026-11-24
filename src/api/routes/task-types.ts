import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body.ts'
import { serviceErrToResponse } from '../http/error-adapter.ts'
import { createTaskType, deleteTaskType, listTaskTypes, updateTaskType } from '../services/task-types.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

router.get('/', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await listTaskTypes(ctx))
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.post('/', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await createTaskType(ctx, await jsonBody(c)), 201)
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.patch('/:id', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await updateTaskType(ctx, c.req.param('id'), await jsonBody(c)))
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.delete('/:id', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await deleteTaskType(ctx, c.req.param('id')))
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

export { router as taskTypesRouter }
