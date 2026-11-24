'use client'
import type { JSX, RefObject } from 'react'

import { queryFields } from '@/features/issues/utils/query-fields.ts'
import type { IssuesRoute } from '@/features/issues/views/issues-page.tsx'

export default function SearchBox({
  searchQuery,
  setSearchQuery,
  isSearchActive,
  searchInputRef,
  route,
}: {
  searchQuery: string
  setSearchQuery: (query: string) => void
  isSearchActive: boolean
  searchInputRef: RefObject<HTMLInputElement | null>
  route: IssuesRoute
}): JSX.Element {
  return (
    <form action={route.pathname} method='get' className='flex items-center gap-1 max-sm:w-full'>
      {queryFields(route.search, ['q', 'cursor']).map(({ name, value, key }) => (
        <input key={key} type='hidden' name={name} value={value} />
      ))}
      <input
        ref={searchInputRef}
        type='search'
        name='q'
        value={searchQuery}
        onInput={(event) => {
          setSearchQuery((event.target as HTMLInputElement).value)
        }}
        placeholder='Search…'
        aria-label='Search issues'
        className={`py-1 px-[0.625rem] border border-border rounded bg-bg text-text-base text-[0.8rem]
					outline-hidden max-sm:w-full transition-[width] duration-200 ${isSearchActive ? 'w-48' : 'w-28'}`}
      />
      {isSearchActive && (
        <button
          type='button'
          aria-label='Clear search'
          onClick={() => {
            setSearchQuery('')
            searchInputRef.current?.focus()
          }}
          className='bg-transparent border-none text-text-muted cursor-pointer text-base px-1 leading-none'
        >
          ×
        </button>
      )}
      <button type='submit' className='sr-only'>
        Search issues
      </button>
    </form>
  )
}
