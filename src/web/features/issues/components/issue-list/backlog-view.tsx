'use client'
import { Array } from 'effect'
import { useState } from 'react'
import type { DragEvent, JSX } from 'react'

import { getBacklogIssues } from '@/features/issues/components/board-utils.ts'
import type { Issue } from '@/features/issues/components/board-utils.ts'

import { BacklogRow } from './backlog-row.tsx'
import { BacklogTableHead } from './backlog-table-head.tsx'
import { MobileCards } from './list-mobile-cards.tsx'
import type { IssueListTableProps } from './types-view.ts'

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
}: IssueListTableProps): JSX.Element {
  const [backlogOrder, setBacklogOrder] = useState<string[]>([])
  const [backlogDragId, setBacklogDragId] = useState<string>()
  const [backlogDragOverId, setBacklogDragOverId] = useState<string>()

  const backlogIssues = getBacklogIssues(issues)
  if (Array.isArrayEmpty(backlogIssues)) {
    return <p className='text-text-base'>No backlog issues match the current filters.</p>
  }
  const orderedIssues = applyBacklogOrder(backlogIssues, backlogOrder)

  const onBacklogDragStart = function onBacklogDragStart(selectedEvent: DragEvent<HTMLElement>, issueId: string): void {
    selectedEvent.dataTransfer?.setData('text/plain', issueId)
    setBacklogDragId(issueId)
  }

  const onBacklogDragOver = function onBacklogDragOver(event: DragEvent<HTMLElement>, issueId: string): void {
    event.preventDefault()
    setBacklogDragOverId(issueId)
  }

  const onBacklogDrop = function onBacklogDrop(event: DragEvent<HTMLElement>, targetId: string): void {
    event.preventDefault()
    const draggedId = event.dataTransfer?.getData('text/plain')
    if (!draggedId || draggedId === targetId) {
      setBacklogDragId(undefined)
      setBacklogDragOverId(undefined)
      return
    }
    const ids = orderedIssues.map((issue) => issue.id)
    const without = ids.filter((id) => id !== draggedId)
    const targetIdx = without.indexOf(targetId)
    without.splice(targetIdx, 0, draggedId)
    setBacklogOrder(without)
    setBacklogDragId(undefined)
    setBacklogDragOverId(undefined)
  }

  const onBacklogDragEnd = function onBacklogDragEnd(): void {
    setBacklogDragId(undefined)
    setBacklogDragOverId(undefined)
  }

  const renderBacklogTable = (): JSX.Element => (
    <table className='w-full border-collapse text-[0.9rem]'>
      <BacklogTableHead sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
      <tbody
        onDragLeave={(event: DragEvent<HTMLElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setBacklogDragOverId(undefined)
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
  )

  return (
    <>
      <div className='overflow-x-auto max-sm:hidden'>{renderBacklogTable()}</div>

      <MobileCards issues={orderedIssues} updatingPriorityId={updatingPriorityId} changePriority={changePriority} />
    </>
  )
}
