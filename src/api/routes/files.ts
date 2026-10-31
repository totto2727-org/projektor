import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'

import * as filesService from '#commands/files'
import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body'
import { serviceErrToResponse } from '../http/error-adapter'
import { ctxFromHono } from '../services/types'

const router = new Hono<HonoEnv>()

const EntityTypeEnum = z.enum(['issue', 'wiki_page'])

router.get('/', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    const list = await filesService.listAttachments(ctx, {
      entityType: c.req.query('entityType'),
      entityId: c.req.query('entityId'),
    })
    return c.json(list)
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.post('/links', async (c) => {
  const ctx = ctxFromHono(c)
  const body = await jsonBody(c).catch(() => null)
  try {
    const result = await filesService.createLinkAttachment(ctx, body)
    return c.json(result, 201)
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

async function parseUploadFormData(c: Context<HonoEnv>) {
  try {
    return await c.req.formData()
  } catch {
    return c.json({ error: 'Expected multipart/form-data' }, 400)
  }
}

function extractUploadInput(c: Context<HonoEnv>, formData: FormData) {
  const fileRaw = formData.get('file')
  if (!fileRaw || typeof fileRaw === 'string') return c.json({ error: 'Missing file field' }, 400)
  const file = fileRaw as File

  const entityTypeRaw = formData.get('entityType')
  const entityId = formData.get('entityId')

  const parsed = EntityTypeEnum.safeParse(entityTypeRaw)
  if (!parsed.success) return c.json({ error: 'entityType must be issue or wiki_page' }, 400)
  if (!entityId || typeof entityId !== 'string') return c.json({ error: 'entityId is required' }, 400)

  return { file, entityType: parsed.data, entityId }
}

router.post('/', async (c) => {
  const ctx = ctxFromHono(c)

  const formData = await parseUploadFormData(c)
  if (formData instanceof Response) return formData

  const input = extractUploadInput(c, formData)
  if (input instanceof Response) return input
  try {
    const result = await filesService.uploadStoredAttachment(ctx, input, filesService.storageQuotaBytes(c.env))
    return c.json(result, 201)
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.get('/:id/metadata', async (c) => {
  const ctx = ctxFromHono(c)
  try {
    return c.json(await filesService.getAttachment(ctx, { id: c.req.param('id') }))
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
})

router.get('/:id', async (c) => {
  const ctx = ctxFromHono(c)
  const { id } = c.req.param()

  let stored: Awaited<ReturnType<typeof filesService.getStoredAttachment>>
  try {
    stored = await filesService.getStoredAttachment(ctx, id)
  } catch (e) {
    return serviceErrToResponse(c, e)
  }
  if (!stored) return c.json({ error: 'Object missing from storage' }, 404)

  const safeContentType = filesService.INLINE_TYPES.has(stored.contentType)
    ? stored.contentType
    : 'application/octet-stream'
  const disposition = filesService.INLINE_TYPES.has(stored.contentType) ? 'inline' : 'attachment'
  // Strip CR/LF and quotes to prevent header injection in the filename parameter.
  const safeFilename = stored.filename.replace(/[\r\n"\\]/g, '_')

  return new Response(stored.body, {
    headers: {
      'Content-Type': safeContentType,
      'Content-Disposition': `${disposition}; filename="${safeFilename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    },
  })
})

router.delete('/:id', async (c) => {
  const ctx = ctxFromHono(c)
  const { id } = c.req.param()

  try {
    await filesService.deleteStoredAttachment(ctx, id)
  } catch (e) {
    return serviceErrToResponse(c, e)
  }

  return new Response(null, { status: 204 })
})

export { router as filesRouter }
