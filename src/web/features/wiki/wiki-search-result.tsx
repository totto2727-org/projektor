'use client'

import { String } from 'effect'
import type { JSX } from 'react'

import { WIKI_PAGE_LIST_ITEM_CLASS } from './wiki-page-list-style.ts'
import type { SearchResult } from './wiki-page-model.ts'
import { SearchResultMetaLine } from './wiki-search-result-meta.tsx'

const EXCERPT_MARKER_LENGTH = 2

const EXCERPT_MARKER_END = -2

/*
 * PROJ-486: search excerpts come back with `**match**` markers from the
 * backend's FTS5 snippet() highlighting — split and render as <mark> instead
 * of showing the literal asterisks.
 */
const renderHighlightedExcerpt = function renderHighlightedExcerpt(excerpt: string) {
  const parts = excerpt.split(/(\*\*[^*]*\*\*)/gu).filter((part) => String.isNonEmpty(part))
  let offset = 0
  return parts.map((part) => {
    const key = offset
    offset += part.length
    return part.startsWith('**') && part.endsWith('**') ? (
      <mark key={key} className='bg-accent-soft text-inherit rounded-xs'>
        {part.slice(EXCERPT_MARKER_LENGTH, EXCERPT_MARKER_END)}
      </mark>
    ) : (
      <span key={key}>{part}</span>
    )
  })
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function SearchResultButton({
  r,
  onSelect,
}: {
  r: SearchResult
  onSelect: (slug: string) => void
}): JSX.Element {
  return (
    <button
      type='button'
      className={WIKI_PAGE_LIST_ITEM_CLASS}
      onClick={() => {
        onSelect(r.slug)
      }}
    >
      <span className='font-medium'>{r.title}</span>
      <SearchResultMetaLine r={r} />
      {r.excerpt && (
        <span className='block text-[0.75rem] text-text-muted truncate'>{renderHighlightedExcerpt(r.excerpt)}</span>
      )}
    </button>
  )
}
