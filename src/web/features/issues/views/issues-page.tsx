'use client'
import type { JSX } from 'react'

import { IssueList } from '@/features/issues/components/issue-list.tsx'
import type { SprintDetail } from '@/features/issues/components/issue-list/sprint-banner-section.tsx'
import type { ViewMode } from '@/features/issues/components/issue-list/types-view.ts'
import type { IssueSearchSeed } from '@/features/issues/components/issue-list/use-issue-search.ts'
import type { Issue, IssuePage, Status, TaskType } from '@/features/issues/types.ts'
import type { ProjectSummary, RequestScope } from '@/server/request-context.ts'

import { IssueReviewNavigation } from './issue-review-navigation.tsx'
import { SelectionRequired } from './shared.tsx'
export type IssuesInitialData = Readonly<{
  currentUserId: string
  view: ViewMode
  page: IssuePage
  statuses: Readonly<Status[]>
  taskTypes: Readonly<TaskType[]>
  project: ProjectSummary | null
  projects: Readonly<ProjectSummary[]>
  epics: Readonly<Issue[]>
  sprints: Readonly<{ id: string; name: string; status: string }[]>
  sprintDetail: SprintDetail | null
  search: IssueSearchSeed
}>
export type IssuesRoute = Readonly<{
  pathname: string
  search: string
}>
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
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
