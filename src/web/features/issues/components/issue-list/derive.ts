'use client'
import { Array, Schema } from 'effect'

import type { Issue, TaskStatus } from '@/features/issues/components/board-utils.ts'

import type { ProjectMeta } from './types.ts'

const hasStatusId = Schema.is(Schema.Struct({ status_id: Schema.NonEmptyString }))
const hasProjectKey = Schema.is(Schema.Struct({ project_key: Schema.NonEmptyString }))
const hasTypeKey = Schema.is(Schema.Struct({ type_key: Schema.NonEmptyString }))

/**
 * Description of the active project filter, for the banner under the toolbar.
 *
 * @param {Readonly<ProjectMeta[]>} projects The projects available to the issue list.
 * @param {string} filterProject The currently selected project key.
 * @returns {string | null} The selected project's description, or null without an available description.
 */
export const deriveProjectDescription = function deriveProjectDescription(
  projects: Readonly<ProjectMeta[]>,
  filterProject: string,
): string | null {
  if (!filterProject) {
    return null
  }
  return projects.find((project) => project.key === filterProject)?.description ?? null
}

/**
 * Status filter options: prefer the statuses endpoint, else derive from loaded issues.
 *
 * @param {Readonly<Issue[]>} issues The loaded issues used to derive a fallback status catalog.
 * @param {Readonly<TaskStatus[]>} statuses The status catalog supplied by the endpoint.
 * @returns {Readonly<TaskStatus[]>} The supplied status catalog, or the distinct statuses found in the loaded issues.
 */
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
        .filter((issue) => hasStatusId(issue))
        .map((issue) => [
          issue.status_id,
          {
            id: issue.status_id,
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
        .filter((issue) => hasProjectKey(issue))
        .map((issue) => [issue.project_key, { key: issue.project_key, name: issue.project_name ?? issue.project_key }]),
    ).values(),
  ]
}

export const deriveTypeOptions = function deriveTypeOptions(issues: Readonly<Issue[]>): [string, string][] {
  return [
    ...new Map(
      issues.filter((issue) => hasTypeKey(issue)).map((issue) => [issue.type_key, issue.type_name ?? issue.type_key]),
    ).entries(),
  ]
}
