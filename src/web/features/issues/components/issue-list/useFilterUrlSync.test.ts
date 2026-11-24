'use client'
import { describe, expect, test } from 'vite-plus/test'

import { parseDateField } from './useFilterUrlSync.ts'

describe('parseDateField', () => {
  test("passes through 'completed'", () => {
    expect(parseDateField('completed')).toBe('completed')
  })

  test("passes through 'updated'", () => {
    expect(parseDateField('updated')).toBe('updated')
  })

  test('returns an empty string for null', () => {
    expect(parseDateField(null)).toBe('')
  })

  test('returns an empty string for an unrecognized value', () => {
    expect(parseDateField('created')).toBe('')
  })
})
