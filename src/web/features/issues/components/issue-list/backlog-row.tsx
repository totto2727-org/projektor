'use client'
import type { DragEvent, JSX } from 'react'

import type { Issue, TaskStatus } from '@/features/issues/components/board-utils.ts'
import { ReviewTargetsSummary } from '@/features/issues/components/review-targets-summary.tsx'
import { formatIssueRef } from '@/features/issues/lib/issue-ref.ts'
import { issueUrl } from '@/features/issues/utils/issue-url.ts'

import { IssueSelectionControl } from './bulk-actions.tsx'
import { getStoryPoints, spBadge } from './issue-render-helpers.tsx'
import { PrioritySelect } from './priority-select.tsx'
import { StatusSelect } from './status-select.tsx'

interface RowProps {
  issue: Issue
  statuses: TaskStatus[]
  updatingId: string | null
  updatingPriorityId: string | null
  changeStatus: (issueId: string, statusId: string) => void
  changePriority: (issueId: string, priority: string) => void
  isDragging: boolean
  isOver: boolean
  onDragStart: (selectedEvent: DragEvent<HTMLElement>, issueId: string) => void
  onDragOver: (selectedEvent: DragEvent<HTMLElement>, issueId: string) => void
  onDrop: (selectedEvent: DragEvent<HTMLElement>, issueId: string) => void
  onDragEnd: () => void
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const BacklogRow = function BacklogRow({
  issue,
  statuses,
  updatingId,
  updatingPriorityId,
  changeStatus,
  changePriority,
  isDragging,
  isOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: RowProps): JSX.Element {
  const pts = getStoryPoints(issue)
  const renderBacklogPriority = (): JSX.Element => (
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

  return (
    <tr
      key={issue.id}
      className='border-b border-border group'
      draggable
      onDragStart={(selectedEvent: DragEvent<HTMLElement>) => {
        onDragStart(selectedEvent, issue.id)
      }}
      onDragOver={(selectedEvent: DragEvent<HTMLElement>) => {
        onDragOver(selectedEvent, issue.id)
      }}
      onDrop={(selectedEvent: DragEvent<HTMLElement>) => {
        onDrop(selectedEvent, issue.id)
      }}
      onDragEnd={onDragEnd}
      style={{
        opacity: isDragging ? 0.5 : 1,
        boxShadow: isOver ? 'inset 0 2px 0 0 var(--accent)' : undefined,
      }}
    >
      <td className='px-2 py-2 align-middle w-8'>
        <span
          className='text-text-muted opacity-0 group-hover:opacity-100 transition-opacity select-none text-base leading-none'
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          aria-hidden='true'
        >
          ⠿
        </span>
      </td>
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
      <td className='px-3 py-2 align-middle whitespace-nowrap'>{renderBacklogPriority()}</td>
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
