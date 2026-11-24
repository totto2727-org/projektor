import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body.ts'
import { serviceErrToResponse } from '../http/error-adapter.ts'
import { createTaskStatus, deleteTaskStatus, listTaskStatuses, updateTaskStatus } from '../services/task-statuses.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

router.get('/', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await listTaskStatuses(ctx))
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.post('/', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await createTaskStatus(ctx, await jsonBody(c)), 201)
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.patch('/:id', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await updateTaskStatus(ctx, c.req.param('id'), await jsonBody(c)))
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.delete('/:id', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await deleteTaskStatus(ctx, c.req.param('id')))
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

export { router as taskStatusesRouter }
