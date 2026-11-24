import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body.ts'
import { serviceErrToResponse } from '../http/error-adapter.ts'
import { createLink, deleteLink, listLinksForIssue } from '../services/issue-links.ts'
import { resolveIssueIdParam } from '../services/issues.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

/*
 * GET /api/issues/:issueId/links — accepts a ref ("PROJ-42") as well as a UUID, so the
 * browser can ask for these alongside the issue itself rather than after it (PROJ-438).
 */
router.get('/:issueId/links', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const issueId = await resolveIssueIdParam(ctx, httpContext.req.param('issueId'))
    return httpContext.json(await listLinksForIssue(ctx, { issueId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

// POST /api/issues/:issueId/links
router.post('/:issueId/links', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const body = await jsonBody(httpContext)
  try {
    return httpContext.json(await createLink(ctx, { sourceIssueId: httpContext.req.param('issueId'), ...body }), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

// DELETE /api/issues/:issueId/links/:linkId
router.delete('/:issueId/links/:linkId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await deleteLink(ctx, { id: httpContext.req.param('linkId') }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as issueLinksRouter }
