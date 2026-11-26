'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import type { SearchResult } from './wiki-page-model.ts'
import { SearchResultButton } from './wiki-search-result.tsx'

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function SearchResultsList({
  loading,
  results,
  onSelect,
}: {
  loading: boolean
  results: SearchResult[]
  onSelect: (slug: string) => void
}): JSX.Element {
  if (loading) {
    return <p className='text-[0.8rem] text-text-muted m-0'>Searching…</p>
  }
  if (Array.isArrayEmpty(results)) {
    return <p className='text-[0.8rem] text-text-muted m-0'>No results</p>
  }
  return (
    <ul className='list-none m-0 p-0'>
      {results.map((result) => (
        <li key={result.id}>
          <SearchResultButton result={result} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  )
}
