'use client'

import { useCallback } from 'react'
import type { ChangeEvent, JSX } from 'react'

import { Select } from '@/components/ui/select.tsx'
import type { SelectOption } from '@/components/ui/select.tsx'

const WIKI_STATUS_FILTER_OPTIONS: SelectOption[] = [
  { label: 'All statuses', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Current', value: 'current' },
  { label: 'Stale', value: 'stale' },
  { label: 'Deprecated', value: 'deprecated' },
]

interface WikiFilterBarProps {
  filterType: string
  onFilterTypeChange: (type: string) => void
  typeOptions: SelectOption[]
  filterStatus: string
  onFilterStatusChange: (selectedStatus: string) => void
  filterTags: string
  onFilterTagsChange: (tags: string) => void
}

/*
 * PROJ-488: type/status dropdowns + a comma-separated tags text filter, shared between
 * the sidebar's filtered browse view and (via useWikiSearch) text search.
 */
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function WikiFilterBar(props: WikiFilterBarProps): JSX.Element {
  const {
    filterType,
    onFilterTypeChange,
    typeOptions,
    filterStatus,
    onFilterStatusChange,
    filterTags,
    onFilterTagsChange,
  } = props
  const handleTagChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      onFilterTagsChange(event.target.value)
    },
    [onFilterTagsChange],
  )
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
        onChange={handleTagChange}
        placeholder='Filter by tags (comma-separated)…'
        className='w-full px-3 py-[0.375rem] border border-border rounded text-sm bg-bg text-text-base box-border'
        aria-label='Filter wiki pages by tags'
      />
    </div>
  )
}
