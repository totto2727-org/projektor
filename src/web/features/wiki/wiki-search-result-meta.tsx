'use client'

import { Array, Predicate, String } from 'effect'
import type { JSX } from 'react'

import { TagChips } from './tag-chips.tsx'
import { WikiFreshnessBadge } from './wiki-freshness-badge.tsx'
import type { SearchResult } from './wiki-page-model.ts'
import { WikiStatusPill } from './wiki-status-pill.tsx'

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function SearchResultMetaLine({ result }: { result: SearchResult }): undefined | JSX.Element {
  const status = result.status ?? ''
  const freshness = result.freshness?.state
  const isStale = Predicate.isNotNullish(freshness) && freshness !== 'fresh'
  const show =
    String.isNonEmpty(result.type ?? '') ||
    String.isNonEmpty(status) ||
    (Array.isArray(result.tags) && Array.isArrayNonEmpty(result.tags)) ||
    isStale
  if (!show) {
    return undefined
  }
  return (
    <span className='block mt-[0.15rem]'>
      {String.isNonEmpty(status) && <WikiStatusPill status={status} />}
      {isStale && <WikiFreshnessBadge state={freshness} />}
      <TagChips tags={result.tags} />
    </span>
  )
}
