import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { ValidationError } from '../../contracts/errors'
import { SetAttachmentReviewStatusSchema } from '../../contracts/inputs/files'
import { jsonBody } from '../http/body'
import { coreFileRequest } from '../http/core-files'
import { serviceErrToResponse } from '../http/error-adapter'
import * as filesService from '../services/files'
import { ctxFromHono } from '../services/types'

const router = new Hono<HonoEnv>()
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const ReviewStatusBodySchema = SetAttachmentReviewStatusSchema.omit({ attachmentId: true })
router.get('/', async (c) => {
  try {
    return c.json(
      await filesService.listAttachments(ctxFromHono(c), {
        entityType: c.req.query('entityType'),
        entityId: c.req.query('entityId'),
      }),
    )
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})
router.post('/links', async (c) => {
  try {
    return c.json(await filesService.createLinkAttachment(ctxFromHono(c), await jsonBody(c).catch(() => null)), 201)
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})
router.post('/', async (c) => {
  const response = await coreFileRequest(c, '/files', c.req.raw.body, c.req.header('Content-Type'))
  return new Response(response.body, { status: response.ok ? 201 : response.status, headers: response.headers })
})
router.patch('/:id/review-status', async (c) => {
  try {
    const parsed = ReviewStatusBodySchema.safeParse(await jsonBody(c))
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())
    return c.json(
      await filesService.setAttachmentReviewStatus(ctxFromHono(c), {
        ...parsed.data,
        attachmentId: c.req.param('id'),
      }),
    )
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})
router.get('/:id/metadata', async (c) => {
  try {
    return c.json(await filesService.getAttachment(ctxFromHono(c), { id: c.req.param('id') }))
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})
router.get('/:id', async (c) => {
  const response = await coreFileRequest(c, `/files/${encodeURIComponent(c.req.param('id'))}`)
  if (!response.ok) return response
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  let filename = 'attachment'
  try {
    filename = decodeURIComponent(response.headers.get('x-projektor-filename') ?? filename)
  } catch {
    /* safe fallback */
  }
  const inline = INLINE_TYPES.has(contentType)
  return new Response(response.body, {
    headers: {
      'Content-Type': inline ? contentType : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[\r\n"\\]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    },
  })
})
router.delete('/:id', async (c) => {
  try {
    await filesService.deleteAttachment(ctxFromHono(c), { id: c.req.param('id') })
    return new Response(null, { status: 204 })
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})
export { router as filesRouter }
