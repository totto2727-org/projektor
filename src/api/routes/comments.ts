import { Hono } from 'hono'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { addComment, deleteComment, listComments, updateComment } from '#api/services/comments.ts'
import { resolveIssueIdParam } from '#api/services/issues.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { HTTP_CREATED } from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

export const commentsRouter = new Hono<HonoEnv>()

/*
 * Reads accept a ref ("PROJ-42") as well as a UUID so the browser doesn't have to
 * resolve one before asking (PROJ-438). Writes stay UUID-only — they're never on a
 * first-paint path, so there's nothing to gain for the extra surface.
 */
commentsRouter.get('/:issueId/comments', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const issueId = await resolveIssueIdParam(ctx, httpContext.req.param('issueId'))
    return httpContext.json(await listComments(ctx, { issueId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

commentsRouter.post('/:issueId/comments', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const issueId = httpContext.req.param('issueId')
  const raw = await jsonBody(httpContext)
  try {
    return httpContext.json(await addComment(ctx, { issueId, ...raw }), HTTP_CREATED)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

commentsRouter.patch('/:issueId/comments/:id', async (httpContext) => {
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

commentsRouter.delete('/:issueId/comments/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const issueId = httpContext.req.param('issueId')
  const commentId = httpContext.req.param('id')
  try {
    return httpContext.json(await deleteComment(ctx, { issueId, commentId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})
