'use client'
import type { JSX } from 'react'

import type { Issue } from '@/features/issues/components/board-utils.ts'
import { ReviewTargetsSummary } from '@/features/issues/components/review-targets-summary.tsx'
import { formatIssueRef } from '@/features/issues/lib/issue-ref.ts'
import { issueUrl } from '@/features/issues/utils/issue-url.ts'

import { IssueSelectionControl } from './bulk-actions.tsx'
import { statusBadge } from './issue-render-helpers.tsx'
import { PrioritySelect } from './priority-select.tsx'

type MobileCardsProps = Readonly<{
  issues: Readonly<Issue[]>
  updatingPriorityId: string | null
  changePriority: (issueId: string, priority: string) => void
}>

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const MobileCards = function MobileCards({
  issues,
  updatingPriorityId,
  changePriority,
}: MobileCardsProps): JSX.Element {
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
              onChange={(value) => {
                changePriority(issue.id, value)
              }}
            />
            {statusBadge(issue)}
          </div>
        </div>
      ))}
    </div>
  )
}
