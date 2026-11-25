'use client'
import type { Issue, Status, TaskType } from '@/features/issues/types.ts'
import type { IssuesInitialData } from '@/features/issues/views/issues-page.tsx'
import type { ProjectSummary } from '@/server/request-context.ts'

interface IssueLookups {
  epics: Issue[]
  projects: ProjectSummary[]
  projectsLoaded: boolean
  sprintDetail: IssuesInitialData['sprintDetail']
  sprints: Array<IssuesInitialData['sprints'][number]>
  statuses: Status[]
  taskTypes: TaskType[]
  taskTypesLoaded: boolean
}

export const useIssueLookups = function useIssueLookups(initialData: IssuesInitialData): IssueLookups {
  return {
    statuses: [...initialData.statuses],
    projects: [...initialData.projects],
    projectsLoaded: true,
    taskTypes: [...initialData.taskTypes],
    taskTypesLoaded: true,
    epics: [...initialData.epics],
    sprints: [...initialData.sprints],
    sprintDetail: initialData.sprintDetail,
  }
}
