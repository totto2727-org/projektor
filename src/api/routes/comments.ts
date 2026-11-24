import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body.ts'
import { serviceErrToResponse } from '../http/error-adapter.ts'
import { addComment, deleteComment, listComments, updateComment } from '../services/comments.ts'
import { resolveIssueIdParam } from '../services/issues.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

/*
 * Reads accept a ref ("PROJ-42") as well as a UUID so the browser doesn't have to
 * resolve one before asking (PROJ-438). Writes stay UUID-only — they're never on a
 * first-paint path, so there's nothing to gain for the extra surface.
 */
router.get('/:issueId/comments', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const issueId = await resolveIssueIdParam(ctx, httpContext.req.param('issueId'))
    return httpContext.json(await listComments(ctx, { issueId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/:issueId/comments', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const issueId = httpContext.req.param('issueId')
  const raw = await jsonBody(httpContext)
  try {
    return httpContext.json(await addComment(ctx, { issueId, ...raw }), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.patch('/:issueId/comments/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const issueId = httpContext.req.param('issueId')
  const commentId = httpContext.req.param('id')
  const raw = await jsonBody(httpContext)
  try {
    return httpContext.json(await updateComment(ctx, { issueId, commentId, ...raw }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.delete('/:issueId/comments/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const issueId = httpContext.req.param('issueId')
  const commentId = httpContext.req.param('id')
  try {
    return httpContext.json(await deleteComment(ctx, { issueId, commentId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as commentsRouter }
