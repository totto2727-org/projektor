'use client'
import { Array } from 'effect'
import { createContext, useContext, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import { unwrapResult } from '@/client/functions.ts'
import { Button } from '@/components/ui/button.tsx'
import { Select } from '@/components/ui/select.tsx'
import { updateIssue } from '@/features/issues/actions.ts'
import type { Issue, TaskStatus } from '@/features/issues/components/board-utils.ts'

const Selection = createContext<{
  selected: ReadonlySet<string>
  toggle: (id: string, checked: boolean) => void
} | null>(null)
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function IssueSelectionControl({
  issue,
}: {
  issue: Pick<Issue, 'id' | 'number' | 'project_key' | 'title'>
}): false | JSX.Element {
  const selection = useContext(Selection)
  if (!selection) {
    return false
  }
  return (
    <input
      type='checkbox'
      aria-label={`Select ${issue.project_key ?? 'issue'}-${issue.number}`}
      checked={selection.selected.has(issue.id)}
      onChange={(event) => {
        selection.toggle(issue.id, event.currentTarget.checked)
      }}
      className='mr-2 accent-accent'
    />
  )
}
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function IssueBulkProvider({
  children,
  issues,
  statuses,
  workspaceSlug,
}: {
  children: ReactNode
  issues: Readonly<Issue[]>
  statuses: Readonly<TaskStatus[]>
  workspaceSlug: string
}): JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const toggle = function toggle(id: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }
  const change = async function change(changes: { statusId: string } | { priority: string }): Promise<void> {
    const ids = [...selected]
    setBusy(true)
    setError(undefined)
    try {
      for (const id of ids) {
        unwrapResult(await updateIssue({ workspaceSlug, issueId: id, patch: changes }))
      }
      setSelected(new Set())
    } catch (currentError) {
      setError(`Bulk update failed: ${currentError instanceof Error ? currentError.message : String(currentError)}`)
    }
    setBusy(false)
  }
  const renderBulkSelectionActions = (): JSX.Element => (
    <>
      <span>{selected.size} selected</span>
      <Select
        value=''
        options={[
          { label: 'Change status', value: '' },
          ...statuses.map(({ id, name }) => ({ label: name, value: id })),
        ]}
        onChange={(value) => {
          if (value) {
            void change({ statusId: value })
          }
        }}
        disabled={busy}
        ariaLabel='Bulk status'
      />
      <Select
        value=''
        options={[
          { label: 'Change priority', value: '' },
          ...['urgent', 'high', 'medium', 'low', 'none'].map((value) => ({
            value,
            label: value,
          })),
        ]}
        onChange={(value) => {
          if (value) {
            void change({ priority: value })
          }
        }}
        disabled={busy}
        ariaLabel='Bulk priority'
      />
      <Button
        variant='outline'
        size='sm'
        onClick={() => {
          setSelected(new Set())
        }}
        disabled={busy}
      >
        Clear selection
      </Button>
    </>
  )

  return (
    <Selection.Provider value={{ selected, toggle }}>
      <div className='flex items-center gap-2 flex-wrap text-sm mb-3' role='toolbar' aria-label='Bulk issue actions'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => {
            setSelected(new Set(issues.map((issue) => issue.id)))
          }}
          disabled={busy || Array.isReadonlyArrayEmpty(issues)}
        >
          Select all loaded
        </Button>
        {selected.size > 0 && renderBulkSelectionActions()}
        {error && (
          <p role='alert' className='text-danger-text'>
            {error}
          </p>
        )}
      </div>
      {children}
    </Selection.Provider>
  )
}
