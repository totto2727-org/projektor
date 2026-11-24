import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body.ts'
import { serviceErrToResponse } from '../http/error-adapter.ts'
import { createProject, deleteProject, getProject, getProjectBySlug, updateProject } from '../services/projects.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

router.post('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const body = await jsonBody(httpContext)
    return httpContext.json(await createProject(ctx, body), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const param = httpContext.req.param('id')
  try {
    /*
     * PROJ-376: pretty project URLs pass a slug (e.g. "start-line") here instead
     * of a UUID.
     */
    return httpContext.json(UUID_RE.test(param) ? await getProject(ctx, param) : await getProjectBySlug(ctx, param))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.patch('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const body = await jsonBody(httpContext)
    return httpContext.json(await updateProject(ctx, httpContext.req.param('id'), body))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.delete('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await deleteProject(ctx, httpContext.req.param('id')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as projectsRouter }
