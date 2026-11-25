'use client'
import type { JSX } from 'react'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { Select } from '@/components/ui/select.tsx'
import type { Issue } from '@/features/issues/components/board-utils.ts'
import { PRIORITY_OPTIONS } from '@/features/issues/utils/issue-utils.ts'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const PrioritySelect = function PrioritySelect({
  issue,
  busy,
  onChange,
}: {
  issue: Issue
  busy: boolean
  onChange: (value: string) => void
}): JSX.Element {
  const ref = isNonEmptyText(issue.project_key) ? `${issue.project_key}-${issue.number}` : issue.number
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
