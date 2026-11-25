'use client'
import { Array } from 'effect'
import { useState } from 'react'
import type { JSX } from 'react'

import { getBacklogIssues } from '@/features/issues/components/board-utils.ts'
import type { Issue, SortKey, TaskStatus } from '@/features/issues/components/board-utils.ts'
import { ReviewTargetsSummary } from '@/features/issues/components/review-targets-summary.tsx'
import { formatIssueRef } from '@/features/issues/lib/issue-ref.ts'
import { issueUrl } from '@/features/issues/utils/issue-url.ts'

import { IssueSelectionControl } from './bulk-actions.tsx'
import { getStoryPoints, spBadge, statusBadge } from './issue-render-helpers.tsx'
import { PrioritySelect } from './priority-select.tsx'
import { SortableHeader } from './sortable-header.tsx'
import { StatusSelect } from './status-select.tsx'

const applyBacklogOrder = function applyBacklogOrder(
  issues: Readonly<Issue[]>,
  backlogOrder: string[],
): Readonly<Issue[]> {
  if (Array.isArrayEmpty(backlogOrder)) {
    return issues
  }
  const inOrder = backlogOrder.flatMap((id) => {
    const issue = issues.find((selectedIssue) => selectedIssue.id === id)
    return issue ? [issue] : []
  })
  const orderedIds = new Set(backlogOrder)
  const rest = issues.filter((issue) => !orderedIds.has(issue.id))
  return [...inOrder, ...rest]
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const BacklogTableHead = function BacklogTableHead({
  sortBy,
  sortDir,
  onSort,
}: {
  sortBy: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}): JSX.Element {
  return (
    <thead>
      <tr className='bg-surface'>
        <th className='w-8 px-2 py-2 border-b-2 border-border' />
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
}

interface RowProps {
  issue: Issue
  statuses: TaskStatus[]
  updatingId: string | null
  updatingPriorityId: string | null
  changeStatus: (issueId: string, statusId: string) => void
  changePriority: (issueId: string, priority: string) => void
  isDragging: boolean
  isOver: boolean
  onDragStart: (selectedEvent: import('react').DragEvent<HTMLElement>, issueId: string) => void
  onDragOver: (selectedEvent: import('react').DragEvent<HTMLElement>, issueId: string) => void
  onDrop: (selectedEvent: import('react').DragEvent<HTMLElement>, issueId: string) => void
  onDragEnd: () => void
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const BacklogRow = function BacklogRow({
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
  return (
    <tr
      key={issue.id}
      className='border-b border-border group'
      draggable
      onDragStart={(selectedEvent: import('react').DragEvent<HTMLElement>) => {
        onDragStart(selectedEvent, issue.id)
      }}
      onDragOver={(selectedEvent: import('react').DragEvent<HTMLElement>) => {
        onDragOver(selectedEvent, issue.id)
      }}
      onDrop={(selectedEvent: import('react').DragEvent<HTMLElement>) => {
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
      <td className='px-3 py-2 align-middle whitespace-nowrap'>
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
      </td>
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

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const BacklogMobileCards = function BacklogMobileCards({
  issues,
  updatingPriorityId,
  changePriority,
}: {
  issues: Readonly<Issue[]>
  updatingPriorityId: string | null
  changePriority: (issueId: string, priority: string) => void
}): JSX.Element {
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

interface BacklogViewProps {
  issues: Issue[]
  statuses: TaskStatus[]
  updatingId: string | null
  updatingPriorityId: string | null
  changeStatus: (issueId: string, statusId: string) => void
  changePriority: (issueId: string, priority: string) => void
  sortBy: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function BacklogView({
  issues,
  statuses,
  updatingId,
  updatingPriorityId,
  changeStatus,
  changePriority,
  sortBy,
  sortDir,
  onSort,
}: BacklogViewProps): JSX.Element {
  const [backlogOrder, setBacklogOrder] = useState<string[]>([])
  const [backlogDragId, setBacklogDragId] = useState<string | null>(null)
  const [backlogDragOverId, setBacklogDragOverId] = useState<string | null>(null)

  const backlogIssues = getBacklogIssues(issues)
  if (Array.isArrayEmpty(backlogIssues)) {
    return <p className='text-text-base'>No backlog issues match the current filters.</p>
  }
  const orderedIssues = applyBacklogOrder(backlogIssues, backlogOrder)

  const onBacklogDragStart = function onBacklogDragStart(
    selectedEvent: import('react').DragEvent<HTMLElement>,
    issueId: string,
  ): void {
    selectedEvent.dataTransfer?.setData('text/plain', issueId)
    setBacklogDragId(issueId)
  }

  const onBacklogDragOver = function onBacklogDragOver(
    event: import('react').DragEvent<HTMLElement>,
    issueId: string,
  ): void {
    event.preventDefault()
    setBacklogDragOverId(issueId)
  }

  const onBacklogDrop = function onBacklogDrop(event: import('react').DragEvent<HTMLElement>, targetId: string): void {
    event.preventDefault()
    const draggedId = event.dataTransfer?.getData('text/plain')
    if (!draggedId || draggedId === targetId) {
      setBacklogDragId(null)
      setBacklogDragOverId(null)
      return
    }
    const ids = orderedIssues.map((issue) => issue.id)
    const without = ids.filter((id) => id !== draggedId)
    const targetIdx = without.indexOf(targetId)
    without.splice(targetIdx, 0, draggedId)
    setBacklogOrder(without)
    setBacklogDragId(null)
    setBacklogDragOverId(null)
  }

  const onBacklogDragEnd = function onBacklogDragEnd(): void {
    setBacklogDragId(null)
    setBacklogDragOverId(null)
  }

  return (
    <>
      <div className='overflow-x-auto max-sm:hidden'>
        <table className='w-full border-collapse text-[0.9rem]'>
          <BacklogTableHead sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <tbody
            onDragLeave={(event: import('react').DragEvent<HTMLElement>) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setBacklogDragOverId(null)
              }
            }}
          >
            {orderedIssues.map((issue) => (
              <BacklogRow
                key={issue.id}
                issue={issue}
                statuses={statuses}
                updatingId={updatingId}
                updatingPriorityId={updatingPriorityId}
                changeStatus={changeStatus}
                changePriority={changePriority}
                isDragging={backlogDragId === issue.id}
                isOver={backlogDragOverId === issue.id && backlogDragId !== issue.id}
                onDragStart={onBacklogDragStart}
                onDragOver={onBacklogDragOver}
                onDrop={onBacklogDrop}
                onDragEnd={onBacklogDragEnd}
              />
            ))}
          </tbody>
        </table>
      </div>

      <BacklogMobileCards
        issues={orderedIssues}
        updatingPriorityId={updatingPriorityId}
        changePriority={changePriority}
      />
    </>
  )
}
