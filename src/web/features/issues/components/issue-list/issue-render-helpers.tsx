'use client'
import type { JSX } from 'react'

import { categoryColor } from '@/features/issues/components/board-utils.ts'
import type { Issue } from '@/features/issues/components/board-utils.ts'
import { statusDisplayName } from '@/features/issues/lib/status.ts'

export const getStoryPoints = function getStoryPoints(issue: Issue): string | null {
  const field = (issue.customFields ?? []).find((selectedField) => selectedField.key === 'story_points')
  return field?.value ?? null
}

export const spBadge = function spBadge(pts: string): JSX.Element {
  return (
    <span
      className={[
        'text-[0.68rem] text-text-muted bg-surface border border-border rounded-[3px] px-[0.3rem]',
        'font-semibold whitespace-nowrap leading-[1.6]',
      ].join(' ')}
    >
      {pts} SP
    </span>
  )
}

export const priorityBadge = function priorityBadge(issue: Issue): JSX.Element {
  return (
    <span
      className='inline-flex items-center px-1.5 py-0.5 rounded text-[0.7rem] font-semibold capitalize whitespace-nowrap'
      style={{
        background: `var(--priority-${issue.priority}-bg, var(--priority-low-bg))`,
        color: `var(--priority-${issue.priority}-text, var(--text-muted))`,
      }}
    >
      {issue.priority === 'none' ? '–' : issue.priority}
    </span>
  )
}

export const statusBadge = function statusBadge(issue: Issue): JSX.Element {
  return (
    <span className='font-medium text-sm' style={{ color: categoryColor(issue.status_category) }}>
      {statusDisplayName(issue.status_name, issue.status_key)}
    </span>
  )
}
