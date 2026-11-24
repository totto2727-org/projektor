import { Effect, Schema } from 'effect'
import { Hono } from 'hono'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { authMiddleware, requireInteractiveHuman } from '#api/middleware/auth.ts'
import { ApiUserBootstrap } from '#contracts/api-auth.ts'
import type { HonoEnv } from '#types'

const router = new Hono<HonoEnv>()

const isSafeRedirectPath = function isSafeRedirectPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//')
}

router.get('/login', (httpContext) => {
  const requested = httpContext.req.query('redirect_url') ?? '/'
  return httpContext.redirect(isSafeRedirectPath(requested) ? requested : '/', 302)
})

router.get('/me', authMiddleware, async (httpContext) => {
  try {
    return httpContext.json(
      await Effect.runPromise(
        decodeCoreReply(
          ApiUserBootstrap,
          makeCoreClient(httpContext.env.CORE).apiUserBootstrap(httpContext.get('coreActor')),
        ),
      ),
    )
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})

const HUMAN_SESSION_REQUIRED =
  'Personal access tokens can only be created or revoked from a signed-in browser session, not with an API token or connected app.'

router.post('/tokens', authMiddleware, async (httpContext) => {
  const denied = requireInteractiveHuman(httpContext, HUMAN_SESSION_REQUIRED)
  if (denied) {
    return denied
  }
  try {
    const result = await Effect.runPromise(
      decodeCoreReply(
        Schema.Struct({ token: Schema.String }),
        makeCoreClient(httpContext.env.CORE).apiCreateUserToken(
          httpContext.get('coreActor'),
          await jsonBody(httpContext),
        ),
      ),
    )
    return httpContext.json(result, 201)
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})

router.delete('/tokens/:id', authMiddleware, async (httpContext) => {
  const denied = requireInteractiveHuman(httpContext, HUMAN_SESSION_REQUIRED)
  if (denied) {
    return denied
  }
  try {
    return httpContext.json(
      await Effect.runPromise(
        decodeCoreReply(
          Schema.Struct({ ok: Schema.Boolean }),
          makeCoreClient(httpContext.env.CORE).apiDeleteUserToken(
            httpContext.get('coreActor'),
            httpContext.req.param('id') ?? '',
          ),
        ),
      ),
    )
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})

export { router as authRouter }
