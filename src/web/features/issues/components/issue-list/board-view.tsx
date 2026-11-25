'use client'
import { String, Predicate, Array } from 'effect'
import { useState } from 'react'
import type { JSX } from 'react'

import {
  BOARD_COLUMNS,
  categoryColor,
  getBoardColumnIssues,
  getFirstStatusForCategory,
  ISSUE_BOARD_WIDE_MIN_WIDTH,
} from '@/features/issues/components/board-utils.ts'
import type { Issue, TaskStatus } from '@/features/issues/components/board-utils.ts'

import { BoardCard } from './board-card.tsx'

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function BoardView({
  issues,
  statuses,
  changeStatus,
}: {
  issues: Issue[]
  statuses: TaskStatus[]
  changeStatus: (issueId: string, statusId: string) => void
}): JSX.Element {
  const [dragIssueId, setDragIssueId] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  return (
    <div className='flex gap-4 overflow-x-auto items-start max-sm:flex-col'>
      {BOARD_COLUMNS.map((col) => {
        const colIssues = getBoardColumnIssues(issues, col.category)
        const isOver = dragOverColumn === col.category
        const dropStatusId = getFirstStatusForCategory(statuses, col.category)?.id

        return (
          <section
            key={col.category}
            aria-label={`${col.label} column`}
            className='shrink-0 w-[270px] max-sm:w-full'
            onDragOver={(event: import('react').DragEvent<HTMLElement>) => {
              event.preventDefault()
              setDragOverColumn(col.category)
            }}
            onDragLeave={(event: import('react').DragEvent<HTMLElement>) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDragOverColumn(null)
              }
            }}
            onDrop={(event: import('react').DragEvent<HTMLElement>) => {
              event.preventDefault()
              const issueId = event.dataTransfer?.getData('text/plain')
              if (
                issueId &&
                Predicate.isNotNullish(dropStatusId) &&
                String.isNonEmpty(dropStatusId) &&
                window.innerWidth >= ISSUE_BOARD_WIDE_MIN_WIDTH
              ) {
                changeStatus(issueId, dropStatusId)
              }
              setDragOverColumn(null)
            }}
          >
            <div className='px-3 py-2 bg-surface rounded-t-md border border-b-0 border-border flex justify-between items-center'>
              <span className='font-semibold text-sm' style={{ color: categoryColor(col.category) }}>
                {col.label}
              </span>
              <span
                className={[
                  'text-[0.7rem] text-text-muted bg-bg rounded-full px-[0.45rem] py-[0.1rem]',
                  'font-semibold border border-border',
                ].join(' ')}
              >
                {colIssues.length}
              </span>
            </div>

            <div
              className={[
                'rounded-b-md min-h-24 max-h-[62vh] overflow-y-auto p-2 flex flex-col gap-2',
                'transition-[border-color,background] duration-100',
              ].join(' ')}
              style={{
                border: `1px solid ${isOver ? 'var(--accent)' : 'var(--border)'}`,
                background: isOver ? 'var(--dropzone-bg)' : 'var(--bg)',
              }}
            >
              {Array.isArrayEmpty(colIssues) ? (
                <p className='text-[0.8rem] text-text-muted text-center py-4 m-0'>No issues</p>
              ) : (
                colIssues.map((issue) => (
                  <BoardCard
                    key={issue.id}
                    issue={issue}
                    statuses={statuses}
                    dragIssueId={dragIssueId}
                    setDragIssueId={setDragIssueId}
                    changeStatus={changeStatus}
                  />
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
