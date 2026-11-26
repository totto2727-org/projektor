import { String, Array, Iterable, Predicate } from 'effect'

import { canonicalUtcDayMilliseconds, LAST_SECOND_OF_DAY, MILLISECONDS_PER_SECOND } from '#contracts/time.ts'

export interface FilterQueryFilters {
  filterStatuses: string[]
  filterPriorities: string[]
  filterProject: string
  filterType: string
  filterEpicId: string
  filterSprintId: string
  hideEpics: boolean
  filterDateField: '' | 'completed' | 'updated'
  filterDateFrom: string
  filterDateTo: string
}

interface KeyedById {
  key: string
  id: string
}

// Date filters use UTC calendar days consistently during SSR and in the browser.
const dateInputToTs = function dateInputToTs(dateStr: string, endOfDay: boolean): number {
  const startOfDay = canonicalUtcDayMilliseconds(dateStr) / MILLISECONDS_PER_SECOND
  return endOfDay ? startOfDay + LAST_SECOND_OF_DAY : startOfDay
}

const applyEpicParams = function applyEpicParams(
  qs: URLSearchParams,
  { filterEpicId, hideEpics }: Pick<FilterQueryFilters, 'filterEpicId' | 'hideEpics'>,
  taskTypes: Readonly<KeyedById[]>,
): void {
  if (filterEpicId && filterEpicId !== 'none') {
    qs.set('parentId', filterEpicId)
  }
  if (filterEpicId === 'none') {
    qs.set('noParent', 'true')
  }
  /*
   * Epic exclusion runs server-side (PROJ-211): both "Hide epics" and the
   * "No epic" option drop epic-typed issues via excludeTypeIds, so the result
   * is correct across pagination rather than only on the loaded page.
   */
  const epicTypeId = taskTypes.find((taskType) => taskType.key === 'epic')?.id
  if (Predicate.isNotNullish(epicTypeId) && String.isNonEmpty(epicTypeId) && (hideEpics || filterEpicId === 'none')) {
    qs.set('excludeTypeIds', epicTypeId)
  }
}

/*
 * Date-range filter (PROJ-212) runs server-side against the chosen timestamp
 * column; bounds are inclusive (from = start of day, to = end).
 */
export const applyDateRangeParams = function applyDateRangeParams(
  qs: URLSearchParams,
  {
    filterDateField,
    filterDateFrom,
    filterDateTo,
  }: Pick<FilterQueryFilters, 'filterDateField' | 'filterDateFrom' | 'filterDateTo'>,
): void {
  if (!filterDateField || (!filterDateFrom && !filterDateTo)) {
    return
  }
  const afterKey = filterDateField === 'completed' ? 'completedAfter' : 'updatedAfter'
  const beforeKey = filterDateField === 'completed' ? 'completedBefore' : 'updatedBefore'
  if (filterDateFrom) {
    qs.set(afterKey, globalThis.String(dateInputToTs(filterDateFrom, false)))
  }
  if (filterDateTo) {
    qs.set(beforeKey, globalThis.String(dateInputToTs(filterDateTo, true)))
  }
}

const applyListFilters = function applyListFilters(
  qs: URLSearchParams,
  filterStatuses: string[],
  filterPriorities: string[],
): void {
  if (filterStatuses.length) {
    qs.set('statusIds', filterStatuses.join(','))
  }
  if (filterPriorities.length) {
    qs.set('priorities', filterPriorities.join(','))
  }
}

const applyKeyedFilter = function applyKeyedFilter(
  qs: URLSearchParams,
  options: Readonly<KeyedById[]>,
  { key, parameter }: { key: string; parameter: 'project' | 'typeId' },
): void {
  const id = key ? options.find((option) => option.key === key)?.id : undefined
  if (Predicate.isNotNullish(id) && String.isNonEmpty(id)) {
    qs.set(parameter, id)
  }
}

// Build the filter query params shared by the initial fetch and "Load more"
// (everything except limit/cursor, which the callers set).
export const buildFilterQueryParams = function buildFilterQueryParams(
  filters: FilterQueryFilters,
  projects: Readonly<KeyedById[]>,
  taskTypes: KeyedById[],
): URLSearchParams {
  const {
    filterStatuses,
    filterPriorities,
    filterProject,
    filterType,
    filterEpicId,
    filterSprintId,
    hideEpics,
    filterDateField,
    filterDateFrom,
    filterDateTo,
  } = filters
  const qs = new URLSearchParams()
  applyListFilters(qs, filterStatuses, filterPriorities)
  applyKeyedFilter(qs, projects, { key: filterProject, parameter: 'project' })
  applyKeyedFilter(qs, taskTypes, { key: filterType, parameter: 'typeId' })
  if (filterSprintId) {
    qs.set('sprintId', filterSprintId)
  }
  applyEpicParams(qs, { filterEpicId, hideEpics }, taskTypes)
  applyDateRangeParams(qs, { filterDateField, filterDateFrom, filterDateTo })
  return qs
}

export type UrlSyncFilters = Pick<
  FilterQueryFilters,
  | 'filterStatuses'
  | 'filterPriorities'
  | 'filterEpicId'
  | 'filterSprintId'
  | 'hideEpics'
  | 'filterDateField'
  | 'filterDateFrom'
  | 'filterDateTo'
>

const URL_SYNC_KEYS = [
  [
    'status',
    (filters: UrlSyncFilters) =>
      Array.isArrayNonEmpty(filters.filterStatuses) ? filters.filterStatuses.join(',') : undefined,
  ],
  [
    'priority',
    (filters: UrlSyncFilters) =>
      Array.isArrayNonEmpty(filters.filterPriorities) ? filters.filterPriorities.join(',') : undefined,
  ],
  ['epic', (filters: UrlSyncFilters) => filters.filterEpicId || undefined],
  ['sprintId', (filters: UrlSyncFilters) => filters.filterSprintId || undefined],
  ['hideEpics', (filters: UrlSyncFilters) => (filters.hideEpics ? '1' : undefined)],
  ['dateField', (filters: UrlSyncFilters) => filters.filterDateField || undefined],
  ['dateFrom', (filters: UrlSyncFilters) => filters.filterDateFrom || undefined],
  ['dateTo', (filters: UrlSyncFilters) => filters.filterDateTo || undefined],
] as const satisfies Readonly<[string, (filters: UrlSyncFilters) => string | undefined][]>

// Build canonical filter navigation while retaining unrelated scoped query parameters.
// Effront owns navigation through ordinary anchors, not a parallel history router.
export const buildFilterUrlQueryString = function buildFilterUrlQueryString(
  currentSearch: string,
  filters: UrlSyncFilters,
): string {
  const params = new URLSearchParams(currentSearch)
  Iterable.forEach(URL_SYNC_KEYS, ([key, getValue]) => {
    const value = getValue(filters)
    if (Predicate.isNotNullish(value)) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
  })
  return params.toString()
}
