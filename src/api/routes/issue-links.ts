import { Hono } from 'hono'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { createLink, deleteLink, listLinksForIssue } from '#api/services/issue-links.ts'
import { resolveIssueIdParam } from '#api/services/issues.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { HTTP_CREATED } from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

export const issueLinksRouter = new Hono<HonoEnv>()

/*
 * GET /api/issues/:issueId/links — accepts a ref ("PROJ-42") as well as a UUID, so the
 * browser can ask for these alongside the issue itself rather than after it (PROJ-438).
 */
issueLinksRouter.get('/:issueId/links', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const issueId = await resolveIssueIdParam(ctx, httpContext.req.param('issueId'))
    return httpContext.json(await listLinksForIssue(ctx, { issueId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

// POST /api/issues/:issueId/links
issueLinksRouter.post('/:issueId/links', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const body = await jsonBody(httpContext)
  try {
    return httpContext.json(
      await createLink(ctx, { sourceIssueId: httpContext.req.param('issueId'), ...body }),
      HTTP_CREATED,
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

// DELETE /api/issues/:issueId/links/:linkId
issueLinksRouter.delete('/:issueId/links/:linkId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await deleteLink(ctx, { id: httpContext.req.param('linkId') }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})
