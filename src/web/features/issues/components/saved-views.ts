/*
 * Saved views (PROJ-141, hardened in PROJ-208).
 *
 * A saved view is a named combination of issue-list filters. Entity-bearing
 * preferences are kept in user/workspace/project-scoped sessionStorage, never
 * localStorage, and are applied only through explicit canonical URL navigation.
 *
 * This module is the pure, testable core: capture the current filters into a
 * view, normalise/parse stored payloads defensively (older views may be missing
 * fields), apply a view back to filter state, and compare filters for the
 * "active view" indicator. The IssueList island wires these to component state.
 */

import { Iterable, String, Predicate } from 'effect'
export interface SavedViewFilters {
  statuses: string[]
  priorities: string[]
  /** Project key (not UUID) — matches the island's filterProject state. */
  project: string
  /** Task type key (not UUID) — matches the island's filterType state. */
  type: string
  epicId: string
  sprintId: string
  hideEpics: boolean
  /** Date-range filter field: "" (off), "completed", or "updated" (PROJ-212). */
  dateField: string
  /** Inclusive range bounds as YYYY-MM-DD date-input strings ("" when unset). */
  dateFrom: string
  dateTo: string
}

export interface SavedView {
  name: string
  filters: SavedViewFilters
}

export const viewsStorageKey = function viewsStorageKey(project: string): string {
  return `issue-views-${project || 'all'}`
}

/**
 * Coerce an arbitrary (possibly legacy or partial) filters object into a
 * complete SavedViewFilters. Missing fields fall back to the empty default, so
 * a view saved before a new filter existed (e.g. hideEpics) still applies
 * cleanly instead of writing `undefined` into filter state.
 *
 * @param {Partial<SavedViewFilters> | null | undefined} raw The stored filter fields, which can be missing.
 * @returns {SavedViewFilters} The complete filters with defaults for missing fields.
 */
const normalizeFilters = function normalizeFilters(
  raw: Partial<SavedViewFilters> | null | undefined,
): SavedViewFilters {
  const filters = raw ?? {}
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => Predicate.isString(item)) : []
  const str = (value: unknown): string => (Predicate.isString(value) ? value : '')
  return {
    statuses: strings(filters.statuses),
    priorities: strings(filters.priorities),
    project: str(filters.project),
    type: str(filters.type),
    epicId: str(filters.epicId),
    sprintId: str(filters.sprintId),
    hideEpics: filters.hideEpics === true,
    dateField: str(filters.dateField),
    dateFrom: str(filters.dateFrom),
    dateTo: str(filters.dateTo),
  }
}

export const captureView = function captureView(name: string, filters: SavedViewFilters): SavedView {
  return { name, filters: normalizeFilters(filters) }
}

/**
 * Parse the sessionStorage payload, dropping anything malformed or unnamed.
 *
 * @param {string | null} raw The saved-views payload from sessionStorage.
 * @returns {SavedView[]} The valid named views with normalized filters.
 */
export const parseSavedViews = function parseSavedViews(raw: string | null): SavedView[] {
  if (Predicate.isNullish(raw) || String.isEmpty(raw)) {
    return []
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) {
    return []
  }
  const out: SavedView[] = []
  Iterable.forEach(data, (candidate) => {
    if (!Predicate.isObjectOrArray(candidate)) {
      return
    }
    const { name } = candidate as { name?: unknown }
    if (!Predicate.isString(name) || String.isEmpty(name)) {
      return
    }
    out.push({
      name,
      filters: normalizeFilters((candidate as { filters?: Partial<SavedViewFilters> }).filters),
    })
  })
  return out
}

/**
 * Insert or replace a view by name (names are unique within a bucket).
 *
 * @param {Readonly<SavedView[]>} views The existing views in the storage bucket.
 * @param {SavedView} view The view to save.
 * @returns {SavedView[]} A new list with the saved view at the end.
 */
export const upsertView = function upsertView(views: Readonly<SavedView[]>, view: SavedView): SavedView[] {
  return [...views.filter((selectedView) => selectedView.name !== view.name), view]
}

export const removeView = function removeView(views: Readonly<SavedView[]>, name: string): SavedView[] {
  return views.filter((view) => view.name !== name)
}

/**
 * Order-insensitive equality for the two list-valued filters.
 *
 * @param {Readonly<string[]>} left The first list of selected filter values.
 * @param {Readonly<string[]>} right The second list of selected filter values.
 * @returns {boolean} Whether the two lists contain the same values and multiplicities.
 */
const sameSet = function sameSet(left: Readonly<string[]>, right: Readonly<string[]>): boolean {
  return JSON.stringify([...left].toSorted()) === JSON.stringify([...right].toSorted())
}

/**
 * True when two filter sets are equivalent (drives the active-view indicator).
 *
 * @param {SavedViewFilters} filters The current issue-list filters.
 * @param {SavedViewFilters} selectedFilters The filters stored in the selected view.
 * @returns {boolean} Whether both sets of filters produce the same selection.
 */
export const filtersMatch = function filtersMatch(
  filters: SavedViewFilters,
  selectedFilters: SavedViewFilters,
): boolean {
  return (
    sameSet(filters.statuses, selectedFilters.statuses) &&
    sameSet(filters.priorities, selectedFilters.priorities) &&
    filters.project === selectedFilters.project &&
    filters.type === selectedFilters.type &&
    filters.epicId === selectedFilters.epicId &&
    filters.sprintId === selectedFilters.sprintId &&
    filters.hideEpics === selectedFilters.hideEpics &&
    filters.dateField === selectedFilters.dateField &&
    filters.dateFrom === selectedFilters.dateFrom &&
    filters.dateTo === selectedFilters.dateTo
  )
}
