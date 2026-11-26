'use client'

import { Array, String } from 'effect'
import { useCallback } from 'react'
import type { JSX } from 'react'

import { WIKI_PAGE_LIST_ITEM_CLASS } from './wiki-page-list-style.ts'
import type { SearchResult } from './wiki-page-model.ts'
import { SearchResultMetaLine } from './wiki-search-result-meta.tsx'

const INITIAL_EXCERPT_OFFSET = 0
const EXCERPT_MARKER_LENGTH = 2

const EXCERPT_MARKER_END = -2

/*
 * PROJ-486: search excerpts come back with `**match**` markers from the
 * backend's FTS5 snippet() highlighting — split and render as <mark> instead
 * of showing the literal asterisks.
 */
const renderHighlightedExcerpt = function renderHighlightedExcerpt(excerpt: string): JSX.Element[] {
  const parts = excerpt.split(/(?<highlight>\*\*[^*]*\*\*)/gu).filter((part) => String.isNonEmpty(part))
  const [, fragments] = Array.mapAccum(parts, INITIAL_EXCERPT_OFFSET, (offset, part) => {
    const fragment =
      part.startsWith('**') && part.endsWith('**') ? (
        <mark key={offset} className='bg-accent-soft text-inherit rounded-xs'>
          {part.slice(EXCERPT_MARKER_LENGTH, EXCERPT_MARKER_END)}
        </mark>
      ) : (
        <span key={offset}>{part}</span>
      )
    return [offset + part.length, fragment]
  })
  return fragments
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function SearchResultButton({
  result,
  onSelect,
}: {
  result: SearchResult
  onSelect: (slug: string) => void
}): JSX.Element {
  const excerpt = result.excerpt ?? ''
  const handleSelect = useCallback((): void => {
    onSelect(result.slug)
  }, [onSelect, result.slug])
  return (
    <button type='button' className={WIKI_PAGE_LIST_ITEM_CLASS} onClick={handleSelect}>
      <span className='font-medium'>{result.title}</span>
      <SearchResultMetaLine result={result} />
      {String.isNonEmpty(excerpt) && (
        <span className='block text-[0.75rem] text-text-muted truncate'>{renderHighlightedExcerpt(excerpt)}</span>
      )}
    </button>
  )
}
