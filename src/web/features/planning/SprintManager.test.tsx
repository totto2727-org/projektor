// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { dateInputToUnix, getStoryPoints, unixToDateInput } from './helpers'
import { calendarOffset, calendarTimestamp } from './input-schemas'
import { SprintManager } from './SprintManager'
import type { Sprint, SprintIssue } from './types'

const request = vi.hoisted(() => vi.fn())
const nativeSubmitted = vi.hoisted(() => vi.fn())
vi.mock('./actions', () => ({
  createSprint: (previous: unknown, data: FormData) => {
    nativeSubmitted(previous, data)
    return request('create', {
      ...Object.fromEntries(data),
      startOffset: Number(data.get('startOffset')),
      endOffset: Number(data.get('endOffset')),
    })
  },
  editSprint: (previous: unknown, data: FormData) => {
    nativeSubmitted(previous, data)
    return request('edit', {
      ...Object.fromEntries(data),
      startOffset: Number(data.get('startOffset')),
      endOffset: Number(data.get('endOffset')),
    })
  },
  setSprintStatus: (input: unknown) => request('status', input),
  archiveSprint: (input: unknown) => request('archive', input),
  moveSprintIssues: (input: unknown) => request('move', input),
}))
const sprint = (id = 'sprint-a', status: Sprint['status'] = 'active', name = 'Sprint A'): Sprint => ({
  id,
  status,
  name,
  projectId: 'project-a',
  goal: 'Ship safely',
  startDate: null,
  endDate: null,
  createdAt: 1,
})
const issue = (id: string, category: string, points: string): SprintIssue => ({
  id,
  title: `Issue ${id}`,
  number: 1,
  project_key: 'PROJ',
  status_category: category,
  sprint_id: 'sprint-a',
  customFields: [{ key: 'story_points', value: points }],
})
const rows = [issue('done', 'done', '5'), issue('open', 'in_progress', '3')]
const scope = { workspaceSlug: 'alpha', projectId: 'project-a' }
const props = { ...scope, initialIssues: rows }
afterEach(cleanup)
beforeEach(() => {
  request.mockReset()
  nativeSubmitted.mockReset()
  request.mockResolvedValue({ ok: true, value: { ok: true } })
})

describe('original SprintManager with TanStack schemas and semantic Effront calls', () => {
  it('keeps native create drafts and exposes typed failure until a successful retry', async () => {
    request.mockResolvedValueOnce({ ok: false, status: 409, message: 'Sprint conflict' })
    render(<SprintManager {...props} initialSprints={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '+ New sprint' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Retry iteration' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create sprint' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Sprint conflict'))
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('Retry iteration')
    fireEvent.click(screen.getByRole('button', { name: 'Create sprint' }))
    await waitFor(() => expect(screen.queryByLabelText('Name *')).toBeNull())
    expect(nativeSubmitted.mock.calls[1][0]).toMatchObject({ ok: false, status: 409 })
  })
  it('uses native scoped status links and canonical selected rows without wiping a same-URL draft', () => {
    const planned = sprint('sprint-b', 'planned', 'Planned row')
    const active = sprint()
    const history = sprint('sprint-c', 'completed', 'Historical row')
    const view = render(
      <SprintManager {...props} mode='planned' initialSprints={[planned]} allSprints={[active, planned, history]} />,
    )
    for (const [label, status] of [
      ['All', 'all'],
      ['Planned', 'planned'],
      ['Active', 'active'],
      ['History', 'completed'],
    ]) {
      const link = screen.getByRole('link', { name: label })
      const target = new URL(link.getAttribute('href') ?? '', 'https://front.example')
      expect(target.pathname).toBe('/sprints')
      expect(target.searchParams.get('status')).toBe(status)
      expect(target.searchParams.get('projectId')).toBe('project-a')
      expect(target.searchParams.get('workspace')).toBe('alpha')
    }
    expect(screen.getByRole('link', { name: 'Planned' }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('button', { name: 'Complete sprint' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Start sprint' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Draft retained' } })
    view.rerender(
      <SprintManager
        {...props}
        mode='planned'
        initialSprints={[{ ...planned, name: 'Refreshed planned row' }]}
        allSprints={[active, { ...planned, name: 'Refreshed planned row' }, history]}
      />,
    )
    expect(screen.getByText('Refreshed planned row')).toBeTruthy()
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('Draft retained')
    expect(request).not.toHaveBeenCalled()
  })
  it('renders canonical SSR issues and velocity without primary browser requests', () => {
    render(<SprintManager {...props} initialSprints={[sprint('sprint-a', 'completed')]} />)
    expect(screen.getByRole('heading', { name: 'Velocity' })).toBeTruthy()
    expect(screen.getAllByText('5').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'View issues →' }).getAttribute('href')).toContain('sprintId=sprint-a')
    expect(request).not.toHaveBeenCalled()
  })
  it('adopts same-URL rows without erasing active create fields owned by TanStack', () => {
    const view = render(<SprintManager {...props} initialSprints={[sprint()]} />)
    fireEvent.click(screen.getByRole('button', { name: '+ New sprint' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Unsaved iteration' } })
    fireEvent.change(screen.getByLabelText('Goal (optional)'), {
      target: { value: 'Unsaved goal' },
    })
    view.rerender(
      <SprintManager
        {...props}
        initialSprints={[
          sprint('sprint-a', 'active', 'Canonical A'),
          sprint('sprint-b', 'planned', 'New server sprint'),
        ]}
      />,
    )
    expect(screen.getByText('Canonical A')).toBeTruthy()
    expect(screen.getByText('New server sprint')).toBeTruthy()
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('Unsaved iteration')
    expect((screen.getByLabelText('Goal (optional)') as HTMLInputElement).value).toBe('Unsaved goal')
  })
  it('preserves edit drafts and sends semantic calendar values plus their original local offsets', async () => {
    const view = render(<SprintManager {...props} initialSprints={[sprint()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Local edit' } })
    fireEvent.change(screen.getByLabelText('Start date (optional)'), {
      target: { value: '2026-10-01' },
    })
    view.rerender(<SprintManager {...props} initialSprints={[sprint('sprint-a', 'active', 'Canonical title')]} />)
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('Local edit')
    fireEvent.click(screen.getByRole('button', { name: 'Save sprint' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('edit', {
        ...scope,
        sprintId: 'sprint-a',
        name: 'Local edit',
        goal: 'Ship safely',
        start: '2026-10-01',
        end: '',
        startOffset: calendarOffset('2026-10-01'),
        endOffset: 0,
      }),
    )
  })
  it('creates from original fields and lets canonical props, not a {id} response, own the list', async () => {
    request.mockResolvedValueOnce({ ok: true, value: { id: 'created-id' } })
    render(<SprintManager {...props} initialSprints={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '+ New sprint' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: '  Sprint 2 ' } })
    fireEvent.change(screen.getByLabelText('Start date (optional)'), {
      target: { value: '2026-10-04' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create sprint' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('create', {
        ...scope,
        name: '  Sprint 2 ',
        goal: '',
        start: '2026-10-04',
        end: '',
        startOffset: calendarOffset('2026-10-04'),
        endOffset: 0,
      }),
    )
    await waitFor(() => expect(screen.queryByLabelText('Name *')).toBeNull())
    expect(nativeSubmitted).toHaveBeenCalledWith(null, expect.any(FormData))
    expect(screen.queryByText('created-id')).toBeNull()
  })
  it('uses shared Standard Schema for whitespace names and reversed dates, without manual validation', async () => {
    render(<SprintManager {...props} initialSprints={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '+ New sprint' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: '   ' } })
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Create sprint' }) as HTMLButtonElement).disabled).toBe(true),
    )
    expect(screen.getByRole('alert').textContent).toContain('Name is required')
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Sprint' } })
    fireEvent.change(screen.getByLabelText('Start date (optional)'), {
      target: { value: '2026-10-04' },
    })
    fireEvent.change(screen.getByLabelText('End date (optional)'), {
      target: { value: '2026-10-01' },
    })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('End date'))
    expect(request).not.toHaveBeenCalled()
  })
  it('retains failed completion confirmation and original completed issues/story-point summary', async () => {
    render(<SprintManager {...props} initialSprints={[sprint()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Complete sprint' }))
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce({ ok: false, status: 403, message: 'Completion denied' })
    fireEvent.click(screen.getByRole('button', { name: 'Yes, complete' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Completion denied'))
    expect(screen.queryByText('Sprint complete: Sprint A')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, complete' }))
    await waitFor(() => expect(screen.getByText('Sprint complete: Sprint A')).toBeTruthy())
    expect(screen.getAllByText('5/8').length).toBe(2)
    expect(screen.getByRole('link', { name: 'Issue done' }).getAttribute('href')).toContain(
      '/projects/PROJ/issues/1/issue-done?workspace=alpha',
    )
    expect(request).toHaveBeenLastCalledWith('status', {
      ...scope,
      sprintId: 'sprint-a',
      status: 'completed',
    })
  })
  it('starts planned sprints, moves the initially selected incomplete issues, and confirms archive', async () => {
    const view = render(
      <SprintManager
        {...props}
        initialSprints={[sprint('sprint-a', 'planned'), sprint('sprint-b', 'planned', 'Destination')]}
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Start sprint' })[0])
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('status', {
        ...scope,
        sprintId: 'sprint-a',
        status: 'active',
      }),
    )
    view.rerender(
      <SprintManager {...props} initialSprints={[sprint(), sprint('sprint-b', 'planned', 'Destination')]} />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Move issues' })[0])
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'sprint-b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move 1 issues' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('move', {
        ...scope,
        sprintId: 'sprint-a',
        targetId: 'sprint-b',
        issueIds: ['open'],
      }),
    )
    const count = request.mock.calls.length
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0])
    expect(request.mock.calls.length).toBe(count)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, archive' }))
    await waitFor(() => expect(request).toHaveBeenLastCalledWith('archive', { ...scope, sprintId: 'sprint-a' }))
  })
  it('preserves timezone-safe timestamps and original story-point parsing', () => {
    const timestamp = dateInputToUnix('2026-10-04')
    expect(timestamp).not.toBeNull()
    expect(unixToDateInput(timestamp)).toBe('2026-10-04')
    expect(calendarTimestamp('2026-10-04', calendarOffset('2026-10-04'))).toBe(timestamp)
    expect(getStoryPoints(issue('x', 'done', 'no-points'))).toBe(0)
  })
})
