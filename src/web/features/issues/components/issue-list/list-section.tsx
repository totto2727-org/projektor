'use client'
import { Array } from 'effect'
import type { JSX } from 'react'

import type { Issue, SortKey, TaskStatus } from '@/features/issues/components/board-utils.ts'
import { ReviewTargetsSummary } from '@/features/issues/components/review-targets-summary.tsx'
import { formatIssueRef } from '@/features/issues/lib/issue-ref.ts'
import { issueUrl } from '@/features/issues/utils/issue-url.ts'
import { useMediaQuery } from '@/features/issues/utils/use-media-query.ts'

import { IssueSelectionControl } from './bulk-actions.tsx'
import {
  getStoryPoints,
  PrioritySelect,
  SortableHeader,
  StatusSelect,
  spBadge,
  statusBadge,
} from './issue-render-helpers.tsx'
import { PageNavigation } from './page-navigation.tsx'
import type { IssuePagination } from './page-navigation.tsx'

interface ListSectionProps {
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

interface RowsProps {
  issues: Issue[]
  statuses: TaskStatus[]
  updatingId: string | null
  updatingPriorityId: string | null
  changeStatus: (issueId: string, statusId: string) => void
  changePriority: (issueId: string, priority: string) => void
}

const DesktopTable = function DesktopTable({
  issues,
  statuses,
  updatingId,
  updatingPriorityId,
  changeStatus,
  changePriority,
  sortBy,
  sortDir,
  onSort,
}: RowsProps & { sortBy: SortKey; sortDir: 'asc' | 'desc'; onSort: (key: SortKey) => void }): JSX.Element {
  return (
    <div className='overflow-x-auto max-sm:hidden'>
      <table className='w-full border-collapse text-[0.9rem]'>
        <thead>
          <tr className='bg-surface'>
            <SortableHeader label='#' sortKey='number' sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortableHeader
              label='Title'
              sortKey='title'
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
              extraClass='w-full'
            />
            <SortableHeader label='Priority' sortKey='priority' sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortableHeader label='Assignee' sortKey='assignee' sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortableHeader label='Status' sortKey='status' sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => {
            const pts = getStoryPoints(issue)
            return (
              <tr key={issue.id} className='border-b border-border'>
                <td className='px-3 py-2 align-middle whitespace-nowrap'>
                  <IssueSelectionControl issue={issue} />
                  <a
                    href={issueUrl(issue.project_key, issue.number, issue.title, issue.id, issue.workspaceSlug)}
                    className='text-text-muted font-mono text-[0.8rem] no-underline hover:underline focus:underline'
                  >
                    {formatIssueRef(issue.project_key, issue.number)}
                  </a>
                </td>
                <td className='px-3 py-2 align-middle text-text-base'>
                  <a
                    href={issueUrl(issue.project_key, issue.number, issue.title, issue.id, issue.workspaceSlug)}
                    className='text-text-base no-underline hover:underline focus:underline'
                  >
                    {issue.title}
                  </a>
                  <ReviewTargetsSummary issue={issue} />
                </td>
                <td className='px-3 py-2 align-middle whitespace-nowrap'>
                  <div className='flex items-center gap-[0.375rem]'>
                    <PrioritySelect
                      issue={issue}
                      busy={updatingPriorityId === issue.id}
                      onChange={(value) => changePriority(issue.id, value)}
                    />
                    {pts && spBadge(pts)}
                  </div>
                </td>
                <td className='px-3 py-2 align-middle whitespace-nowrap text-text-base'>
                  {issue.assignee_name ?? <span className='text-text-muted'>—</span>}
                </td>
                <td className='px-3 py-2 align-middle whitespace-nowrap'>
                  <StatusSelect
                    issue={issue}
                    statuses={statuses}
                    busy={updatingId === issue.id}
                    onChange={(value) => changeStatus(issue.id, value)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const MobileCards = function MobileCards({ issues, updatingPriorityId, changePriority }: RowsProps): JSX.Element {
  return (
    <div className='hidden max-sm:flex max-sm:flex-col max-sm:gap-3'>
      {issues.map((issue) => (
        <div key={issue.id} className='py-3 px-4 border border-border rounded-md bg-surface'>
          <IssueSelectionControl issue={issue} />
          <a
            href={issueUrl(issue.project_key, issue.number, issue.title, issue.id, issue.workspaceSlug)}
            className='inline-block font-mono text-[0.8rem] text-text-muted no-underline hover:underline focus:underline mb-1'
          >
            {formatIssueRef(issue.project_key, issue.number)}
          </a>
          <a
            href={issueUrl(issue.project_key, issue.number, issue.title, issue.id, issue.workspaceSlug)}
            className='no-underline'
          >
            <div className='text-[0.9rem] text-text-base font-medium mb-2'>{issue.title}</div>
          </a>
          <ReviewTargetsSummary issue={issue} />
          <div className='flex gap-[0.375rem] flex-wrap'>
            <PrioritySelect
              issue={issue}
              busy={updatingPriorityId === issue.id}
              onChange={(value) => changePriority(issue.id, value)}
            />
            {statusBadge(issue)}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ListSection({
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
