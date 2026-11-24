'use client'
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
  return projects.find((p) => p.key === filterProject)?.description ?? null
}

/** Status filter options: prefer the statuses endpoint, else derive from loaded issues. */
export const deriveStatusOptions = function deriveStatusOptions(
  issues: Readonly<Issue[]>,
  statuses: Readonly<TaskStatus[]>,
): Readonly<TaskStatus[]> {
  if (statuses.length > 0) {
    return statuses
  }
  return [
    ...new Map(
      issues
        .filter((i) => i.status_id)
        .map((i) => [
          // biome-ignore lint/style/noNonNullAssertion: filter above guarantees status_id is set
          i.status_id!,
          {
            // biome-ignore lint/style/noNonNullAssertion: filter above guarantees status_id is set
            id: i.status_id!,
            key: i.status_key ?? '',
            name: i.status_name ?? i.status_key ?? '',
            category: i.status_category ?? '',
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
        .filter((i) => i.project_key)
        .map((i) => [
          // biome-ignore lint/style/noNonNullAssertion: filter above guarantees project_key is set
          i.project_key!,
          // biome-ignore lint/style/noNonNullAssertion: filter above guarantees project_key is set
          { key: i.project_key!, name: i.project_name ?? i.project_key! },
        ]),
    ).values(),
  ]
}

export const deriveTypeOptions = function deriveTypeOptions(issues: Readonly<Issue[]>): [string, string][] {
  return [
    ...new Map(
      issues
        .filter((i) => i.type_key)
        .map((i) => [
          // biome-ignore lint/style/noNonNullAssertion: filter above guarantees type_key is set
          i.type_key!,
          // biome-ignore lint/style/noNonNullAssertion: filter above guarantees type_key is set
          i.type_name ?? i.type_key!,
        ]),
    ).entries(),
  ]
}
