'use client'
import type { IssuesInitialData, IssuesRoute } from '../../views/IssuesPage'
import { useIssueLookups } from './useIssueLookups'
import { useIssueMutations } from './useIssueMutations'

/** Primary rows, cursor, count and lookups are always the current SSR DTOs. */
export function useIssueListData(workspaceSlug: string, initialData: IssuesInitialData, route: IssuesRoute) {
  const lookups = useIssueLookups(initialData)
  const mutations = useIssueMutations(workspaceSlug, lookups.statuses)
  return {
    ...lookups,
    ...mutations,
    issues: initialData.page.items,
    total: initialData.page.total ?? null,
    pagination: { route, nextCursor: initialData.page.nextCursor ?? null },
  }
}
