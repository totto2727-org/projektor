'use client'
import { Predicate } from 'effect'
import type { JSX } from 'react'

import { hasSingleItem } from '#contracts/item-count.ts'
import { Button } from '@/components/ui/button.tsx'
import { getBacklogIssues } from '@/features/issues/components/board-utils.ts'
import type { Issue } from '@/features/issues/components/board-utils.ts'

import type { ViewMode } from './types-view.ts'
import type { SearchResult } from './use-issue-search.ts'

const countLabel = function countLabel(view: ViewMode, filtered: Issue[], totalIssues: number | null): string {
  const listCount = view === 'backlog' ? getBacklogIssues(filtered).length : filtered.length
  const suffix =
    view !== 'backlog' && Predicate.isNotNullish(totalIssues) && totalIssues !== filtered.length
      ? ` (of ${totalIssues})`
      : ''
  return `${listCount} issue${listCount !== 1 ? 's' : ''}${suffix}`
}

const searchCountLabel = function searchCountLabel(results: Readonly<SearchResult[]>, query: string): string {
  return `${results.length} result${!hasSingleItem(results) ? 's' : ''} for «${query.trim()}»`
}

interface HeaderRowProps {
  isSearchActive: boolean
  searchResults: SearchResult[] | null
  searchQuery: string
  view: ViewMode
  setView: (view: ViewMode) => void
  filtered: Issue[]
  totalIssues: number | null
  projectsCount: number
  openCreateModal: () => void
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function HeaderRow({
  isSearchActive,
  searchResults,
  searchQuery,
  view,
  setView,
  filtered,
  totalIssues,
  projectsCount,
  openCreateModal,
}: HeaderRowProps): JSX.Element {
  const label =
    isSearchActive && Predicate.isNotNullish(searchResults)
      ? searchCountLabel(searchResults, searchQuery)
      : countLabel(view, filtered, totalIssues)

  return (
    <div className='flex justify-between items-center gap-2 mb-3 max-sm:flex-col max-sm:items-stretch'>
      <p className='text-sm text-text-muted m-0'>{label}</p>

      <div className='flex gap-2 items-center max-sm:justify-between'>
        {projectsCount > 0 && (
          <Button variant='primary' size='sm' onClick={openCreateModal}>
            + New issue
          </Button>
        )}

        {!isSearchActive && (
          <fieldset aria-label='View mode' className='flex border border-border rounded-md overflow-hidden m-0 p-0'>
            <legend className='hidden'>View mode</legend>
            {(['list', 'board', 'backlog'] as const).map((mode) => (
              <button
                type='button'
                key={mode}
                aria-pressed={view === mode}
                onClick={() => {
                  setView(mode)
                }}
                className='border-none py-1 px-3 cursor-pointer text-[0.8rem] capitalize transition-colors duration-100'
                style={{
                  borderRight: mode !== 'backlog' ? '1px solid var(--border)' : 'none',
                  background: view === mode ? 'var(--accent)' : 'var(--bg)',
                  color: view === mode ? 'var(--on-accent)' : 'var(--text-muted)',
                  fontWeight: view === mode ? 600 : 400,
                }}
              >
                {mode}
              </button>
            ))}
          </fieldset>
        )}
      </div>
    </div>
  )
}
