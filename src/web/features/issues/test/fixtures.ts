import { JSON_NULL } from '#tests/json-null.ts'
import type { Issue } from '@/features/issues/types.ts'
import type { RequestScope } from '@/server/request-context.ts'
export const workspace = {
  id: 'workspace-a',
  slug: 'workspace',
  name: 'Workspace',
  role: 'member' as const,
}
export const project = {
  id: 'project-a',
  name: 'Project A',
  key: 'A',
  slug: 'a',
  description: 'Project description',
  workspace_id: workspace.id,
  workspace_name: workspace.name,
  workspace_slug: workspace.slug,
  open_issue_count: 1,
  backlog_issue_count: 0,
  archived_at: JSON_NULL,
  created_at: 1,
  updated_at: 1,
}
export const secondProject = { ...project, id: 'project-b', key: 'B', name: 'Project B' }
export const scope: RequestScope = {
  user: { id: 'user-a', email: 'user@example.test', name: 'User' },
  workspaces: [workspace],
  projects: [project, secondProject],
  selection: { kind: 'workspace', workspace },
}
export const issue = function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-a',
    number: 1,
    title: 'Original issue',
    body: '**Original description**',
    priority: 'medium',
    project_id: project.id,
    project_key: project.key,
    project_name: project.name,
    status_id: 'todo',
    status_key: 'todo',
    status_name: 'Todo',
    status_category: 'todo',
    type_id: JSON_NULL,
    type_key: JSON_NULL,
    type_name: JSON_NULL,
    parent_id: JSON_NULL,
    assignee_id: JSON_NULL,
    assignee_name: JSON_NULL,
    sprint_id: JSON_NULL,
    created_at: 1,
    updated_at: 1,
    reviewTargets: [],
    customFields: [{ key: 'story_points', label: 'Story points', type: 'number', value: '3' }],
    workspaceSlug: workspace.slug,
    ...overrides,
  }
}
export const statuses = [
  { id: 'todo', key: 'todo', name: 'Todo', category: 'todo', color: JSON_NULL },
  { id: 'done', key: 'done', name: 'Done', category: 'done', color: JSON_NULL },
]
export const taskTypes = [{ id: 'epic-type', key: 'epic', name: 'Epic' }]
export const comment = {
  id: 'comment-a',
  body: 'Existing comment',
  author_id: 'user-a',
  author_name: 'User',
  author_email: 'user@example.test',
  created_at: 1,
}
