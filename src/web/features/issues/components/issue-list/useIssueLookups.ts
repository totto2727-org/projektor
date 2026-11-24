'use client'
import type { IssuesInitialData } from '../../views/IssuesPage.tsx'
export function useIssueLookups(initialData: IssuesInitialData) {
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
