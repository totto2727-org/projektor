// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { issue, workspace } from '../test/fixtures'
import type { ScopedIssue } from '../views/MyIssuesPage'
import MyIssues from './MyIssues'

afterEach(cleanup)

function scoped(overrides: Partial<ScopedIssue> = {}): ScopedIssue {
  return { ...issue(), workspaceSlug: workspace.slug, ...overrides }
}

function show(issues: readonly ScopedIssue[]) {
  return render(<MyIssues initialData={{ issues, memberships: [workspace] }} />)
}

function titles() {
  return within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(within(row).getAllByRole('cell')[1]).getAllByRole('link')[0].textContent)
}

describe('My Issues focus order', () => {
  it('uses one four-column table across projects and workspaces with scoped issue references', () => {
    show([
      scoped({ id: 'a', title: 'First issue', project_name: 'First project' }),
      scoped({ id: 'b', title: 'Second issue', project_name: 'Second project', workspaceSlug: 'other' }),
    ])
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '#',
      'Title',
      'Priority',
      'Status',
    ])
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByText('First project')).toBeNull()
    expect(screen.queryByText('Second project')).toBeNull()
    const table = within(screen.getByRole('table'))
    expect(table.getAllByRole('link', { name: 'A-1' })).toHaveLength(2)
    expect(table.getByRole('link', { name: 'First issue' }).getAttribute('href')).toContain('workspace=workspace')
    expect(table.getByRole('link', { name: 'Second issue' }).getAttribute('href')).toContain('workspace=other')
  })

  it('orders review, progress, todo and backlog before considering priority or recency', () => {
    show([
      scoped({ id: 'backlog', title: 'Backlog', status_key: 'backlog', priority: 'urgent', updated_at: 9000 }),
      scoped({ id: 'todo', title: 'Todo', priority: 'urgent', updated_at: 8000 }),
      scoped({
        id: 'progress',
        title: 'Progress',
        status_category: 'in_progress',
        status_key: 'in_progress',
        priority: 'high',
        updated_at: 7000,
        project_key: 'B',
      }),
      scoped({
        id: 'review',
        title: 'Review',
        status_category: 'in_progress',
        status_key: 'in_review',
        priority: 'low',
        updated_at: 1000,
      }),
    ])
    expect(titles()).toEqual(['Review', 'Progress', 'Todo', 'Backlog'])
  })

  it('puts higher priority before newer updates within the same status', () => {
    show(
      ['none', 'low', 'medium', 'high', 'urgent'].map((priority, index) =>
        scoped({ id: priority, title: `Priority ${priority}`, priority, updated_at: 100 - index }),
      ),
    )
    expect(titles()).toEqual(['Priority urgent', 'Priority high', 'Priority medium', 'Priority low', 'Priority none'])
  })

  it('uses newest updates first when status and priority match', () => {
    show([
      scoped({ id: 'old', title: 'Old', updated_at: 10 }),
      scoped({ id: 'new', title: 'New', updated_at: 30, project_key: 'B' }),
      scoped({ id: 'middle', title: 'Middle', updated_at: 20 }),
    ])
    expect(titles()).toEqual(['New', 'Middle', 'Old'])
  })

  it('orders custom status keys by their progress category', () => {
    show([
      scoped({ id: 'waiting', title: 'Waiting', status_key: 'waiting', priority: 'urgent' }),
      scoped({ id: 'qa', title: 'QA', status_key: 'qa', status_category: 'in_progress', priority: 'low' }),
    ])
    expect(titles()).toEqual(['QA', 'Waiting'])
  })

  it('omits completed and cancelled issues, and has no include-done control', () => {
    show([
      scoped({ title: 'Open' }),
      scoped({ id: 'done', title: 'Completed', status_category: 'done', status_key: 'done' }),
      scoped({ id: 'cancelled', title: 'Cancelled', status_category: 'cancelled', status_key: 'cancelled' }),
    ])
    expect(titles()).toEqual(['Open'])
    expect(screen.queryByText('Completed')).toBeNull()
    expect(screen.queryByText('Cancelled')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText('Include done')).toBeNull()
    expect(screen.getByText('1 issue')).toBeDefined()
  })

  it.each([{ issues: [] }, { issues: [scoped({ status_category: 'done' })] }])(
    'shows the open-issue empty state: $issues',
    ({ issues }) => {
      show(issues)
      expect(screen.queryByRole('table')).toBeNull()
      expect(screen.getByText('0 issues')).toBeDefined()
      expect(screen.getByText('No open issues assigned to you')).toBeDefined()
      expect(screen.getByText('You have no open issues across any project.')).toBeDefined()
    },
  )

  it('keeps mobile cards in the same order and does not mutate canonical SSR data', () => {
    const issues = Object.freeze([
      scoped({ id: 'old', title: 'Old', updated_at: 10 }),
      scoped({ id: 'new', title: 'New', updated_at: 20 }),
    ])
    const { container } = show(issues)
    const mobile = container.querySelector('.max-sm\\:flex')
    expect(mobile).not.toBeNull()
    expect(
      [...mobile!.querySelectorAll('a')]
        .filter((link) => ['New', 'Old'].includes(link.textContent ?? ''))
        .map((link) => link.textContent),
    ).toEqual(['New', 'Old'])
    expect(issues.map((entry) => entry.title)).toEqual(['Old', 'New'])
  })
})
