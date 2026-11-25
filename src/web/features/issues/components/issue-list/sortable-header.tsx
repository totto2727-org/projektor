'use client'
import type { JSX } from 'react'

import type { SortKey } from '@/features/issues/components/board-utils.ts'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
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
