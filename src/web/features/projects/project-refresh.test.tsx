// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { JSON_NULL } from '#tests/json-null.ts'
import { RuntimeProvider } from '@/client/runtime.tsx'

import type * as Actions from './actions.ts'
import { archiveProject, createProject } from './actions.ts'
import { ProjectLanding } from './project-landing.tsx'
import { ProjectList } from './project-list.tsx'
import type { FlowMetrics, Project, RecentIssue, RecentWikiPage } from './schemas.ts'

vi.mock('../../effront', () => ({
  EFFRONT: { ServerFn: { make: vi.fn<(definition: unknown) => () => void>(() => vi.fn<() => void>()) } },
}))

vi.mock('./actions', () => ({
  createProject: vi.fn<typeof Actions.createProject>(),
  updateDescription: vi.fn<typeof Actions.updateDescription>(),
  archiveProject: vi.fn<typeof Actions.archiveProject>(),
}))
vi.mock(import('@/client/functions.ts'), () => ({
  unwrapResult: <T,>(result: { ok: true; value: T } | { ok: false; message: string }) => {
    if (!result.ok) {
      throw new Error(result.message)
    }
    return result.value
  },
}))

const catalogProject = (name: string) => ({
  id: 'project-1',
  name,
  key: 'PROJ',
  slug: 'project',
  description: 'Server description',
  workspace_id: 'workspace-1',
  workspace_name: 'Workspace',
  workspace_slug: 'workspace',
  open_issue_count: 1,
  backlog_issue_count: 0,
  archived_at: JSON_NULL,
  created_at: 1,
  updated_at: 1,
})

const project = (description: string): Project => ({
  id: 'project-1',
  name: 'Project',
  key: 'PROJ',
  slug: 'project',
  description,
  archivedAt: JSON_NULL,
  workspaceId: 'workspace-1',
  createdAt: 1,
  updatedAt: 1,
})

const emptyIssues: Readonly<RecentIssue[]> = []
const emptyWiki: Readonly<RecentWikiPage[]> = []
const emptyFlow: FlowMetrics = { throughputOverTime: [], cfdOverTime: [] }

function withRuntime(node: React.ReactNode): JSX.Element {
  return (
    <RuntimeProvider scope={null} url='https://frontend.test/projects/view?projectId=project-1'>
      {node}
    </RuntimeProvider>
  )
}

describe('project server-prop refresh', () => {
  afterEach(cleanup)

  test('replaces an optimistic catalog with same-URL canonical server props', () => {
    const view = render(
      withRuntime(<ProjectList initialProjects={[catalogProject('Optimistic project')]} memberships={[]} />),
    )
    expect(screen.getByText('Optimistic project')).toBeInstanceOf(Element)

    view.rerender(withRuntime(<ProjectList initialProjects={[catalogProject('Canonical project')]} memberships={[]} />))
    expect(screen.getByText('Canonical project')).toBeInstanceOf(Element)
    expect(screen.queryByText('Optimistic project')).toBeNull()
  })

  test('renders only canonical props after a successful create', async () => {
    expect.hasAssertions()
    vi.mocked(createProject).mockResolvedValue({
      ok: true,
      value: { id: 'project-2', name: 'Created optimistically', key: 'NEW', slug: 'created' },
    })
    const memberships = [{ id: 'workspace-1', name: 'Workspace', slug: 'workspace', role: 'owner' as const }]
    const view = render(
      withRuntime(<ProjectList initialProjects={[catalogProject('Existing project')]} memberships={memberships} />),
    )
    fireEvent.click(screen.getByText('+ New project'))
    fireEvent.change(screen.getByPlaceholderText('My Project'), {
      target: { value: 'Created optimistically' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledOnce()
    })
    const sent = vi.mocked(createProject).mock.calls[0][1]
    expect(sent.get('workspaceSlug')).toBe('workspace')
    expect(sent.get('name')).toBe('Created optimistically')
    await waitFor(() => {
      expect(screen.getByText('+ New project').closest('details')?.open).toBe(false)
    })
    expect(screen.queryByText('Created optimistically')).toBeNull()
    expect(screen.getByText('Existing project')).toBeInstanceOf(Element)
    view.rerender(
      withRuntime(<ProjectList initialProjects={[catalogProject('Canonical catalog')]} memberships={memberships} />),
    )
    await waitFor(() => {
      expect(screen.getByText('Canonical catalog')).toBeInstanceOf(Element)
    })
    expect(screen.queryByText('Created optimistically')).toBeNull()
  })

  test('uses a native GET form for the addressable archived catalog', () => {
    render(withRuntime(<ProjectList initialProjects={[]} memberships={[]} showArchived />))
    const checkbox = screen.getByRole('checkbox', { name: 'Show archived' }) as HTMLInputElement
    const form = checkbox.form
    expect(form?.method).toBe('get')
    expect(form?.getAttribute('action')).toBe('/projects/view')
    expect(form && new FormData(form).get('includeArchived')).toBe('true')
    expect(form && new FormData(form).get('projectId')).toBe('project-1')
  })

  test('bounds the native workspace selector without losing explicit second-workspace submission', async () => {
    expect.hasAssertions()
    const memberships = [
      { id: 'workspace-1', name: 'Projektor', slug: 'projektor', role: 'owner' as const },
      {
        id: 'workspace-2',
        name: 'Second workspace abc123',
        slug: 'second-abc123',
        role: 'owner' as const,
      },
    ]
    render(withRuntime(<ProjectList initialProjects={[]} memberships={memberships} />))
    fireEvent.click(screen.getByText('+ New project'))
    const workspace = screen.getByRole('combobox', { name: 'Workspace' })
    if (!(workspace instanceof HTMLSelectElement)) {
      throw new Error('Workspace must remain a native select')
    }
    // JSDOM cannot measure layout. Guard the sizing contract used by the real mobile acceptance test.
    expect(workspace.classList.contains('w-full')).toBe(true)
    expect(workspace.classList.contains('min-w-0')).toBe(true)
    expect(workspace.value).toBe('')
    expect(workspace.required).toBe(true)
    expect(screen.getByRole('option', { name: 'Second workspace abc123 (second-abc123)' })).toBeInstanceOf(Element)

    fireEvent.change(screen.getByPlaceholderText('My Project'), { target: { value: 'Second native abc123' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create project' }).hasAttribute('disabled')).toBe(true)
    })
    fireEvent.change(workspace, { target: { value: 'second-abc123' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create project' }).hasAttribute('disabled')).toBe(false)
    })
    expect(workspace.form && new FormData(workspace.form).get('workspaceSlug')).toBe('second-abc123')
  })

  test('adopts refreshed overview props without erasing an active description draft', () => {
    expect.hasAssertions()
    const view = render(
      withRuntime(
        <ProjectLanding
          initialProject={project('Original description')}
          initialIssues={emptyIssues}
          initialWiki={emptyWiki}
          initialFlow={emptyFlow}
          workspaceSlug='workspace'
          canEdit
        />,
      ),
    )
    fireEvent.click(screen.getByLabelText('Edit project description'))
    const input = screen.getByLabelText('Project description') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Unsaved draft' } })

    view.rerender(
      withRuntime(
        <ProjectLanding
          initialProject={project('Canonical server description')}
          initialIssues={emptyIssues}
          initialWiki={emptyWiki}
          initialFlow={emptyFlow}
          workspaceSlug='workspace'
          canEdit
        />,
      ),
    )
    expect(screen.getByLabelText<HTMLTextAreaElement>('Project description').value).toBe('Unsaved draft')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    return waitFor(() => expect(screen.getByText('Canonical server description')).toBeInstanceOf(Element))
  })

  test('releases a failed archive request without erasing the active description draft', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof archiveProject>>>()
    vi.mocked(archiveProject).mockReturnValueOnce(pending.promise)
    vi.mocked(archiveProject).mockResolvedValueOnce({ ok: true, value: { ok: true } })
    render(
      withRuntime(
        <ProjectLanding
          initialProject={project('Original description')}
          initialIssues={emptyIssues}
          initialWiki={emptyWiki}
          initialFlow={emptyFlow}
          workspaceSlug='workspace'
          canEdit
        />,
      ),
    )
    fireEvent.click(screen.getByLabelText('Edit project description'))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(screen.getByRole('button', { name: 'Archive' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Project description'), { target: { value: 'Draft during archive' } })
    await act(async () => {
      pending.reject(new Error('Archive unavailable'))
    })
    expect(screen.getByRole('alert').textContent).toContain('Archive unavailable')
    expect(screen.getByRole('button', { name: 'Archive' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByLabelText('Project description')).toHaveProperty('value', 'Draft during archive')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Archive' })))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Archive' }).hasAttribute('disabled')).toBe(false)
  })
})
