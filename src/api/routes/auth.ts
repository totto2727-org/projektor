import { Schema } from 'effect'
import { Hono } from 'hono'
import { makeCoreClient } from 'projektor/core-client'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { authMiddleware, requireInteractiveHuman } from '#api/middleware/auth.ts'
import { apiReply } from '#api/services/reply.ts'
import { ApiUserBootstrap } from '#contracts/api-auth.ts'
import { HTTP_CREATED, HTTP_FOUND } from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

export const authRouter = new Hono<HonoEnv>()

const isSafeRedirectPath = function isSafeRedirectPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//')
}

authRouter.get('/login', (httpContext) => {
  const requested = httpContext.req.query('redirect_url') ?? '/'
  return httpContext.redirect(isSafeRedirectPath(requested) ? requested : '/', HTTP_FOUND)
})

authRouter.get('/me', authMiddleware, async (httpContext) => {
  try {
    return httpContext.json(
      await apiReply(
        ApiUserBootstrap,
        makeCoreClient(httpContext.env.CORE).apiUserBootstrap(httpContext.get('coreActor')),
      ),
    )
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})

const HUMAN_SESSION_REQUIRED =
  'Personal access tokens can only be created or revoked from a signed-in browser session, not with an API token or connected app.'

authRouter.post('/tokens', authMiddleware, async (httpContext) => {
  const denied = requireInteractiveHuman(httpContext, HUMAN_SESSION_REQUIRED)
  if (denied) {
    return denied
  }
  try {
    const result = await apiReply(
      Schema.Struct({ token: Schema.String }),
      makeCoreClient(httpContext.env.CORE).apiCreateUserToken(
        httpContext.get('coreActor'),
        await jsonBody(httpContext),
      ),
    )
    return httpContext.json(result, HTTP_CREATED)
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})

authRouter.delete('/tokens/:id', authMiddleware, async (httpContext) => {
  const denied = requireInteractiveHuman(httpContext, HUMAN_SESSION_REQUIRED)
  if (denied) {
    return denied
  }
  try {
    return httpContext.json(
      await apiReply(
        Schema.Struct({ ok: Schema.Boolean }),
        makeCoreClient(httpContext.env.CORE).apiDeleteUserToken(
          httpContext.get('coreActor'),
          httpContext.req.param('id') ?? '',
        ),
      ),
    )
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})
