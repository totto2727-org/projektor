'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import { WikiFreshnessBadge } from './wiki-freshness-badge.tsx'
import { WIKI_PAGE_LIST_ITEM_CLASS } from './wiki-page-list-style.ts'
import type { StalePageItem } from './wiki-page-model.ts'

/*
 * PROJ-489 (R7): the list_stale_pages maintenance queue — a simple flat list, matching
 * FilteredPagesList's styling below (no existing "maintenance queue" UI precedent to
 * follow elsewhere in this codebase).
 */
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function StalePagesList({
  loading,
  results,
  onSelect,
}: {
  loading: boolean
  results: StalePageItem[]
  onSelect: (slug: string) => void
}): JSX.Element {
  if (loading) {
    return <p className='text-[0.8rem] text-text-muted m-0'>Loading…</p>
  }
  if (Array.isArrayEmpty(results)) {
    return <p className='text-[0.8rem] text-text-muted m-0'>Nothing needs verification</p>
  }
  return (
    <ul className='list-none m-0 p-0'>
      {results.map((result) => (
        <li key={result.id}>
          <button
            type='button'
            className={WIKI_PAGE_LIST_ITEM_CLASS}
            onClick={() => {
              onSelect(result.slug)
            }}
          >
            <span className='font-medium'>{result.title}</span>
            {result.freshness && (
              <span className='block mt-[0.15rem]'>
                <WikiFreshnessBadge state={result.freshness.state} />
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
