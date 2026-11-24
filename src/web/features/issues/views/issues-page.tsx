'use client'
import type { JSX } from 'react'

import { IssueList } from '@/features/issues/components/issue-list.tsx'
import type { SprintDetail } from '@/features/issues/components/issue-list/sprint-banner-section.tsx'
import type { Issue, IssuePage, Status, TaskType } from '@/features/issues/types.ts'
import type { ProjectSummary, RequestScope } from '@/server/request-context.ts'

import { IssueReviewNavigation } from './issue-review-navigation.tsx'
import { SelectionRequired } from './shared.tsx'
export interface IssuesInitialData {
  readonly currentUserId: string
  readonly view: import('../components/issue-list/types-view').ViewMode
  readonly page: IssuePage
  readonly statuses: Readonly<Status[]>
  readonly taskTypes: Readonly<TaskType[]>
  readonly project: ProjectSummary | null
  readonly projects: Readonly<ProjectSummary[]>
  readonly epics: Readonly<Issue[]>
  readonly sprints: Readonly<{ id: string; name: string; status: string }[]>
  readonly sprintDetail: SprintDetail | null
  readonly search: import('../components/issue-list/use-issue-search.ts').IssueSearchSeed
}
export interface IssuesRoute {
  readonly pathname: string
  readonly search: string
}
export const IssuesPage = function IssuesPage({
  scope,
  route,
  workspaceSlug,
  initialData,
}: {
  scope: RequestScope
  route: IssuesRoute
  workspaceSlug: string
  initialData: IssuesInitialData | null
}): JSX.Element {
  if (!initialData) {
    return <SelectionRequired scope={scope} label='Issues' />
  }
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
