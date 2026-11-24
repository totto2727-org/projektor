'use client'
import { Array } from 'effect'
import type { JSX, Dispatch, RefObject, SetStateAction } from 'react'

import { Button } from '@/components/ui/button.tsx'
import Select from '@/components/ui/select.tsx'
import type { Issue, SortKey, TaskStatus } from '@/features/issues/components/board-utils.ts'
import type { IssuesRoute } from '@/features/issues/views/issues-page.tsx'

import type { DateField } from './filters-popover.tsx'
import FiltersPopover from './filters-popover.tsx'
import SavedViewsControl from './saved-views-control.tsx'
import SearchBox from './search-box.tsx'
import type { useSavedViews } from './use-saved-views.ts'

interface FilterSelectsProps {
  uniqueProjects: { key: string; name: string }[]
  filterProject: string
  setFilterProject: (v: string) => void
  setFilterSprintId: Dispatch<SetStateAction<string>>
  sprints: { id: string; name: string; status: string }[]
  filterSprintId: string
  uniqueTypes: [string, string][]
  filterType: string
  setFilterType: (v: string) => void
  epics: Issue[]
  filterEpicId: string
  setFilterEpicId: (v: string) => void
  hideEpics: boolean
  setHideEpics: (v: boolean) => void
}

const FilterSelects = function FilterSelects({
  uniqueProjects,
  filterProject,
  setFilterProject,
  setFilterSprintId,
  sprints,
  filterSprintId,
  uniqueTypes,
  filterType,
  setFilterType,
  epics,
  filterEpicId,
  setFilterEpicId,
  hideEpics,
  setHideEpics,
}: FilterSelectsProps): JSX.Element {
  return (
    <>
      {Array.isArrayNonEmpty(uniqueProjects) && (
        <Select
          ariaLabel='Filter by project'
          value={filterProject}
          onChange={(v) => {
            setFilterProject(v)
            setFilterSprintId('')
          }}
          options={[
            { value: '', label: 'All projects' },
            ...uniqueProjects.map((project) => ({ value: project.key, label: project.name })),
          ]}
        />
      )}

      {Array.isArrayNonEmpty(sprints) && (
        <Select
          ariaLabel='Filter by sprint'
          value={filterSprintId}
          onChange={setFilterSprintId}
          options={[
            { value: '', label: 'All sprints' },
            ...sprints.map((sprint) => ({
              value: sprint.id,
              label: `${sprint.status === 'active' ? '● ' : ''}${sprint.name}`,
            })),
          ]}
        />
      )}

      {Array.isArrayNonEmpty(uniqueTypes) && (
        <Select
          ariaLabel='Filter by type'
          value={filterType}
          onChange={setFilterType}
          options={[
            { value: '', label: 'All types' },
            ...uniqueTypes.map(([key, name]) => ({ value: key, label: name })),
          ]}
        />
      )}

      {Array.isArrayNonEmpty(epics) && (
        <Select
          ariaLabel='Filter by epic'
          value={filterEpicId}
          onChange={setFilterEpicId}
          options={[
            { value: '', label: 'All epics' },
            { value: 'none', label: 'No epic' },
            ...epics.map((epic) => ({
              value: epic.id,
              label: `${epic.project_key ? `${epic.project_key}-${epic.number}` : `#${epic.number}`} ${epic.title}`,
            })),
          ]}
        />
      )}

      {Array.isArrayNonEmpty(epics) && (
        <label className='flex items-center gap-1.5 text-[0.8rem] text-text-muted whitespace-nowrap cursor-pointer select-none'>
          <input
            type='checkbox'
            checked={hideEpics}
            onChange={(event) => {
              setHideEpics(event.target.checked)
            }}
          />
          Hide epics
        </label>
      )}
    </>
  )
}

const SortControls = function SortControls({
  sortBy,
  setSortBy,
  sortDir,
  setSortDir,
}: {
  sortBy: SortKey
  setSortBy: (v: SortKey) => void
  sortDir: 'asc' | 'desc'
  setSortDir: Dispatch<SetStateAction<'asc' | 'desc'>>
}): JSX.Element {
  return (
    <span className='ml-auto max-sm:ml-0 max-sm:w-full flex gap-2 items-center flex-wrap'>
      <span className='text-sm text-text-muted'>Sort:</span>
      <Select
        ariaLabel='Sort by'
        value={sortBy}
        onChange={(v) => setSortBy(v as SortKey)}
        options={[
          { value: 'created_at', label: 'Created' },
          { value: 'updated', label: 'Updated' },
          { value: 'priority', label: 'Priority' },
          { value: 'status', label: 'Status' },
          { value: 'title', label: 'Title' },
          { value: 'assignee', label: 'Assignee' },
          { value: 'number', label: 'Number' },
        ]}
      />
      <Button
        type='button'
        variant='outline'
        size='sm'
        aria-label={sortDir === 'asc' ? 'Sort descending' : 'Sort ascending'}
        onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
      >
        {sortDir === 'asc' ? '↑' : '↓'}
      </Button>
    </span>
  )
}

interface ToolbarProps extends FilterSelectsProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  isSearchActive: boolean
  searchInputRef: RefObject<HTMLInputElement | null>
  searchRoute: IssuesRoute

  derivedStatuses: Readonly<TaskStatus[]>
  filterStatuses: string[]
  setFilterStatuses: Dispatch<SetStateAction<string[]>>
  filterPriorities: string[]
  setFilterPriorities: Dispatch<SetStateAction<string[]>>
  filterDateField: DateField
  setFilterDateField: Dispatch<SetStateAction<DateField>>
  filterDateFrom: string
  setFilterDateFrom: Dispatch<SetStateAction<string>>
  filterDateTo: string
  setFilterDateTo: Dispatch<SetStateAction<string>>

  saved: ReturnType<typeof useSavedViews>

  sortBy: SortKey
  setSortBy: (v: SortKey) => void
  sortDir: 'asc' | 'desc'
  setSortDir: Dispatch<SetStateAction<'asc' | 'desc'>>
}

export default function Toolbar(props: ToolbarProps): JSX.Element {
  const {
    searchQuery,
    setSearchQuery,
    isSearchActive,
    searchInputRef,
    derivedStatuses,
    filterStatuses,
    setFilterStatuses,
    filterPriorities,
    setFilterPriorities,
    filterDateField,
    setFilterDateField,
    filterDateFrom,
    setFilterDateFrom,
    filterDateTo,
    setFilterDateTo,
    saved,
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
  } = props

  return (
    <div
      className={[
        'flex gap-2 flex-wrap items-center mb-4 p-3 bg-surface rounded-lg border border-border',
        'shadow-elevation-sm',
      ].join(' ')}
    >
      <SearchBox
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        isSearchActive={isSearchActive}
        searchInputRef={searchInputRef}
        route={props.searchRoute}
      />

      <FiltersPopover
        derivedStatuses={derivedStatuses}
        filterStatuses={filterStatuses}
        setFilterStatuses={setFilterStatuses}
        filterPriorities={filterPriorities}
        setFilterPriorities={setFilterPriorities}
        filterDateField={filterDateField}
        setFilterDateField={setFilterDateField}
        filterDateFrom={filterDateFrom}
        setFilterDateFrom={setFilterDateFrom}
        filterDateTo={filterDateTo}
        setFilterDateTo={setFilterDateTo}
        isSearchActive={isSearchActive}
      />

      <FilterSelects {...props} />

      <SavedViewsControl saved={saved} />

      <SortControls sortBy={sortBy} setSortBy={setSortBy} sortDir={sortDir} setSortDir={setSortDir} />
    </div>
  )
}
