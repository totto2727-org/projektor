'use client'
import { describe, expect, test } from 'vite-plus/test'

import { JSON_NULL } from '#tests/json-null.ts'
import type { Issue, TaskStatus } from '@/features/issues/components/board-utils.ts'

import { deriveProjectDescription, deriveProjectOptions, deriveStatusOptions, deriveTypeOptions } from './derive.ts'
import type { ProjectMeta } from './types.ts'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeProject = function makeProject(overrides: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    workspace_slug: 'test-workspace',
    id: 'project-1',
    key: 'PROJ',
    name: 'Project',
    description: 'The main project',
    ...overrides,
  }
}

const makeIssue = function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    number: 1,
    title: 'Test issue',
    priority: 'medium',
    assignee_id: JSON_NULL,
    assignee_name: JSON_NULL,
    parent_id: JSON_NULL,
    project_key: 'PROJ',
    project_name: 'Project',
    type_key: JSON_NULL,
    type_name: JSON_NULL,
    status_id: 'status-1',
    status_key: 'todo',
    status_name: 'To Do',
    status_category: 'todo',
    sprint_id: JSON_NULL,
    updated_at: 1000,
    created_at: 1000,
    reviewTargets: [],
    ...overrides,
  }
}

// ─── deriveProjectDescription ──────────────────────────────────────────────

describe('deriveProjectDescription', () => {
  test('returns null when no project filter is active', () => {
    expect(deriveProjectDescription([makeProject()], '')).toBeNull()
  })

  test("returns the matching project's description", () => {
    expect(deriveProjectDescription([makeProject({ key: 'PROJ', description: 'desc' })], 'PROJ')).toBe('desc')
  })

  test('returns null when no project matches the filter key', () => {
    expect(deriveProjectDescription([makeProject({ key: 'OTHER' })], 'PROJ')).toBeNull()
  })
})

// ─── deriveStatusOptions ────────────────────────────────────────────────────

describe('deriveStatusOptions', () => {
  test('prefers the statuses endpoint result when non-empty', () => {
    const statuses: TaskStatus[] = [{ id: 's1', key: 'todo', name: 'To Do', category: 'todo', color: JSON_NULL }]
    expect(deriveStatusOptions([makeIssue()], statuses)).toBe(statuses)
  })

  test('derives unique statuses from issues when the endpoint returned none', () => {
    const issues = [
      makeIssue({ status_id: 's1', status_key: 'todo', status_name: 'To Do' }),
      makeIssue({ status_id: 's1', status_key: 'todo', status_name: 'To Do' }),
      makeIssue({
        status_id: 's2',
        status_key: 'done',
        status_name: 'Done',
        status_category: 'done',
      }),
    ]
    expect(deriveStatusOptions(issues, [])).toStrictEqual([
      { category: 'todo', color: JSON_NULL, id: 's1', key: 'todo', name: 'To Do' },
      { category: 'done', color: JSON_NULL, id: 's2', key: 'done', name: 'Done' },
    ])
  })

  test('skips issues with no status_id', () => {
    const issues = [makeIssue({ status_id: JSON_NULL })]
    expect(deriveStatusOptions(issues, [])).toStrictEqual([])
  })
})

// ─── deriveProjectOptions ───────────────────────────────────────────────────

describe('deriveProjectOptions', () => {
  test('derives unique project options from issues', () => {
    const issues = [
      makeIssue({ project_key: 'A', project_name: 'Alpha' }),
      makeIssue({ project_key: 'A', project_name: 'Alpha' }),
      makeIssue({ project_key: 'B', project_name: 'Beta' }),
    ]
    expect(deriveProjectOptions(issues)).toStrictEqual([
      { key: 'A', name: 'Alpha' },
      { key: 'B', name: 'Beta' },
    ])
  })

  test('falls back to the key as the name when project_name is missing', () => {
    expect(deriveProjectOptions([makeIssue({ project_key: 'A', project_name: JSON_NULL })])).toStrictEqual([
      { key: 'A', name: 'A' },
    ])
  })

  test('skips issues with no project_key', () => {
    expect(deriveProjectOptions([makeIssue({ project_key: JSON_NULL })])).toStrictEqual([])
  })
})

// ─── deriveTypeOptions ──────────────────────────────────────────────────────

describe('deriveTypeOptions', () => {
  test('derives unique type options as [key, name] entries', () => {
    const issues = [
      makeIssue({ type_key: 'bug', type_name: 'Bug' }),
      makeIssue({ type_key: 'bug', type_name: 'Bug' }),
      makeIssue({ type_key: 'task', type_name: 'Task' }),
    ]
    expect(deriveTypeOptions(issues)).toStrictEqual([
      ['bug', 'Bug'],
      ['task', 'Task'],
    ])
  })

  test('falls back to the key as the name when type_name is missing', () => {
    expect(deriveTypeOptions([makeIssue({ type_key: 'bug', type_name: JSON_NULL })])).toStrictEqual([['bug', 'bug']])
  })

  test('skips issues with no type_key', () => {
    expect(deriveTypeOptions([makeIssue({ type_key: JSON_NULL })])).toStrictEqual([])
  })
})
