// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, afterEach, expect, test, vi } from 'vite-plus/test'

import { JSON_NULL } from '#tests/json-null.ts'

import { EpicList } from './epic-list.tsx'

vi.mock('../actions', () => ({ createIssue: vi.fn() }))

const project = {
  id: 'project',
  key: 'PROJ',
  name: 'Project',
  slug: 'project',
  description: JSON_NULL,
  workspace_id: 'workspace',
  workspace_name: 'Workspace',
  workspace_slug: 'workspace',
  open_issue_count: 0,
  backlog_issue_count: 0,
  archived_at: JSON_NULL,
  created_at: 1,
  updated_at: 1,
}

describe('covers Epic creation dialog', () => {
  afterEach(cleanup)

  test('opens epic creation with an interactive priority portal and restores focus on Escape', async () => {
    expect.hasAssertions()
    render(
      <EpicList
        workspaceSlug='workspace'
        initialData={{
          project,
          projects: [project],
          search: '',
          page: { items: [] },
          statuses: [],
          taskTypes: [{ id: 'epic', key: 'epic', name: 'Epic' }],
        }}
      />,
    )
    const trigger = screen.getByRole('button', { name: '+ New Epic' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Create new epic' })).toBeInstanceOf(Element)
    fireEvent.click(screen.getByRole('combobox', { name: 'Select priority' }))
    const option = await screen.findByRole('option', { name: 'high' })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option)
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Select priority' }).textContent).toContain('high')
    })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })
})
