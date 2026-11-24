'use client'
import type { JSX } from 'react'

import type { Issue, SortKey, TaskStatus } from '@/features/issues/components/board-utils.ts'

import BacklogView from './backlog-view.tsx'
import BoardView from './board-view.tsx'
import ListSection from './list-section.tsx'
import type { IssuePagination } from './page-navigation.tsx'
import SearchResultsSection from './search-results-section.tsx'
import type { ViewMode } from './types-view.ts'
import type { SearchResult } from './use-issue-search.ts'

interface MainContentProps {
  isSearchActive: boolean
  searchResults: SearchResult[] | null
  searchQuery: string
  view: ViewMode
  issues: Issue[]
  statuses: TaskStatus[]
  updatingId: string | null
  updatingPriorityId: string | null
  changeStatus: (issueId: string, statusId: string) => void
  changePriority: (issueId: string, priority: string) => void
  sortBy: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
  pagination: IssuePagination
}

export default function MainContent({
  isSearchActive,
  searchResults,
  searchQuery,
  view,
  issues,
  statuses,
  updatingId,
  updatingPriorityId,
  changeStatus,
  changePriority,
  sortBy,
  sortDir,
  onSort,
  pagination,
}: MainContentProps): JSX.Element {
  if (isSearchActive) {
    return <SearchResultsSection searchLoading={false} searchResults={searchResults} searchQuery={searchQuery} />
  }
  if (view === 'board') {
    return <BoardView issues={issues} statuses={statuses} changeStatus={changeStatus} />
  }
  if (view === 'backlog') {
    return (
      <BacklogView
        issues={issues}
        statuses={statuses}
        updatingId={updatingId}
        updatingPriorityId={updatingPriorityId}
        changeStatus={changeStatus}
        changePriority={changePriority}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={onSort}
      />
    )
  }
  return (
    <ListSection
      issues={issues}
      statuses={statuses}
      updatingId={updatingId}
      updatingPriorityId={updatingPriorityId}
      changeStatus={changeStatus}
      changePriority={changePriority}
      sortBy={sortBy}
      sortDir={sortDir}
      onSort={onSort}
      pagination={pagination}
    />
  )
}
