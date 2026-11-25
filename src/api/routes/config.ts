import { String, Predicate } from 'effect'
import { Hono } from 'hono'

import { HTTP_OK } from '#contracts/http-status.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import type { HonoEnv } from '#types'

export const configRouter = new Hono<HonoEnv>()

const firstChar = function firstChar(value: string): string {
  return Array.from(value)[0] ?? ''
}

export const deriveBrandMark = function deriveBrandMark(name: string): string {
  const trimmed = name.trim()
  return trimmed ? firstChar(trimmed).toUpperCase() : 'P'
}

configRouter.get('/brand', (httpContext) => {
  const name = httpContext.env.BRAND_NAME?.trim() || 'Projektor'
  const markOverride = httpContext.env.BRAND_MARK?.trim()
  return httpContext.json(
    fieldsInOrder([
      ['name', name],
      [
        'mark',
        Predicate.isNotNullish(markOverride) && String.isNonEmpty(markOverride)
          ? firstChar(markOverride)
          : deriveBrandMark(name),
      ],
      ['accent', httpContext.env.BRAND_ACCENT?.trim() || null],
      ['onAccent', httpContext.env.BRAND_ON_ACCENT?.trim() || null],
      ['logoUrl', httpContext.env.BRAND_LOGO_URL?.trim() || null],
    ]),
    HTTP_OK,
    { 'Cache-Control': 'public, max-age=300' },
  )
})
