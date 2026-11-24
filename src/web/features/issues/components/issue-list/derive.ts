'use client'
import { Array } from 'effect'

import type { Issue, TaskStatus } from '@/features/issues/components/board-utils.ts'

import type { ProjectMeta } from './types.ts'

/** Description of the active project filter, for the banner under the toolbar. */
export const deriveProjectDescription = function deriveProjectDescription(
  projects: Readonly<ProjectMeta[]>,
  filterProject: string,
): string | null {
  if (!filterProject) {
    return null
  }
  return projects.find((project) => project.key === filterProject)?.description ?? null
}

/** Status filter options: prefer the statuses endpoint, else derive from loaded issues. */
export const deriveStatusOptions = function deriveStatusOptions(
  issues: Readonly<Issue[]>,
  statuses: Readonly<TaskStatus[]>,
): Readonly<TaskStatus[]> {
  if (Array.isReadonlyArrayNonEmpty(statuses)) {
    return statuses
  }
  return [
    ...new Map(
      issues
        .filter((issue) => issue.status_id)
        .map((issue) => [
          // biome-ignore lint/style/noNonNullAssertion: filter above guarantees status_id is set
          issue.status_id!,
          {
            // biome-ignore lint/style/noNonNullAssertion: filter above guarantees status_id is set
            id: issue.status_id!,
            key: issue.status_key ?? '',
            name: issue.status_name ?? issue.status_key ?? '',
            category: issue.status_category ?? '',
            color: null,
          },
        ]),
    ).values(),
  ]
}

export const deriveProjectOptions = function deriveProjectOptions(
  issues: Readonly<Issue[]>,
): { key: string; name: string }[] {
  return [
    ...new Map(
      issues
        .filter((issue) => issue.project_key)
        .map((issue) => [
          // biome-ignore lint/style/noNonNullAssertion: filter above guarantees project_key is set
          issue.project_key!,
          // biome-ignore lint/style/noNonNullAssertion: filter above guarantees project_key is set
          { key: issue.project_key!, name: issue.project_name ?? issue.project_key! },
        ]),
    ).values(),
  ]
}

export const deriveTypeOptions = function deriveTypeOptions(issues: Readonly<Issue[]>): [string, string][] {
  return [
    ...new Map(
      issues
        .filter((issue) => issue.type_key)
        .map((issue) => [
          // biome-ignore lint/style/noNonNullAssertion: filter above guarantees type_key is set
          issue.type_key!,
          // biome-ignore lint/style/noNonNullAssertion: filter above guarantees type_key is set
          issue.type_name ?? issue.type_key!,
        ]),
    ).entries(),
  ]
}
