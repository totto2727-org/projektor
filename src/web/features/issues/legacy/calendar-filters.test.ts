import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { MetricsQuerySchema } from '../../../../core/web/planning'
import { applyDateRangeParams } from './IssueList-helpers'

// Both initial SSR and client pagination use this exact calendar conversion.
describe('UTC calendar issue filters', () => {
  it('keeps inclusive UTC bounds through daylight-saving transition days', () => {
    const query = new URLSearchParams()
    applyDateRangeParams(query, 'updated', '2026-03-08', '2026-03-08')
    expect(query.get('updatedAfter')).toBe(String(Date.parse('2026-03-08T00:00:00Z') / 1000))
    expect(Number(query.get('updatedBefore')) - Number(query.get('updatedAfter'))).toBe(86399)
  })
  it('does not normalize impossible dates to a different calendar day', () => {
    const query = new URLSearchParams()
    applyDateRangeParams(query, 'completed', '2026-02-30', '')
    expect(query.get('completedAfter')).toBe('NaN')
  })
})

describe('private metrics input budget', () => {
  const base = { projectId: 'p1', since: 0, until: 86400, granularity: 'day', mode: 'claims', prefix: '' }
  it.each([Number.NaN, Infinity, -1, 0.5, 366 * 86400, 253402300800])(
    'rejects invalid or excessive until %s',
    async (until) => {
      await expect(
        Effect.runPromise(Schema.decodeUnknownEffect(MetricsQuerySchema)({ ...base, until })),
      ).rejects.toBeDefined()
    },
  )
  it('accepts exactly 366 inclusive calendar days but rejects reversed ranges', async () => {
    await expect(
      Effect.runPromise(Schema.decodeUnknownEffect(MetricsQuerySchema)({ ...base, until: 366 * 86400 - 1 })),
    ).resolves.toBeDefined()
    await expect(
      Effect.runPromise(Schema.decodeUnknownEffect(MetricsQuerySchema)({ ...base, since: 2, until: 1 })),
    ).rejects.toBeDefined()
  })
})
