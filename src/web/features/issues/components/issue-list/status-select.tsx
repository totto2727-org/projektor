'use client'
import { Array } from 'effect'
import type { JSX } from 'react'

import { Select } from '@/components/ui/select.tsx'
import { categoryColor } from '@/features/issues/components/board-utils.ts'
import type { Issue, TaskStatus } from '@/features/issues/components/board-utils.ts'
import { formatIssueRef } from '@/features/issues/lib/issue-ref.ts'

import { statusBadge } from './issue-render-helpers.tsx'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
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
