import { Hono } from 'hono'

import type { HonoEnv } from '#types'

const router = new Hono<HonoEnv>()

const firstChar = function firstChar(value: string): string {
  return Array.from(value)[0] ?? ''
}

export function deriveBrandMark(name: string): string {
  const trimmed = name.trim()
  return trimmed ? firstChar(trimmed).toUpperCase() : 'P'
}

router.get('/brand', (httpContext) => {
  const name = httpContext.env.BRAND_NAME?.trim() || 'Projektor'
  const markOverride = httpContext.env.BRAND_MARK?.trim()
  return httpContext.json(
    {
      name,
      mark: markOverride ? firstChar(markOverride) : deriveBrandMark(name),
      accent: httpContext.env.BRAND_ACCENT?.trim() || null,
      onAccent: httpContext.env.BRAND_ON_ACCENT?.trim() || null,
      logoUrl: httpContext.env.BRAND_LOGO_URL?.trim() || null,
    },
    200,
    { 'Cache-Control': 'public, max-age=300' },
  )
})

export { router as configRouter }
