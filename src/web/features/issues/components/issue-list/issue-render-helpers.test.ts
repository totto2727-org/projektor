'use client'
import { describe, expect, test } from 'vite-plus/test'

import { JSON_NULL } from '#tests/json-null.ts'
import type { Issue } from '@/features/issues/components/board-utils.ts'

import { getStoryPoints } from './issue-render-helpers.tsx'

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

describe('getStoryPoints', () => {
  test('returns null when the issue has no custom fields', () => {
    expect(getStoryPoints(makeIssue())).toBeNull()
  })

  test('returns null when no custom field has the story_points key', () => {
    const issue = makeIssue({
      customFields: [{ key: 'team', label: 'Team', type: 'text', value: 'Core' }],
    })
    expect(getStoryPoints(issue)).toBeNull()
  })

  test('returns the story_points field value when present', () => {
    const issue = makeIssue({
      customFields: [{ key: 'story_points', label: 'Story Points', type: 'number', value: '5' }],
    })
    expect(getStoryPoints(issue)).toBe('5')
  })
})
