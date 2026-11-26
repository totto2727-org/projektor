import { String, Predicate } from 'effect'
import { Hono } from 'hono'

import { HTTP_OK } from '#contracts/http-status.ts'
import { firstCodePoint, trimNonEmptyText } from '#contracts/non-empty-text.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import type { HonoEnv } from '#types'

export const configRouter = new Hono<HonoEnv>()

export const deriveBrandMark = function deriveBrandMark(name: string): string {
  const trimmed = name.trim()
  return firstCodePoint(trimmed)?.toUpperCase() ?? 'P'
}

configRouter.get('/brand', (httpContext) => {
  const name = trimNonEmptyText(httpContext.env.BRAND_NAME) ?? 'Projektor'
  const markOverride = httpContext.env.BRAND_MARK?.trim()
  return httpContext.json(
    fieldsInOrder([
      ['name', name],
      [
        'mark',
        Predicate.isNotNullish(markOverride) && String.isNonEmpty(markOverride)
          ? (firstCodePoint(markOverride) ?? '')
          : deriveBrandMark(name),
      ],
      ['accent', trimNonEmptyText(httpContext.env.BRAND_ACCENT) ?? null],
      ['onAccent', trimNonEmptyText(httpContext.env.BRAND_ON_ACCENT) ?? null],
      ['logoUrl', trimNonEmptyText(httpContext.env.BRAND_LOGO_URL) ?? null],
    ]),
    HTTP_OK,
    { 'Cache-Control': 'public, max-age=300' },
  )
})
