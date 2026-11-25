'use client'
import type { JSX } from 'react'

import type { SortKey } from '@/features/issues/components/board-utils.ts'

import { SortableHeader } from './sortable-header.tsx'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const BacklogTableHead = function BacklogTableHead({
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
