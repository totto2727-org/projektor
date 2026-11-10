import { Effect, Schema } from 'effect'
import { Hono } from 'hono'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'

import type { HonoEnv } from '#types'

import { ApiUserBootstrap } from '../../contracts/api-auth'
import { jsonBody } from '../http/body'
import { serviceErrToResponse } from '../http/error-adapter'
import { authMiddleware, requireInteractiveHuman } from '../middleware/auth'

const router = new Hono<HonoEnv>()

function isSafeRedirectPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//')
}

router.get('/login', (c) => {
  const requested = c.req.query('redirect_url') ?? '/'
  return c.redirect(isSafeRedirectPath(requested) ? requested : '/', 302)
})

router.get('/me', authMiddleware, async (c) => {
  try {
    return c.json(
      await Effect.runPromise(
        decodeCoreReply(ApiUserBootstrap, makeCoreClient(c.env.CORE).apiUserBootstrap(c.get('coreActor'))),
      ),
    )
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})

const HUMAN_SESSION_REQUIRED =
  'Personal access tokens can only be created or revoked from a signed-in browser session, not with an API token or connected app.'

router.post('/tokens', authMiddleware, async (c) => {
  const denied = requireInteractiveHuman(c, HUMAN_SESSION_REQUIRED)
  if (denied) return denied
  try {
    const result = await Effect.runPromise(
      decodeCoreReply(
        Schema.Struct({ token: Schema.String }),
        makeCoreClient(c.env.CORE).apiCreateUserToken(c.get('coreActor'), await jsonBody(c)),
      ),
    )
    return c.json(result, 201)
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})

router.delete('/tokens/:id', authMiddleware, async (c) => {
  const denied = requireInteractiveHuman(c, HUMAN_SESSION_REQUIRED)
  if (denied) return denied
  try {
    return c.json(
      await Effect.runPromise(
        decodeCoreReply(
          Schema.Struct({ ok: Schema.Boolean }),
          makeCoreClient(c.env.CORE).apiDeleteUserToken(c.get('coreActor'), c.req.param('id') ?? ''),
        ),
      ),
    )
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})

export { router as authRouter }
