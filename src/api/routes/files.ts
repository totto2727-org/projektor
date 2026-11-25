import { Hono } from 'hono'
import { flattenError } from 'zod'

import { jsonBody } from '#api/http/body.ts'
import { coreFileRequest } from '#api/http/core-files.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import * as filesService from '#api/services/files.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { ValidationError } from '#contracts/errors.ts'
import { HTTP_CREATED } from '#contracts/http-status.ts'
import { SetAttachmentReviewStatusSchema } from '#contracts/inputs/files.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import type { HonoEnv } from '#types'

export const filesRouter = new Hono<HonoEnv>()
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const ReviewStatusBodySchema = SetAttachmentReviewStatusSchema.omit({ attachmentId: true })
filesRouter.get('/', async (httpContext) => {
  try {
    return httpContext.json(
      await filesService.listAttachments(ctxFromHono(httpContext), {
        entityType: httpContext.req.query('entityType'),
        entityId: httpContext.req.query('entityId'),
      }),
    )
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})
filesRouter.post('/links', async (httpContext) => {
  try {
    return httpContext.json(
      await filesService.createLinkAttachment(ctxFromHono(httpContext), await jsonBody(httpContext).catch(() => null)),
      HTTP_CREATED,
    )
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})
filesRouter.post('/', async (httpContext) => {
  const response = await coreFileRequest(
    httpContext,
    '/files',
    httpContext.req.raw.body,
    httpContext.req.header('Content-Type'),
  )
  return new Response(
    response.body,
    fieldsInOrder([
      ['status', response.ok ? HTTP_CREATED : response.status],
      ['headers', response.headers],
    ]),
  )
})
filesRouter.patch('/:id/review-status', async (httpContext) => {
  try {
    const parsed = ReviewStatusBodySchema.safeParse(await jsonBody(httpContext))
    if (!parsed.success) {
      throw new ValidationError(flattenError(parsed.error))
    }
    return httpContext.json(
      await filesService.setAttachmentReviewStatus(ctxFromHono(httpContext), {
        ...parsed.data,
        attachmentId: httpContext.req.param('id'),
      }),
    )
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})
filesRouter.get('/:id/metadata', async (httpContext) => {
  try {
    return httpContext.json(
      await filesService.getAttachment(ctxFromHono(httpContext), { id: httpContext.req.param('id') }),
    )
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})
filesRouter.get('/:id', async (httpContext) => {
  const response = await coreFileRequest(httpContext, `/files/${encodeURIComponent(httpContext.req.param('id'))}`)
  if (!response.ok) {
    return response
  }
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  let filename = 'attachment'
  try {
    filename = decodeURIComponent(response.headers.get('x-projektor-filename') ?? filename)
  } catch {
    /* Safe fallback */
  }
  const inline = INLINE_TYPES.has(contentType)
  return new Response(response.body, {
    headers: {
      'Content-Type': inline ? contentType : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename.replaceAll(/[\r\n"\\]/gu, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    },
  })
})
filesRouter.delete('/:id', async (httpContext) => {
  try {
    await filesService.deleteAttachment(ctxFromHono(httpContext), { id: httpContext.req.param('id') })
    return new Response(undefined, { status: 204 })
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})
