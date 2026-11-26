'use client'
import type { IssuesInitialData, IssuesRoute } from '@/features/issues/views/issues-page.tsx'

import type { IssuePagination } from './page-navigation.tsx'
import { useIssueLookups } from './use-issue-lookups.ts'
import { useIssueMutations } from './use-issue-mutations.ts'

type IssueListData = ReturnType<typeof useIssueLookups> &
  ReturnType<typeof useIssueMutations> & {
    issues: IssuesInitialData['page']['items']
    pagination: { nextCursor: IssuePagination['nextCursor']; route: IssuesRoute }
    total: number | null
  }

/**
 * Primary rows, cursor, count and lookups are always the current SSR DTOs.
 *
 * @param {string} workspaceSlug Workspace used for issue mutations.
 * @param {IssuesInitialData} initialData Current server-rendered data.
 * @param {IssuesRoute} route Route used by pagination controls.
 * @returns {IssueListData} The current rows, lookups, pagination and mutation controls.
 */
export const useIssueListData = function useIssueListData(
  workspaceSlug: string,
  initialData: IssuesInitialData,
  route: IssuesRoute,
): IssueListData {
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
