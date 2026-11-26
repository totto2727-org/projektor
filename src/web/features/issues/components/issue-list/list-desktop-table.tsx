'use client'
import type { JSX } from 'react'

import { ReviewTargetsSummary } from '@/features/issues/components/review-targets-summary.tsx'
import { formatIssueRef } from '@/features/issues/lib/issue-ref.ts'
import { issueUrl } from '@/features/issues/utils/issue-url.ts'

import { IssueSelectionControl } from './bulk-actions.tsx'
import { getStoryPoints, spBadge } from './issue-render-helpers.tsx'
import { PrioritySelect } from './priority-select.tsx'
import { SortableHeader } from './sortable-header.tsx'
import { StatusSelect } from './status-select.tsx'
import type { IssueListTableProps } from './types-view.ts'

const renderDesktopTableHead = (
  sortBy: IssueListTableProps['sortBy'],
  sortDir: IssueListTableProps['sortDir'],
  onSort: IssueListTableProps['onSort'],
): JSX.Element => (
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
)

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const DesktopTable = function DesktopTable({
  issues,
  statuses,
  updatingId,
  updatingPriorityId,
  changeStatus,
  changePriority,
  sortBy,
  sortDir,
  onSort,
}: IssueListTableProps): JSX.Element {
  const renderDesktopIssuePriority = (
    issue: IssueListTableProps['issues'][number],
    pts: ReturnType<typeof getStoryPoints>,
  ): JSX.Element => (
    <div className='flex items-center gap-[0.375rem]'>
      <PrioritySelect
        issue={issue}
        busy={updatingPriorityId === issue.id}
        onChange={(value) => {
          changePriority(issue.id, value)
        }}
      />
      {pts && spBadge(pts)}
    </div>
  )

  const renderDesktopIssueRow = (issue: IssueListTableProps['issues'][number]): JSX.Element => {
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
        <td className='px-3 py-2 align-middle whitespace-nowrap'>{renderDesktopIssuePriority(issue, pts)}</td>
        <td className='px-3 py-2 align-middle whitespace-nowrap text-text-base'>
          {issue.assignee_name ?? <span className='text-text-muted'>—</span>}
        </td>
        <td className='px-3 py-2 align-middle whitespace-nowrap'>
          <StatusSelect
            issue={issue}
            statuses={statuses}
            busy={updatingId === issue.id}
            onChange={(value) => {
              changeStatus(issue.id, value)
            }}
          />
        </td>
      </tr>
    )
  }

  return (
    <div className='overflow-x-auto max-sm:hidden'>
      <table className='w-full border-collapse text-[0.9rem]'>
        {renderDesktopTableHead(sortBy, sortDir, onSort)}
        <tbody>{issues.map((issue) => renderDesktopIssueRow(issue))}</tbody>
      </table>
    </div>
  )
}
