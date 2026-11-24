'use client'
import { navigateIssues } from '../utils/navigation.ts'
import type { IssuesInitialData, IssuesRoute } from '../views/IssuesPage.tsx'
import { sortIssues } from './board-utils.ts'
import { deriveProjectDescription } from './issue-list/derive.ts'
import IssueListLayout from './issue-list/IssueListLayout.tsx'
import type { ViewMode } from './issue-list/types-view.ts'
import { useCreateIssueModal } from './issue-list/useCreateIssueModal.ts'
import { useIssueFilters } from './issue-list/useIssueFilters.ts'
import { useIssueListData } from './issue-list/useIssueListData.ts'
import { useIssueSearch } from './issue-list/useIssueSearch.ts'
import { useSavedViews } from './issue-list/useSavedViews.ts'

interface Props {
  workspaceSlug: string
  initialData: IssuesInitialData
  route: IssuesRoute
}

export default function IssueList({ workspaceSlug, initialData, route }: Props) {
  // The URL owns the view and its SSR-loaded working set. Browser preferences
  // cannot change the initial tree or replace primary data after hydration.
  const view = initialData.view
  const setView = (next: ViewMode) => {
    const params = new URLSearchParams(route.search)
    params.set('view', next)
    params.delete('cursor')
    navigateIssues(`${route.pathname}?${params}`)
  }

  const filters = useIssueFilters(route.search, initialData.project?.key ?? '', initialData.projects)
  const search = useIssueSearch(initialData.search, route)
  const data = useIssueListData(workspaceSlug, initialData, route)
  const saved = useSavedViews(
    filters.filterProject,
    filters.filtersBundle,
    filters.applyFilters,
    workspaceSlug,
    initialData.currentUserId,
  )
  const createModal = useCreateIssueModal({
    workspaceSlug,
    filterProject: filters.filterProject,
    projects: data.projects,
  })

  // Filtering happens server-side (PROJ-211): `issues` is already the filtered,
  // paginated result set, so the client only sorts the loaded rows. (Sorting is
  // still page-local — tracked separately as a follow-up.)
  const filtered = sortIssues(data.issues, filters.sortBy, filters.sortDir)

  return (
    <IssueListLayout
      workspaceSlug={workspaceSlug}
      view={view}
      setView={setView}
      filtered={filtered}
      projectDescription={deriveProjectDescription(data.projects, filters.filterProject)}
      filters={filters}
      search={search}
      data={data}
      saved={saved}
      createModal={createModal}
    />
  )
}
