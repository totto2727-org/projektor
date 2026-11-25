'use client'

import { useForm, useStore } from '@tanstack/react-form'
import { String, Array, Predicate, Schema } from 'effect'
import { useOptimistic, useState, useTransition } from 'react'
import type { JSX, Dispatch, SetStateAction } from 'react'

import { Button } from '@/components/ui/button.tsx'
import { Select } from '@/components/ui/select.tsx'
import { navigateFeature } from '@/features/wiki/navigation.ts'

import { useFeedbackActions } from './feedback-list-actions.ts'
import type { FeedbackStatusUpdate } from './feedback-list-actions.ts'
import { FeedbackMobileCards } from './feedback-mobile-cards.tsx'
import { FeedbackTable } from './feedback-table.tsx'
import type { FeedbackTableProps } from './feedback-table.tsx'

export interface Feedback {
  id: string
  sourceId: string
  sourceName: string | null
  rating: number | null
  ratingScale: string | null
  body: string | null
  submitterLabel: string | null
  sourceUrl: string | null
  appVersion: string | null
  status: string
  linkedIssueId: string | null
  createdAt: number
}

interface Props {
  workspaceSlug?: string
  projectId: string
  sourceId: string
  initialRows: Readonly<Feedback[]>
  initialStatus?: string
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'actioned', label: 'Actioned' },
]

type FeedbackSelection = Readonly<
  [selected: Set<string>, toggle: (id: string) => void, setSelected: Dispatch<SetStateAction<Set<string>>>]
>

const useToggleSet = function useToggleSet(): FeedbackSelection {
  const [set, setSet] = useState<Set<string>>(new Set())
  const toggle = function toggle(id: string): void {
    setSet((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }
  return [set, toggle, setSet] as const
}

const MAX_SELECTED_FEEDBACK = 500
const EMPTY_FEEDBACK_SELECTION = 0

const useSelectedFeedback = function useSelectedFeedback(): FeedbackSelection {
  const ids = Schema.mutable(Schema.Array(Schema.String)).check(Schema.isMaxLength(MAX_SELECTED_FEEDBACK))
  const selectionSchema = Schema.Struct({ ids })
  const validator = Schema.toStandardSchemaV1(selectionSchema)
  const form = useForm({
    defaultValues: { ids: [] as string[] },
    validators: { onChange: validator },
  })
  const selectedIds = useStore(form.store, (state) => state.values.ids)
  const selected = new Set(selectedIds)
  const setSelected: Dispatch<SetStateAction<Set<string>>> = (value) => {
    const current = new Set(form.getFieldValue('ids'))
    form.setFieldValue('ids', [...(Predicate.isFunction(value) ? value(current) : value)])
  }
  const toggle = function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }
  return [selected, toggle, setSelected] as const
}

interface StatusFilterInputs {
  projectId: string
  setSelected: (selected: Set<string>) => void
  sourceId: string
  status: string
  workspaceSlug: string | undefined
}

const renderStatusFilter = function renderStatusFilter({
  projectId,
  setSelected,
  sourceId,
  status,
  workspaceSlug,
}: StatusFilterInputs): JSX.Element {
  return (
    <div className='flex gap-4 items-end mb-4'>
      <div className='flex flex-col gap-1'>
        <span className='text-[0.8rem] font-semibold text-text-muted'>Status</span>
        <Select
          ariaLabel='Status'
          value={status}
          onChange={(value) => {
            setSelected(new Set())
            const params = new URLSearchParams({ projectId, tab: 'items' })
            if (Predicate.isNotNullish(workspaceSlug) && String.isNonEmpty(workspaceSlug)) {
              params.set('workspace', workspaceSlug)
            }
            if (value) {
              params.set('status', value)
            }
            navigateFeature(`/feedback/${encodeURIComponent(sourceId)}?${params}`)
          }}
          options={STATUS_OPTIONS}
        />
      </div>
    </div>
  )
}

const renderBulkFeedbackControls = function renderBulkFeedbackControls(
  selected: Set<string>,
  bulkMarkReviewed: (selected: Set<string>) => void,
  bulkConvertToIssue: (selected: Set<string>) => void,
): false | JSX.Element {
  return (
    selected.size > EMPTY_FEEDBACK_SELECTION && (
      <div className='flex gap-2 items-center mb-3 p-2 bg-surface border border-border rounded'>
        <span className='text-[0.85rem] text-text-muted'>{selected.size} selected</span>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => {
            bulkMarkReviewed(selected)
          }}
        >
          Mark all reviewed
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => {
            bulkConvertToIssue(selected)
          }}
        >
          Convert all to issue
        </Button>
      </div>
    )
  )
}

const renderFeedbackRows = function renderFeedbackRows({
  expanded,
  onConvert: convert,
  onMarkReviewed: markReviewed,
  onToggleExpanded: toggleExpanded,
  onToggleRow: toggleRow,
  onToggleSelectAll: toggleSelectAll,
  rows,
  selected,
}: FeedbackTableProps): JSX.Element {
  return Array.isArrayEmpty(rows) ? (
    <div className='p-6 text-center text-text-muted bg-surface rounded-lg border border-border'>No feedback yet.</div>
  ) : (
    <>
      <FeedbackTable
        rows={rows}
        selected={selected}
        expanded={expanded}
        onToggleSelectAll={toggleSelectAll}
        onToggleRow={toggleRow}
        onToggleExpanded={toggleExpanded}
        onMarkReviewed={markReviewed}
        onConvert={convert}
      />
      <FeedbackMobileCards
        rows={rows}
        selected={selected}
        expanded={expanded}
        onToggleRow={toggleRow}
        onToggleExpanded={toggleExpanded}
        onMarkReviewed={markReviewed}
        onConvert={convert}
      />
    </>
  )
}

const renderFeedbackError = function renderFeedbackError(error: string | null): string | null | JSX.Element {
  if (Predicate.isNullish(error) || String.isEmpty(error)) {
    return error
  }
  return (
    <p role='alert' className='text-danger-text'>
      {error}
    </p>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function FeedbackList({
  workspaceSlug,
  projectId,
  sourceId,
  initialRows,
  initialStatus = '',
}: Props): JSX.Element {
  const status = initialStatus
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [optimisticRows, addOptimistic] = useOptimistic(initialRows, (current, change: FeedbackStatusUpdate) => {
    const ids = new Set(change.ids)
    return current.map((row) => (ids.has(row.id) ? { ...row, status: change.status } : row))
  })
  const rows = optimisticRows.filter((row) => !status || row.status === status)
  const [selected, toggleRow, setSelected] = useSelectedFeedback()
  const [expanded, toggleExpanded] = useToggleSet()
  const { convert, markReviewed, bulkMarkReviewed, bulkConvertToIssue } = useFeedbackActions({
    addOptimistic,
    projectId,
    setError,
    setSelected,
    startTransition,
    workspaceSlug,
  })

  const toggleSelectAll = function toggleSelectAll(): void {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((row) => row.id))))
  }

  return (
    <section>
      {renderStatusFilter({ projectId, setSelected, sourceId, status, workspaceSlug })}
      {renderFeedbackError(error)}
      {renderBulkFeedbackControls(selected, bulkMarkReviewed, bulkConvertToIssue)}
      {pending && <p aria-live='polite'>Updating feedback…</p>}
      {renderFeedbackRows({
        expanded,
        onConvert: convert,
        onMarkReviewed: markReviewed,
        onToggleExpanded: toggleExpanded,
        onToggleRow: toggleRow,
        onToggleSelectAll: toggleSelectAll,
        rows,
        selected,
      })}
    </section>
  )
}
