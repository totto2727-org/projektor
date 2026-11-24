import { Hono } from 'hono'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { claimFiles, listFileClaims, releaseFiles } from '#api/services/file-claims.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { HTTP_CREATED } from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

export const fileClaimsRouter = new Hono<HonoEnv>()

fileClaimsRouter.get('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const { issueId, path, projectId, includeStale } = httpContext.req.query()
  try {
    return httpContext.json(await listFileClaims(ctx, { issueId, path, projectId, includeStale }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

fileClaimsRouter.post('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await claimFiles(ctx, await jsonBody(httpContext)), HTTP_CREATED)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

fileClaimsRouter.post('/release', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await releaseFiles(ctx, await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})
