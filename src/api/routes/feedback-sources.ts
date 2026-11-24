import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body.ts'
import { serviceErrToResponse } from '../http/error-adapter.ts'
import {
  createFeedbackSource,
  getFeedbackSource,
  listFeedbackSources,
  revokeFeedbackSource,
  rotateFeedbackSourceToken,
  updateFeedbackSource,
} from '../services/feedback-sources.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

router.post('/:id/feedback-sources', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.param('id')
  const raw = await jsonBody(httpContext)
  try {
    return httpContext.json(await createFeedbackSource(ctx, { ...raw, projectId }), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/:id/feedback-sources', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.param('id')
  try {
    return httpContext.json(await listFeedbackSources(ctx, { projectId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.patch('/:id/feedback-sources/:sourceId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.param('id')
  const sourceId = httpContext.req.param('sourceId')
  const raw = await jsonBody(httpContext)
  try {
    return httpContext.json(await updateFeedbackSource(ctx, { ...raw, projectId, sourceId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/:id/feedback-sources/:sourceId/rotate', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.param('id')
  const sourceId = httpContext.req.param('sourceId')
  try {
    return httpContext.json(await rotateFeedbackSourceToken(ctx, { projectId, sourceId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.delete('/:id/feedback-sources/:sourceId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.param('id')
  const sourceId = httpContext.req.param('sourceId')
  try {
    return httpContext.json(await revokeFeedbackSource(ctx, { projectId, sourceId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

const lookupRouter = new Hono<HonoEnv>()

lookupRouter.get('/:sourceId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const sourceId = httpContext.req.param('sourceId')
  try {
    return httpContext.json(await getFeedbackSource(ctx, { sourceId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { lookupRouter as feedbackSourceLookupRouter, router as feedbackSourcesRouter }
