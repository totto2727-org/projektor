import { String, Array, Predicate } from 'effect'

import type { ReviewTarget } from '#contracts/review-targets.ts'

export interface TaskStatus {
  id: string
  key: string
  name: string
  category: string
  color: string | null
}

export interface CustomFieldValue {
  key: string
  label: string
  type: string
  value: string
}

export interface ProjectLookup {
  workspace_slug: string
  id: string
  key: string
  name: string
}

export interface Issue {
  workspaceSlug?: string
  id: string
  number: number
  title: string
  priority: string
  assignee_id: string | null
  assignee_name: string | null
  parent_id: string | null
  project_id?: string | null
  project_key: string | null
  project_name: string | null
  type_key: string | null
  type_name: string | null
  status_id: string | null
  status_key: string | null
  status_name: string | null
  status_category: string | null
  sprint_id: string | null
  updated_at: number
  created_at: number
  customFields?: CustomFieldValue[]
  reviewTargets: Readonly<ReviewTarget[]>
}

export type SortKey = 'number' | 'priority' | 'updated' | 'status' | 'assignee' | 'created_at' | 'title'

const PRIORITY_ORDER: Record<string, number> = {
  high: 1,
  low: 3,
  medium: 2,
  none: 4,
  urgent: 0,
}

const STATUS_CATEGORY_ORDER: Record<string, number> = {
  cancelled: 5,
  done: 3,
  in_progress: 1,
  in_review: 2,
  todo: 0,
}

export const CATEGORY_COLORS: Record<string, string> = {
  todo: 'var(--status-todo)',
  in_progress: 'var(--status-in-progress)',
  in_review: 'var(--status-in-review)',
  done: 'var(--status-done)',
  cancelled: 'var(--status-cancelled)',
}

export const BOARD_COLUMNS: { category: string; label: string }[] = [
  { category: 'todo', label: 'Todo' },
  { category: 'in_progress', label: 'In Progress' },
  { category: 'in_review', label: 'In Review' },
  { category: 'done', label: 'Done' },
]

export const categoryColor = function categoryColor(category: string | null): string {
  return Predicate.isNotNullish(category) && String.isNonEmpty(category)
    ? (CATEGORY_COLORS[category] ?? 'var(--text-muted)')
    : 'var(--text-muted)'
}

export const assigneeInitials = function assigneeInitials(name: string): string {
  const parts = name.trim().split(/\s+/u)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

/**
 * Returns the best drop-target status ID for a given board column category.
 * For 'todo': prefers the first non-backlog status; falls back to any todo status.
 * For other categories: returns the first status in that category.
 */
export const getFirstStatusForCategory = function getFirstStatusForCategory(
  statuses: Readonly<TaskStatus[]>,
  category: string,
): TaskStatus | undefined {
  if (category === 'todo') {
    return (
      statuses.find((selectedStatus) => selectedStatus.category === 'todo' && selectedStatus.key !== 'backlog') ??
      statuses.find((selectedStatus) => selectedStatus.category === 'todo')
    )
  }
  return statuses.find((selectedStatus) => selectedStatus.category === category)
}

/**
 * Returns issues to display in a board column.
 * Todo column excludes backlog issues (those belong to the Backlog view).
 */
export const getBoardColumnIssues = function getBoardColumnIssues(
  issues: Readonly<Issue[]>,
  category: string,
): Issue[] {
  return issues.filter(
    (issue) => issue.status_category === category && (category !== 'todo' || issue.status_key !== 'backlog'),
  )
}

/** Returns issues for the Backlog view: todo category with backlog key. */
export const getBacklogIssues = function getBacklogIssues(issues: Readonly<Issue[]>): Issue[] {
  return issues.filter((issue) => issue.status_category === 'todo' && issue.status_key === 'backlog')
}

/** Applies multi-predicate filtering to an issue list (all predicates are AND-ed). */
export const filterIssues = function filterIssues(
  issues: Readonly<Issue[]>,
  filterStatuses: Readonly<string[]>,
  filterPriorities: Readonly<string[]>,
  filterProject: string,
  filterType: string,
): Issue[] {
  return issues
    .filter(
      (issue) =>
        Array.isReadonlyArrayEmpty(filterStatuses) ||
        (Predicate.isNotNullish(issue.status_id) && filterStatuses.includes(issue.status_id)),
    )
    .filter((issue) => Array.isReadonlyArrayEmpty(filterPriorities) || filterPriorities.includes(issue.priority))
    .filter((issue) => !filterProject || issue.project_key === filterProject)
    .filter((issue) => !filterType || issue.type_key === filterType)
}

const statusSortOrder = function statusSortOrder(issue: Issue): number {
  // Backlog issues: status_category=todo, status_key=backlog → order slot 4
  if (issue.status_key === 'backlog') {
    return 4
  }
  return STATUS_CATEGORY_ORDER[issue.status_category ?? ''] ?? 99
}

const SORT_COMPARATORS: Record<SortKey, (issue: Issue, selectedIssue: Issue) => number> = {
  assignee: (issue, selectedIssue) => (issue.assignee_name ?? '').localeCompare(selectedIssue.assignee_name ?? ''),
  created_at: (issue, selectedIssue) => issue.created_at - selectedIssue.created_at,
  number: (issue, selectedIssue) => issue.number - selectedIssue.number,
  priority: (issue, selectedIssue) =>
    (PRIORITY_ORDER[issue.priority] ?? 99) - (PRIORITY_ORDER[selectedIssue.priority] ?? 99),
  status: (issue, selectedIssue) => statusSortOrder(issue) - statusSortOrder(selectedIssue),
  title: (issue, selectedIssue) => issue.title.localeCompare(selectedIssue.title),
  updated: (issue, selectedIssue) => issue.updated_at - selectedIssue.updated_at,
}

/** Sorts a copy of an issue list by the given SortKey. */
export const sortIssues = function sortIssues(
  issues: Readonly<Issue[]>,
  sortBy: SortKey,
  sortDir: 'asc' | 'desc',
): Issue[] {
  const compare = SORT_COMPARATORS[sortBy]
  return [...issues].toSorted((left, right) => {
    const diff = compare ? compare(left, right) : 0
    return sortDir === 'asc' ? diff : -diff
  })
}
