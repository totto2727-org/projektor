import type { JSX } from 'react'

import { FeedbackContext } from './feedback-context.tsx'
import type { Feedback } from './feedback-list.tsx'
import { FeedbackRowActions } from './feedback-row-actions.tsx'
import { formatDate, ratingDisplay } from './feedback-row-display.ts'

interface FeedbackMobileCardsProps {
  rows: Feedback[]
  selected: Set<string>
  expanded: Set<string>
  onToggleRow: (id: string) => void
  onToggleExpanded: (id: string) => void
  onMarkReviewed: (id: string) => void
  onConvert: (id: string) => void
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FeedbackMobileCards = function FeedbackMobileCards({
  rows,
  selected,
  expanded,
  onToggleRow,
  onToggleExpanded,
  onMarkReviewed,
  onConvert,
}: FeedbackMobileCardsProps): JSX.Element {
  return (
    <div className='hidden max-sm:flex max-sm:flex-col max-sm:gap-3'>
      {rows.map((row) => (
        <div key={row.id} className='py-3 px-4 border border-border rounded-md bg-surface'>
          <div className='flex items-start gap-2 mb-2'>
            <input
              type='checkbox'
              aria-label={`select row ${row.id}`}
              checked={selected.has(row.id)}
              onChange={() => {
                onToggleRow(row.id)
              }}
              className='mt-1'
            />
            <div className='flex-1'>
              <div className='flex justify-between items-center gap-2 mb-1'>
                <span className='text-[0.9rem]'>{ratingDisplay(row.rating, row.ratingScale)}</span>
                <span className='text-[0.75rem] text-text-muted'>{formatDate(row.createdAt)}</span>
              </div>
              <div className='text-[0.875rem] text-text-base'>{row.body ?? '—'}</div>
              {row.submitterLabel && <div className='text-[0.75rem] text-text-muted mt-1'>{row.submitterLabel}</div>}
              <FeedbackContext row={row} expanded={expanded.has(row.id)} onToggle={() => onToggleExpanded(row.id)} />
              <div className='text-[0.75rem] text-text-muted mt-1'>{row.status}</div>
            </div>
          </div>
          <FeedbackRowActions row={row} onMarkReviewed={onMarkReviewed} onConvert={onConvert} />
        </div>
      ))}
    </div>
  )
}
