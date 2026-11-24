'use client'
import { Array } from 'effect'
import type { JSX } from 'react'

import Select from '@/components/ui/select.tsx'
import { categoryColor } from '@/features/issues/components/board-utils.ts'
import type { Issue, SortKey, TaskStatus } from '@/features/issues/components/board-utils.ts'
import { formatIssueRef } from '@/features/issues/lib/issue-ref.ts'
import { statusDisplayName } from '@/features/issues/lib/status.ts'
import { PRIORITY_OPTIONS } from '@/features/issues/utils/issue-utils.ts'

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

export const PrioritySelect = function PrioritySelect({
  issue,
  busy,
  onChange,
}: {
  issue: Issue
  busy: boolean
  onChange: (value: string) => void
}): JSX.Element {
  const ref = issue.project_key ? `${issue.project_key}-${issue.number}` : issue.number
  return (
    <Select
      ariaLabel={`Change priority for issue ${ref}`}
      value={issue.priority}
      disabled={busy}
      capitalize
      onChange={onChange}
      options={PRIORITY_OPTIONS}
      buttonStyle={{
        background: `var(--priority-${issue.priority}-bg, var(--priority-low-bg))`,
        color: `var(--priority-${issue.priority}-text, var(--text-muted))`,
        fontWeight: 500,
        borderColor: 'transparent',
      }}
    />
  )
}

export const StatusSelect = function StatusSelect({
  issue,
  statuses,
  busy,
  onChange,
}: {
  issue: Issue
  statuses: TaskStatus[]
  busy: boolean
  onChange: (value: string) => void
}): JSX.Element {
  if (Array.isArrayEmpty(statuses)) {
    return statusBadge(issue)
  }
  return (
    <Select
      ariaLabel={`Change status for issue ${formatIssueRef(issue.project_key, issue.number)}`}
      value={issue.status_id ?? ''}
      disabled={busy}
      onChange={onChange}
      options={statuses.map(({ id, name }) => ({ label: name, value: id }))}
      buttonStyle={{
        color: categoryColor(issue.status_category),
        fontWeight: 500,
      }}
    />
  )
}

export const SortableHeader = function SortableHeader({
  label,
  sortKey,
  sortBy,
  sortDir,
  onSort,
  extraClass,
}: {
  label: string
  sortKey: SortKey
  sortBy: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
  extraClass?: string
}): JSX.Element {
  const active = sortBy === sortKey
  return (
    <th
      className={[
        'text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base',
        extraClass ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <button
        type='button'
        onClick={() => {
          onSort(sortKey)
        }}
        className={[
          'inline-flex items-center gap-0.5 cursor-pointer bg-transparent border-none p-0 font-semibold',
          'text-text-base text-[0.9rem] hover:text-accent',
        ].join(' ')}
      >
        {label}
        {active && <span aria-hidden='true'>{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>}
      </button>
    </th>
  )
}
