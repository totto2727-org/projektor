'use client'
import { Array } from 'effect'
import type { JSX } from 'react'

import { useMediaQuery } from '@/features/issues/utils/use-media-query.ts'

import { DesktopTable } from './list-desktop-table.tsx'
import { MobileCards } from './list-mobile-cards.tsx'
import { PageNavigation } from './page-navigation.tsx'
import type { IssuePagination } from './page-navigation.tsx'
import type { IssueListTableProps } from './types-view.ts'

interface ListSectionProps extends IssueListTableProps {
  pagination: IssuePagination
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function ListSection({
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
}: ListSectionProps): JSX.Element {
  // PROJ-862: render ONE layout (Tailwind's max-sm breakpoint), not both hidden by CSS.
  const isMobile = useMediaQuery('(max-width: 639.98px)')

  if (Array.isArrayEmpty(issues)) {
    return <p className='text-text-base'>No issues match the current filters.</p>
  }

  return (
    <>
      {isMobile !== true && (
        <DesktopTable
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
      )}

      {isMobile !== false && (
        <MobileCards
          issues={issues}
          statuses={statuses}
          updatingId={updatingId}
          updatingPriorityId={updatingPriorityId}
          changeStatus={changeStatus}
          changePriority={changePriority}
        />
      )}

      <PageNavigation {...pagination} />
    </>
  )
}
