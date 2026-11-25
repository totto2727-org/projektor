import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { MetricsQuerySchema } from '#core/web/planning.ts'
import { runTestEffect } from '#tests/run-effect.ts'

import { applyDateRangeParams } from './issue-list-helpers.ts'

const decodeMetricsQuery = Schema.decodeUnknownEffect(MetricsQuerySchema)

// Both initial SSR and client pagination use this exact calendar conversion.
describe('covers UTC calendar issue filters', () => {
  test('keeps inclusive UTC bounds through daylight-saving transition days', () => {
    const query = new URLSearchParams()
    applyDateRangeParams(query, 'updated', '2026-03-08', '2026-03-08')
    expect(query.get('updatedAfter')).toBe(String(Date.parse('2026-03-08T00:00:00Z') / 1000))
    expect(Number(query.get('updatedBefore')) - Number(query.get('updatedAfter'))).toBe(86_399)
  })

  test('does not normalize impossible dates to a different calendar day', () => {
    const query = new URLSearchParams()
    applyDateRangeParams(query, 'completed', '2026-02-30', '')
    expect(query.get('completedAfter')).toBe('NaN')
  })
})

describe('private metrics input budget', () => {
  const base = { projectId: 'p1', since: 0, until: 86_400, granularity: 'day', mode: 'claims', prefix: '' }

  test.each([Number.NaN, Infinity, -1, 0.5, 366 * 86_400, 253_402_300_800])(
    'rejects invalid or excessive until %s',
    async (until) => {
      await expect(runTestEffect(decodeMetricsQuery({ ...base, until }))).rejects.toBeDefined()
    },
  )

  test('accepts exactly 366 inclusive calendar days but rejects reversed ranges', async () => {
    await expect(runTestEffect(decodeMetricsQuery({ ...base, until: 366 * 86_400 - 1 }))).resolves.toBeDefined()
    await expect(runTestEffect(decodeMetricsQuery({ ...base, since: 2, until: 1 }))).rejects.toBeDefined()
  })
})
