'use client'

import type { JSX } from 'react'

import { Select } from '@/components/ui/select.tsx'
import type { SelectOption } from '@/components/ui/select.tsx'

const WIKI_STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'current', label: 'Current' },
  { value: 'stale', label: 'Stale' },
  { value: 'deprecated', label: 'Deprecated' },
]

/*
 * PROJ-488: type/status dropdowns + a comma-separated tags text filter, shared between
 * the sidebar's filtered browse view and (via useWikiSearch) text search.
 */
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function WikiFilterBar({
  filterType,
  onFilterTypeChange,
  typeOptions,
  filterStatus,
  onFilterStatusChange,
  filterTags,
  onFilterTagsChange,
}: {
  filterType: string
  onFilterTypeChange: (type: string) => void
  typeOptions: SelectOption[]
  filterStatus: string
  onFilterStatusChange: (selectedStatus: string) => void
  filterTags: string
  onFilterTagsChange: (tags: string) => void
}): JSX.Element {
  return (
    <div className='mb-3 flex flex-col gap-1.5'>
      <input type='hidden' name='type' value={filterType} />
      <input type='hidden' name='status' value={filterStatus} />
      <Select
        value={filterType}
        options={typeOptions}
        ariaLabel='Filter wiki pages by type'
        onChange={onFilterTypeChange}
      />
      <Select
        value={filterStatus}
        options={WIKI_STATUS_FILTER_OPTIONS}
        ariaLabel='Filter wiki pages by status'
        onChange={onFilterStatusChange}
      />
      <input
        type='text'
        name='tags'
        maxLength={2549}
        value={filterTags}
        onChange={(event) => {
          onFilterTagsChange(event.target.value)
        }}
        placeholder='Filter by tags (comma-separated)…'
        className='w-full px-3 py-[0.375rem] border border-border rounded text-sm bg-bg text-text-base box-border'
        aria-label='Filter wiki pages by tags'
      />
    </div>
  )
}
