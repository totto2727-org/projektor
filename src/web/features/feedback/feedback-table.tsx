import { Array } from 'effect'
import type { JSX } from 'react'

import { FeedbackContext } from './feedback-context.tsx'
import type { Feedback } from './feedback-list.tsx'
import { FeedbackRowActions } from './feedback-row-actions.tsx'
import { formatDate, ratingDisplay } from './feedback-row-display.ts'

const TD = 'px-3 py-2 border-b border-border align-top text-[0.875rem]'

const TH = 'text-left px-3 py-2 border-b-2 border-border font-semibold text-text-base whitespace-nowrap'

interface FeedbackTableProps {
  rows: Feedback[]
  selected: Set<string>
  expanded: Set<string>
  onToggleSelectAll: () => void
  onToggleRow: (id: string) => void
  onToggleExpanded: (id: string) => void
  onMarkReviewed: (id: string) => void
  onConvert: (id: string) => void
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FeedbackTable = function FeedbackTable({
  rows,
  selected,
  expanded,
  onToggleSelectAll,
  onToggleRow,
  onToggleExpanded,
  onMarkReviewed,
  onConvert,
}: FeedbackTableProps): JSX.Element {
  return (
    <div className='overflow-x-auto max-sm:hidden'>
      <table className='w-full border-collapse text-[0.9rem]'>
        <thead>
          <tr>
            <th className={TH}>
              <input
                type='checkbox'
                aria-label='select all'
                checked={Array.isArrayNonEmpty(rows) && selected.size === rows.length}
                onChange={onToggleSelectAll}
              />
            </th>
            <th className={TH}>Rating</th>
            <th className={TH}>Feedback</th>
            <th className={TH}>Status</th>
            <th className={TH}>Received</th>
            <th className={TH} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className={TD}>
                <input
                  type='checkbox'
                  aria-label={`select row ${row.id}`}
                  checked={selected.has(row.id)}
                  onChange={() => {
                    onToggleRow(row.id)
                  }}
                />
              </td>
              <td className={TD}>{ratingDisplay(row.rating, row.ratingScale)}</td>
              <td className={`${TD} text-text-base`}>
                <div>{row.body ?? '—'}</div>
                {row.submitterLabel && <div className='text-[0.75rem] text-text-muted mt-1'>{row.submitterLabel}</div>}
                <FeedbackContext row={row} expanded={expanded.has(row.id)} onToggle={() => onToggleExpanded(row.id)} />
              </td>
              <td className={`${TD} text-text-muted`}>{row.status}</td>
              <td className={`${TD} text-text-muted`}>{formatDate(row.createdAt)}</td>
              <td className={`${TD} whitespace-nowrap`}>
                <FeedbackRowActions row={row} onMarkReviewed={onMarkReviewed} onConvert={onConvert} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
