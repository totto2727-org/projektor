'use client'

import { Array, String } from 'effect'
import type { JSX } from 'react'

import { TagChips } from './tag-chips.tsx'
import { WIKI_PAGE_LIST_ITEM_CLASS } from './wiki-page-list-style.ts'
import type { WikiListItem } from './wiki-page-model.ts'
import { WikiStatusPill } from './wiki-status-pill.tsx'

const EMPTY_TAG_COUNT = 0

const renderFilteredWikiPageButton = (result: WikiListItem, onSelect: (slug: string) => void): JSX.Element => (
  <button
    type='button'
    className={WIKI_PAGE_LIST_ITEM_CLASS}
    onClick={() => {
      onSelect(result.slug)
    }}
  >
    <span className='font-medium'>{result.title}</span>
    {(String.isNonEmpty(result.type ?? '') ||
      String.isNonEmpty(result.status ?? '') ||
      (result.tags?.length ?? EMPTY_TAG_COUNT) > EMPTY_TAG_COUNT) && (
      <span className='block mt-[0.15rem]'>
        {result.status && <WikiStatusPill status={result.status} />}
        <TagChips tags={result.tags} />
      </span>
    )}
  </button>
)

/*
 * PROJ-488: flat, non-hierarchical list shown in the sidebar when a type/status/tag
 * filter is active — filtering the page *tree* (does any descendant match?) is out of
 * scope for this ticket, so an active filter temporarily replaces the tree view instead
 * of pruning it.
 */
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function FilteredPagesList({
  loading,
  results,
  onSelect,
}: {
  loading: boolean
  results: WikiListItem[]
  onSelect: (slug: string) => void
}): JSX.Element {
  if (loading) {
    return <p className='text-[0.8rem] text-text-muted m-0'>Loading…</p>
  }
  if (Array.isArrayEmpty(results)) {
    return <p className='text-[0.8rem] text-text-muted m-0'>No matching pages</p>
  }
  return (
    <ul className='list-none m-0 p-0'>
      {results.map((result) => (
        <li key={result.id}>{renderFilteredWikiPageButton(result, onSelect)}</li>
      ))}
    </ul>
  )
}
