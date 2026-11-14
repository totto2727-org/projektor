'use client'
import type { ProjectSummary, RequestScope } from '../../../server/request-context'
import type { SprintDetail } from '../components/issue-list/SprintBannerSection'
import IssueList from '../components/IssueList'
import type { Issue, IssuePage, Status, TaskType } from '../types'
import { IssueReviewNavigation } from './IssueReviewNavigation'
import { SelectionRequired } from './shared'
export interface IssuesInitialData {
  readonly currentUserId: string
  readonly view: import('../components/issue-list/types-view').ViewMode
  readonly page: IssuePage
  readonly statuses: readonly Status[]
  readonly taskTypes: readonly TaskType[]
  readonly project: ProjectSummary | null
  readonly projects: readonly ProjectSummary[]
  readonly epics: readonly Issue[]
  readonly sprints: readonly { id: string; name: string; status: string }[]
  readonly sprintDetail: SprintDetail | null
  readonly search: import('../components/issue-list/useIssueSearch').IssueSearchSeed
}
export interface IssuesRoute {
  readonly pathname: string
  readonly search: string
}
export function IssuesPage({
  scope,
  route,
  workspaceSlug,
  initialData,
}: {
  scope: RequestScope
  route: IssuesRoute
  workspaceSlug: string
  initialData: IssuesInitialData | null
}) {
  if (!initialData) return <SelectionRequired scope={scope} label='Issues' />
  return (
    <section>
      <h1 className='text-2xl font-bold mb-3'>Issues</h1>
      <IssueReviewNavigation route={route} workspaceSlug={workspaceSlug} project={initialData.project} />
      <IssueList
        key={`${scope.user.id}:${workspaceSlug}:${route.pathname}:${route.search}`}
        workspaceSlug={workspaceSlug}
        initialData={initialData}
        route={route}
      />
    </section>
  )
}
