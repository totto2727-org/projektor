'use client'
import { Schema } from 'effect'
import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { SortKey } from '@/features/issues/components/board-utils.ts'
import type { SavedViewFilters } from '@/features/issues/components/saved-views.ts'
import { Text, useIssueForm } from '@/features/issues/forms.ts'

import type { DateField } from './filters-popover.tsx'
import { parseDateField, parseListParam, useFilterUrlSync } from './use-filter-url-sync.ts'

interface InitialIssueFilters {
  dateField: DateField
  dateFrom: string
  dateTo: string
  epic: string
  hideEpics: boolean
  priorities: string[]
  project: string
  sprintId: string
  statuses: string[]
}

type IssueFilters = Parameters<typeof useFilterUrlSync>[0] & {
  applyFilters: (filters: SavedViewFilters) => void
  filtersBundle: SavedViewFilters
  handleHeaderClick: (key: SortKey) => void
  setFilterType: Dispatch<SetStateAction<string>>
  setSortBy: Dispatch<SetStateAction<SortKey>>
  setSortDir: Dispatch<SetStateAction<'asc' | 'desc'>>
  sortBy: SortKey
  sortDir: 'asc' | 'desc'
}

const readInitialFilters = function readInitialFilters(search: string, projectKey: string): InitialIssueFilters {
  const params = new URLSearchParams(search)
  return {
    statuses: parseListParam(params.get('status')),
    priorities: parseListParam(params.get('priority')),
    project: projectKey,
    epic: params.get('epic') ?? '',
    sprintId: params.get('sprintId') ?? '',
    hideEpics: params.get('hideEpics') === '1',
    dateField: parseDateField(params.get('dateField')),
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
  }
}

/**
 * Owns all issue-list filter/sort state, plus URL <-> state sync (PROJ-60/211/212).
 *
 * @param {string} [search] Canonical route query string used to seed the filter form.
 * @param {string} [projectKey] Selected project key from the route data.
 * @param {Readonly<Array<{ key: string; id: string }>>} [projects] Project keys and IDs used for navigation.
 * @returns {IssueFilters} Editable filters, sort state and saved-view controls.
 */
export const useIssueFilters = function useIssueFilters(
  search: string = '',
  projectKey: string = '',
  projects: Readonly<{ key: string; id: string }[]> = [],
): IssueFilters {
  // Server route DTOs seed filters deterministically for SSR and first hydration.
  // Only explicit field edits trigger canonical navigation.
  const initial = readInitialFilters(search, projectKey)
  const filterForm = useIssueForm(
    {
      filterStatuses: initial.statuses,
      filterPriorities: initial.priorities,
      filterProject: initial.project,
      filterType: new URLSearchParams(search).get('type') ?? '',
      filterEpicId: initial.epic,
      hideEpics: initial.hideEpics,
      filterDateField: initial.dateField,
      filterDateFrom: initial.dateFrom,
      filterDateTo: initial.dateTo,
      filterSprintId: initial.sprintId,
    },
    Schema.Struct({
      filterStatuses: Schema.mutable(Schema.Array(Text)),
      filterPriorities: Schema.mutable(Schema.Array(Text)),
      filterProject: Text,
      filterType: Text,
      filterEpicId: Text,
      hideEpics: Schema.Boolean,
      filterDateField: Schema.Literals(['', 'completed', 'updated']),
      filterDateFrom: Text,
      filterDateTo: Text,
      filterSprintId: Text,
    }),
  )
  const [filterStatuses, setFilterStatuses] = filterForm.field('filterStatuses')
  const [filterPriorities, setFilterPriorities] = filterForm.field('filterPriorities')
  const [filterProject, setFilterProject] = filterForm.field('filterProject')
  const [filterType, setFilterType] = filterForm.field('filterType')
  const [filterEpicId, setFilterEpicId] = filterForm.field('filterEpicId')
  const [hideEpics, setHideEpics] = filterForm.field('hideEpics')
  const [filterDateField, setFilterDateField] = filterForm.field('filterDateField')
  const [filterDateFrom, setFilterDateFrom] = filterForm.field('filterDateFrom')
  const [filterDateTo, setFilterDateTo] = filterForm.field('filterDateTo')
  const [filterSprintId, setFilterSprintId] = filterForm.field('filterSprintId')
  const [sortBy, setSortBy] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useFilterUrlSync(
    {
      filterDateField,
      filterDateFrom,
      filterDateTo,
      filterEpicId,
      filterPriorities,
      filterProject,
      filterSprintId,
      filterStatuses,
      filterType,
      hideEpics,
      setFilterDateField,
      setFilterDateFrom,
      setFilterDateTo,
      setFilterEpicId,
      setFilterPriorities,
      setFilterProject,
      setFilterSprintId,
      setFilterStatuses,
      setHideEpics,
    },
    search,
    projects,
  )

  const handleHeaderClick = function handleHeaderClick(key: SortKey): void {
    if (sortBy === key) {
      setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(key)
      setSortDir('asc')
    }
  }

  const filtersBundle: SavedViewFilters = {
    statuses: filterStatuses,
    priorities: filterPriorities,
    project: filterProject,
    type: filterType,
    epicId: filterEpicId,
    sprintId: filterSprintId,
    hideEpics,
    dateField: filterDateField,
    dateFrom: filterDateFrom,
    dateTo: filterDateTo,
  }

  const applyFilters = function applyFilters(filters: SavedViewFilters): void {
    setFilterStatuses(filters.statuses)
    setFilterPriorities(filters.priorities)
    setFilterProject(filters.project)
    setFilterType(filters.type)
    setFilterEpicId(filters.epicId)
    setFilterSprintId(filters.sprintId)
    setHideEpics(filters.hideEpics)
    setFilterDateField(parseDateField(filters.dateField))
    setFilterDateFrom(filters.dateFrom)
    setFilterDateTo(filters.dateTo)
  }

  return {
    filterStatuses,
    setFilterStatuses,
    filterPriorities,
    setFilterPriorities,
    filterProject,
    setFilterProject,
    filterType,
    setFilterType,
    filterEpicId,
    setFilterEpicId,
    hideEpics,
    setHideEpics,
    filterDateField,
    setFilterDateField,
    filterDateFrom,
    setFilterDateFrom,
    filterDateTo,
    setFilterDateTo,
    filterSprintId,
    setFilterSprintId,
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
    handleHeaderClick,
    filtersBundle,
    applyFilters,
  }
}
