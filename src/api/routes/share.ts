import { Hono } from 'hono'
import { makeCoreClient } from 'projektor/core-client'

import type { HonoEnv } from '#types'

import { ApiSharedIssue } from '../../contracts/api-public'
import { serviceErrToResponse } from '../http/error-adapter'
import { apiReply } from '../services/reply'
import { createShareToken, revokeShareToken } from '../services/share'
import { ctxFromHono } from '../services/types'

// Authenticated router — POST/DELETE /api/issues/:id/share
const authedRouter = new Hono<HonoEnv>()

authedRouter.post('/:id/share', async (c) => {
  const ctx = ctxFromHono(c)
  const issueId = c.req.param('id')
  try {
    const result = await createShareToken(ctx, issueId)
    return c.json(result, 201)
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

authedRouter.delete('/:id/share', async (c) => {
  const ctx = ctxFromHono(c)
  const issueId = c.req.param('id')
  try {
    await revokeShareToken(ctx, issueId)
    return c.json({ ok: true })
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

export { authedRouter as shareIssuesRouter }

// Unauthenticated router — GET /api/share/:token
const publicRouter = new Hono<HonoEnv>()

publicRouter.get('/:token', async (c) => {
  const token = c.req.param('token')
  try {
    const issue = await apiReply(ApiSharedIssue, makeCoreClient(c.env.CORE).apiGetSharedIssue(token))
    return c.json(issue)
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

publicRouter.get('/:token/logo', async (c) => {
  const token = c.req.param('token')
  return c.env.CORE.fetch(new Request(`https://core.internal/share-logo/${encodeURIComponent(token)}`))
})

export { publicRouter as sharePublicRouter }
