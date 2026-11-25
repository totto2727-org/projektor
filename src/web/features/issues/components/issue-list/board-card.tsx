'use client'
import type { DragEvent, JSX } from 'react'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { assigneeInitials, ISSUE_BOARD_WIDE_MIN_WIDTH } from '@/features/issues/components/board-utils.ts'
import type { Issue, TaskStatus } from '@/features/issues/components/board-utils.ts'
import { ReviewTargetsSummary } from '@/features/issues/components/review-targets-summary.tsx'
import { issueUrl } from '@/features/issues/utils/issue-url.ts'

import { IssueSelectionControl } from './bulk-actions.tsx'
import { getStoryPoints, priorityBadge, spBadge } from './issue-render-helpers.tsx'
import { StatusSelect } from './status-select.tsx'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const BoardCard = function BoardCard({
  issue,
  statuses,
  dragIssueId,
  setDragIssueId,
  changeStatus,
}: {
  issue: Issue
  statuses: TaskStatus[]
  dragIssueId: string | undefined
  setDragIssueId: (id: string | undefined) => void
  changeStatus: (issueId: string, statusId: string) => void
}): JSX.Element {
  const pts = getStoryPoints(issue)
  return (
    <div
      key={issue.id}
      className={[
        'bg-surface border border-border rounded-md px-3 py-2.5 shadow-xs select-none',
        'transition-all duration-150 hover:shadow-md hover:border-accent hover:-translate-y-px',
      ].join(' ')}
      style={{ opacity: dragIssueId === issue.id ? 0.4 : 1 }}
    >
      <IssueSelectionControl issue={issue} />
      <a
        href={issueUrl(issue.project_key, issue.number, issue.title, issue.id, issue.workspaceSlug)}
        className='block no-underline'
        draggable
        onDragStart={(event: DragEvent<HTMLElement>) => {
          if (window.innerWidth < ISSUE_BOARD_WIDE_MIN_WIDTH) {
            event.preventDefault()
            return
          }
          event.dataTransfer?.setData('text/plain', issue.id)
          setDragIssueId(issue.id)
        }}
        onDragEnd={() => {
          setDragIssueId(undefined)
        }}
      >
        <div className='font-mono text-[0.72rem] text-text-muted mb-1'>
          {isNonEmptyText(issue.project_key) ? `${issue.project_key}-${issue.number}` : `#${issue.number}`}
        </div>
        <div className='text-sm font-medium text-text-base leading-[1.35] mb-2'>{issue.title}</div>
        <div className='flex justify-between items-center gap-2'>
          <div className='flex items-center gap-1.5'>
            {priorityBadge(issue)}
            {pts && spBadge(pts)}
          </div>
          {issue.assignee_name && (
            <span
              title={issue.assignee_name}
              className={[
                'w-6 h-6 rounded-full bg-accent text-white text-[0.68rem] font-bold flex items-center',
                'justify-center shrink-0 uppercase',
              ].join(' ')}
            >
              {assigneeInitials(issue.assignee_name)}
            </span>
          )}
        </div>
      </a>
      <ReviewTargetsSummary issue={issue} />
      {/* Mobile-only: native HTML5 drag-and-drop (used above 640px) doesn't
			    work on touch devices, so narrow viewports get a tap-to-open status
			    menu instead (PROJ-416). Rendered as a sibling of the <a>, not
			    nested inside it, so the interactive Select never lands inside
			    anchor content (matching the ListSection desktop-table/mobile-card
			    convention, and avoiding an invalid interactive-in-anchor nesting). */}
      <div className='hidden max-sm:block mt-2'>
        <StatusSelect
          issue={issue}
          statuses={statuses}
          busy={false}
          onChange={(statusId) => {
            changeStatus(issue.id, statusId)
          }}
        />
      </div>
    </div>
  )
}
