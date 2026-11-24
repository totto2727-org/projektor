import { describe, expect, test } from 'vite-plus/test'

import { deriveBrandMark } from '#api/routes/config.ts'

import { fetchNativeApi } from './native-fetch.ts'

describe('handles GET /api/config/brand', () => {
  test('reflects configured BRAND_* vars, deriving the mark and defaulting unset fields (open, no auth)', async () => {
    const res = await fetchNativeApi('http://localhost/api/config/brand')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual({
      accent: '#123456',
      logoUrl: null,
      mark: 'T',
      name: 'Test Brand',
      onAccent: null,
    })
  })
})

describe('deriveBrandMark', () => {
  test('uppercases the first character of the brand name', () => {
    expect(deriveBrandMark('acme')).toBe('A')
  })

  test('falls back to P for an empty or whitespace-only name', () => {
    expect(deriveBrandMark('   ')).toBe('P')
    expect(deriveBrandMark('')).toBe('P')
  })

  test('keeps an astral-plane leading character intact instead of splitting its surrogate pair', () => {
    expect(deriveBrandMark('🚀 Acme')).toBe('🚀')
  })
})
