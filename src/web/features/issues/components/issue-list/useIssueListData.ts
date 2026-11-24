'use client'
import type { IssuesInitialData, IssuesRoute } from '@/features/issues/views/IssuesPage.tsx'

import { useIssueLookups } from './useIssueLookups.ts'
import { useIssueMutations } from './useIssueMutations.ts'

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
