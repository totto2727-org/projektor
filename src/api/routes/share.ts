import { Hono } from 'hono'
import { makeCoreClient } from 'projektor/core-client'

import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { apiReply } from '#api/services/reply.ts'
import { createShareToken, revokeShareToken } from '#api/services/share.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { ApiSharedIssue } from '#contracts/api-public.ts'
import type { HonoEnv } from '#types'

// Authenticated router — POST/DELETE /api/issues/:id/share
const authedRouter = new Hono<HonoEnv>()

authedRouter.post('/:id/share', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const issueId = httpContext.req.param('id')
  try {
    const result = await createShareToken(ctx, issueId)
    return httpContext.json(result, 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

authedRouter.delete('/:id/share', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const issueId = httpContext.req.param('id')
  try {
    await revokeShareToken(ctx, issueId)
    return httpContext.json({ ok: true })
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { authedRouter as shareIssuesRouter }

// Unauthenticated router — GET /api/share/:token
const publicRouter = new Hono<HonoEnv>()

publicRouter.get('/:token', async (httpContext) => {
  const token = httpContext.req.param('token')
  try {
    const issue = await apiReply(ApiSharedIssue, makeCoreClient(httpContext.env.CORE).apiGetSharedIssue(token))
    return httpContext.json(issue)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

publicRouter.get('/:token/logo', async (httpContext) => {
  const token = httpContext.req.param('token')
  return httpContext.env.CORE.fetch(new Request(`https://core.internal/share-logo/${encodeURIComponent(token)}`))
})

export { publicRouter as sharePublicRouter }
