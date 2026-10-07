// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { formatTimestamp, formatTimestampDate } from './timestamp'
import { WikiPageClient, type WikiSeed } from './wiki/WikiPageClient'

vi.mock('./wiki/actions', () => ({}))
vi.mock('../attachment-actions', () => ({
  uploadAttachment: vi.fn(),
  uploadInlineImage: vi.fn(),
}))
vi.mock('@effront/core/query', () => ({ query: vi.fn() }))
vi.mock('./wiki/LazyMarkdownEditor', () => ({ default: () => null }))

const timestamp = Date.parse('2026-10-04T08:48:46Z') / 1000
function seed(): WikiSeed {
  return {
    workspaceSlug: 'team',
    projectId: '',
    slug: 'guide',
    mode: 'read',
    brandName: 'Acme',
    publicViewer: false,
    createTitle: '',
    filterType: '',
    filterStatus: '',
    filterTags: '',
    searchQuery: '',
    draft: null,
    draftStatus: 'ready',
    tree: [],
    revisions: [],
    attachments: [],
    templates: [],
    projects: [],
    stalePages: [],
    filteredPages: [],
    searchResults: [],
    page: {
      id: 'page',
      slug: 'guide',
      title: 'Guide',
      content: 'Published',
      project_id: null,
      parent_id: null,
      revisionId: 'rev',
      updated_at: timestamp,
      type: null,
      status: null,
      tags: [],
      owners: [],
      verified_at: timestamp,
      verified_by: 'Alice',
      verify_interval: null,
      freshness: null,
    },
  }
}

const localeString = Date.prototype.toLocaleString
const localeDateString = Date.prototype.toLocaleDateString
function environment(locale: string, timeZone: string) {
  vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (this: Date, locales, options) {
    return localeString.call(this, locales ?? locale, { timeZone, ...options })
  })
  vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date, locales, options) {
    return localeDateString.call(this, locales ?? locale, { timeZone, ...options })
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('SSR timestamp hydration', () => {
  it.each([
    [0, '1970-01-01', '00:00:00'],
    [timestamp, '2026-10-04', '08:48:46'],
    [Date.parse('2026-12-31T23:59:59Z') / 1000, '2026-12-31', '23:59:59'],
  ])('formats %s as explicit UTC without locale defaults', (seconds, date, time) => {
    expect(formatTimestamp(seconds)).toBe(`${date} ${time} UTC`)
    expect(formatTimestampDate(seconds)).toBe(`${date} UTC`)
  })
  it('preserves invalid-date display without throwing during SSR', () => {
    expect(formatTimestamp(Number.NaN)).toBe('Invalid Date')
    expect(formatTimestampDate(Number.POSITIVE_INFINITY)).toBe('Invalid Date')
  })
  it.each([
    ['en-US', 'Asia/Tokyo'],
    ['ja-JP', 'Asia/Tokyo'],
    ['en-US', 'America/Los_Angeles'],
  ])('hydrates Wiki timestamps unchanged in %s / %s', async (locale, timeZone) => {
    environment('en-US', 'UTC')
    const initial = seed()
    const element = <WikiPageClient initial={initial} />
    const container = document.createElement('div')
    container.innerHTML = renderToString(element)
    document.body.appendChild(container)
    const serverText = container.textContent
    const errors: unknown[] = []
    environment(locale, timeZone)
    let root: Root | undefined
    try {
      await act(async () => {
        root = hydrateRoot(container, element, {
          onRecoverableError: (error) => errors.push(error),
        })
      })
      expect(errors).toEqual([])
      expect(container.textContent).toBe(serverText)
      expect(container.querySelector('footer')?.textContent).toBe('Last updated: 2026-10-04 08:48:46 UTC')
      expect(container.textContent).toContain('Verified 2026-10-04 UTC')
    } finally {
      await act(async () => root?.unmount())
    }
  })
})
