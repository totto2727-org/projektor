'use client'

import { String } from 'effect'
import type { JSX } from 'react'

import { TagChips } from './tag-chips.tsx'
import { WikiFreshnessBadge } from './wiki-freshness-badge.tsx'
import type { SearchResult } from './wiki-page-model.ts'
import { WikiStatusPill } from './wiki-status-pill.tsx'

const EMPTY_TAG_COUNT = 0

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function SearchResultMetaLine({ r }: { r: SearchResult }): undefined | JSX.Element {
  const isStale = r.freshness && r.freshness.state !== 'fresh'
  const show =
    String.isNonEmpty(r.type ?? '') ||
    String.isNonEmpty(r.status ?? '') ||
    (r.tags?.length ?? EMPTY_TAG_COUNT) > EMPTY_TAG_COUNT ||
    isStale === true
  if (!show) {
    return undefined
  }
  return (
    <span className='block mt-[0.15rem]'>
      {r.status && <WikiStatusPill status={r.status} />}
      {isStale && r.freshness && <WikiFreshnessBadge state={r.freshness.state} />}
      <TagChips tags={r.tags} />
    </span>
  )
}
