'use client'
import type { JSX } from 'react'

import { EpicList } from '@/features/issues/components/epic-list.tsx'
import type { IssuePage, Status, TaskType } from '@/features/issues/types.ts'
import type { ProjectSummary, RequestScope } from '@/server/request-context.ts'

import { SelectionRequired } from './shared.tsx'
export type EpicsInitialData = Readonly<{
  page: IssuePage
  statuses: Readonly<Status[]>
  taskTypes: Readonly<TaskType[]>
  project: ProjectSummary
  projects: Readonly<ProjectSummary[]>
  search: string
}>
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const EpicsPage = function EpicsPage({
  scope,
  workspaceSlug,
  initialData,
}: {
  scope: RequestScope
  workspaceSlug: string
  initialData: EpicsInitialData | null
}): JSX.Element {
  if (!initialData) {
    return <SelectionRequired scope={scope} label='Epics' />
  }
  return (
    <section>
      <h1 className='text-2xl font-bold mb-6'>Epics</h1>
      <EpicList
        key={`${workspaceSlug}:${initialData.search}`}
        workspaceSlug={workspaceSlug}
        initialData={initialData}
      />
    </section>
  )
}
