import { Iterable } from 'effect'

/**
 * Builds GET /api/issues query strings. This endpoint calls the project filter
 * `project`, unlike the search and next endpoints which have their own wire DTOs.
 *
 * @param {URL} url The URL whose supported issue filters are copied.
 * @param {Readonly<Record<string, string>>} extra Additional values that set or replace query parameters.
 * @returns {string} The serialized query string without a leading question mark.
 */
export const issueListQuery = function issueListQuery(url: URL, extra: Readonly<Record<string, string>> = {}): string {
  const allowed = [
    'status',
    'priority',
    'assignee',
    'parentId',
    'noParent',
    'typeId',
    'sprintId',
    'cursor',
    'limit',
    'q',
    'sort',
    'order',
    'dateField',
    'dateFrom',
    'dateTo',
  ]
  const params = new URLSearchParams()
  Iterable.forEach(allowed, (key): void => {
    Iterable.forEach(url.searchParams.getAll(key), (value): void => {
      params.append(key, value)
    })
  })
  Iterable.forEach(Object.entries(extra), ([key, value]): void => {
    params.set(key, value)
  })
  return params.toString()
}
