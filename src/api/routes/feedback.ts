import type { Context } from 'hono'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { makeCoreClient } from 'projektor/core-client'
import { CorePublicError } from 'projektor/core-client'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { bumpRateCounter } from '#api/middleware/rate-limit.ts'
import {
  bulkConvertToIssue,
  bulkMarkReviewed,
  convertFeedbackToIssue,
  getFeedbackSummary,
  listFeedback,
  updateFeedbackStatus,
} from '#api/services/feedback.ts'
import { apiReply } from '#api/services/reply.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { ApiSubmittedFeedback } from '#contracts/api-public.ts'
import type { HonoEnv } from '#types'

const publicRouter = new Hono<HonoEnv>()

/*
 * PROJ-378: this router is mounted ahead of the global app.use("*", logger())
 * in worker.ts (see Step 6 below), so it needs its own logging or submit
 * requests go unlogged entirely.
 */
publicRouter.use('*', logger())

/*
 * Anonymous end-user feedback preflight. We cannot know the source (no token on a
 * preflight), so reflect the requesting Origin; the POST response is what actually
 * enforces the per-source allow-list.
 */
publicRouter.options('/submit', (httpContext) => {
  const origin = httpContext.req.header('Origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return httpContext.body(null, 204, headers)
})

const checkFeedbackRateLimit = async function checkFeedbackRateLimit(
  httpContext: Context<HonoEnv>,
  token: string,
): Promise<Response | null> {
  /*
   * Dual-keyed rate limit (token hash + IP) — reject if either trips its bucket.
   * Dedicated PROJ-378 env vars, not RATE_LIMIT_API_MAX/RATE_LIMIT_AUTH_MAX: this
   * route runs outside the global rateLimitMiddleware chain (mounted before it),
   * and anonymous feedback traffic must not share a budget with authenticated callers.
   */
  const windowSecs = parseInt(httpContext.env.RATE_LIMIT_WINDOW_SECS ?? '60', 10)
  const tokenLimit = parseInt(httpContext.env.RATE_LIMIT_FEEDBACK_MAX ?? '30', 10)
  const ipLimit = parseInt(httpContext.env.RATE_LIMIT_FEEDBACK_IP_MAX ?? '100', 10)
  const ip = httpContext.req.header('CF-Connecting-IP') ?? '127.0.0.1'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  // PROJ-867: both counters in parallel; a limiter outage fails open rather than 500ing.
  let tokenCount: number
  let ipCount: number
  try {
    ;[tokenCount, ipCount] = await Promise.all([
      bumpRateCounter(httpContext.env, `feedback:${tokenHash}`, windowSecs),
      bumpRateCounter(httpContext.env, `feedback-ip:${ip}`, windowSecs),
    ])
  } catch (error) {
    console.error('feedback rate-limit counter unavailable, failing open', { err: String(error) })
    return null
  }
  if (tokenCount > tokenLimit || ipCount > ipLimit) {
    return httpContext.json({ error: 'Too Many Requests' }, 429)
  }
  return null
}

const parseFeedbackBody = async function parseFeedbackBody(c: Context<HonoEnv>): Promise<unknown> {
  try {
    return await jsonBody(c)
  } catch {
    return {}
  }
}

const submitFeedbackErrorResponse = function submitFeedbackErrorResponse(
  httpContext: Context<HonoEnv>,
  e: unknown,
): Response {
  /*
   * Endpoint-specific mapping: an unknown/revoked source is an invalid
   * credential (401), an inactive source is a paused resource (403), a bad
   * body is 400. (NotFound → 401 here, unlike every other endpoint.)
   */
  if (e instanceof CorePublicError) {
    if (e.kind === 'validation') {
      return httpContext.json({ error: e.details }, 400)
    }
    if (e.status === 403 || e.status === 404) {
      return httpContext.json({ error: e.message }, e.status === 404 ? 401 : 403)
    }
    return serviceErrToResponse(httpContext, e)
  }
  throw e
}

publicRouter.post('/submit', async (httpContext) => {
  const auth = httpContext.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return httpContext.json({ error: 'Unauthorized' }, 401)
  }
  const token = auth.slice(7)
  const origin = httpContext.req.header('Origin') ?? null

  const rateLimited = await checkFeedbackRateLimit(httpContext, token)
  if (rateLimited) {
    return rateLimited
  }

  const rawBody = await parseFeedbackBody(httpContext)

  try {
    const { id, corsAllowOrigin } = await apiReply(
      ApiSubmittedFeedback,
      makeCoreClient(httpContext.env.CORE).apiSubmitFeedback(token, rawBody, origin),
    )
    if (corsAllowOrigin) {
      httpContext.header('Access-Control-Allow-Origin', corsAllowOrigin)
    }
    return httpContext.json({ id }, 201)
  } catch (caughtError) {
    return submitFeedbackErrorResponse(httpContext, caughtError)
  }
})

export { publicRouter as feedbackPublicRouter }

const authedRouter = new Hono<HonoEnv>()

authedRouter.get('/:id/feedback', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.param('id')
  const status = httpContext.req.query('status')
  const sourceId = httpContext.req.query('sourceId')
  try {
    return httpContext.json(await listFeedback(ctx, { projectId, status, sourceId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

authedRouter.get('/:id/feedback/summary', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.param('id')
  try {
    return httpContext.json(await getFeedbackSummary(ctx, { projectId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

authedRouter.patch('/:id/feedback/:feedbackId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.param('id')
  const feedbackId = httpContext.req.param('feedbackId')
  const raw = await jsonBody(httpContext)
  try {
    return httpContext.json(await updateFeedbackStatus(ctx, { ...raw, projectId, feedbackId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

authedRouter.post('/:id/feedback/bulk-mark-reviewed', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.param('id')
  const raw = await jsonBody(httpContext)
  try {
    return httpContext.json(await bulkMarkReviewed(ctx, { ...raw, projectId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

authedRouter.post('/:id/feedback/bulk-convert-to-issue', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.param('id')
  const raw = await jsonBody(httpContext)
  try {
    return httpContext.json(await bulkConvertToIssue(ctx, { ...raw, projectId }), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

authedRouter.post('/:id/feedback/:feedbackId/convert-to-issue', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const projectId = httpContext.req.param('id')
  const feedbackId = httpContext.req.param('feedbackId')
  try {
    return httpContext.json(await convertFeedbackToIssue(ctx, { projectId, feedbackId }), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { authedRouter as feedbackRouter }
