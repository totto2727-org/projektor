// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Iterable } from 'effect'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { JSON_NULL } from '#tests/json-null.ts'

import { dateInputToUnix, getStoryPoints, unixToDateInput } from './helpers.ts'
import { calendarOffset, calendarTimestamp } from './input-schemas.ts'
import { SprintManager } from './sprint-manager.tsx'
import type { Sprint, SprintIssue } from './types.ts'

const request = vi.hoisted(() => vi.fn<(operation: string, input: unknown) => unknown>())
const nativeSubmitted = vi.hoisted(() => vi.fn<(previous: unknown, data: FormData) => void>())
vi.mock('./actions', () => ({
  archiveSprint: (input: unknown) => request('archive', input),
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
  moveSprintIssues: (input: unknown) => request('move', input),
  setSprintStatus: (input: unknown) => request('status', input),
}))
const sprint = (id = 'sprint-a', status: Sprint['status'] = 'active', name = 'Sprint A'): Sprint => ({
  createdAt: 1,
  endDate: JSON_NULL,
  goal: 'Ship safely',
  id,
  name,
  projectId: 'project-a',
  startDate: JSON_NULL,
  status,
})
const issue = (id: string, category: string, points: string): SprintIssue => ({
  customFields: [{ key: 'story_points', value: points }],
  id,
  number: 1,
  project_key: 'PROJ',
  sprint_id: 'sprint-a',
  status_category: category,
  title: `Issue ${id}`,
})
const rows = [issue('done', 'done', '5'), issue('open', 'in_progress', '3')]
const scope = { projectId: 'project-a', workspaceSlug: 'alpha' }
const props = { ...scope, initialIssues: rows }

const openSprintCreation = function openSprintCreation(): void {
  render(<SprintManager {...props} initialSprints={[]} />)
  fireEvent.click(screen.getByRole('button', { name: '+ New sprint' }))
}

describe('original SprintManager with TanStack schemas and semantic Effront calls', () => {
  afterEach(cleanup)

  beforeEach(() => {
    request.mockReset()
    nativeSubmitted.mockReset()
    request.mockResolvedValue({ ok: true, value: { ok: true } })
  })

  test('retains a pending native edit across canonical refresh and closes after the result arrives', async () => {
    expect.hasAssertions()
    const pending = Promise.withResolvers<{ ok: true; value: { ok: true } }>()
    request.mockReturnValueOnce(pending.promise)
    const view = render(<SprintManager {...props} initialSprints={[sprint()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Submitted draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save sprint' }))
    await waitFor(() => {
      expect(request).toHaveBeenCalledOnce()
    })
    view.rerender(<SprintManager {...props} initialSprints={[sprint('sprint-a', 'active', 'Canonical refresh')]} />)
    const name = screen.getByLabelText<HTMLInputElement>('Name *')
    expect(name.value).toBe('Submitted draft')
    expect(name.disabled).toBe(true)
    expect(screen.getAllByText('Canonical refresh')).toHaveLength(2)
    await act(async () => {
      pending.resolve({ ok: true, value: { ok: true } })
    })
    await waitFor(() => {
      expect(screen.queryByLabelText('Name *')).toBeNull()
    })
    expect(screen.getAllByText('Canonical refresh')).toHaveLength(2)
    expect(request).toHaveBeenCalledOnce()
  })

  test('releases pending status and archive controls after rejected requests for a safe retry', async () => {
    expect.hasAssertions()
    request.mockRejectedValueOnce(new Error('Status transport failure'))
    render(<SprintManager {...props} initialSprints={[sprint('sprint-a', 'planned')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start sprint' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Status transport failure')
    })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start sprint' }).disabled).toBe(false)
    request.mockRejectedValueOnce(new Error('Archive transport failure'))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, archive' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Archive transport failure')
    })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Yes, archive' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, archive' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Yes, archive' })).toBeNull()
    })
  })

  test('keeps native create drafts and exposes typed failure until a successful retry', async () => {
    expect.hasAssertions()
    request.mockResolvedValueOnce({ message: 'Sprint conflict', ok: false, status: 409 })
    openSprintCreation()
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Retry iteration' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create sprint' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Sprint conflict')
    })
    expect(screen.getByLabelText<HTMLInputElement>('Name *').value).toBe('Retry iteration')
    fireEvent.click(screen.getByRole('button', { name: 'Create sprint' }))
    await waitFor(() => {
      expect(screen.queryByLabelText('Name *')).toBeNull()
    })
    expect(nativeSubmitted.mock.calls[1][0]).toMatchObject({ ok: false, status: 409 })
  })

  test('uses native scoped status links and canonical selected rows without wiping a same-URL draft', () => {
    expect.hasAssertions()
    const planned = sprint('sprint-b', 'planned', 'Planned row')
    const active = sprint()
    const history = sprint('sprint-c', 'completed', 'Historical row')
    const view = render(
      <SprintManager {...props} mode='planned' initialSprints={[planned]} allSprints={[active, planned, history]} />,
    )
    Iterable.forEach(
      [
        ['All', 'all'],
        ['Planned', 'planned'],
        ['Active', 'active'],
        ['History', 'completed'],
      ],
      ([label, status]) => {
        const link = screen.getByRole('link', { name: label })
        const target = new URL(link.getAttribute('href') ?? '', 'https://front.example')
        expect(target.pathname).toBe('/sprints')
        expect(target.searchParams.get('status')).toBe(status)
        expect(target.searchParams.get('projectId')).toBe('project-a')
        expect(target.searchParams.get('workspace')).toBe('alpha')
      },
    )
    expect(screen.getByRole('link', { name: 'Planned' }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('button', { name: 'Complete sprint' })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start sprint' }).disabled).toBe(true)
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
    expect(screen.getByText('Refreshed planned row')).toBeInstanceOf(Element)
    expect(screen.getByLabelText<HTMLInputElement>('Name *').value).toBe('Draft retained')
    expect(request).not.toHaveBeenCalled()
  })

  test('renders canonical SSR issues and velocity without primary browser requests', () => {
    render(<SprintManager {...props} initialSprints={[sprint('sprint-a', 'completed')]} />)
    expect(screen.getByRole('heading', { name: 'Velocity' })).toBeInstanceOf(Element)
    expect(screen.getAllByText('5').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'View issues →' }).getAttribute('href')).toContain('sprintId=sprint-a')
    expect(request).not.toHaveBeenCalled()
  })

  test('adopts same-URL rows without erasing active create fields owned by TanStack', () => {
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
    expect(screen.getByText('Canonical A')).toBeInstanceOf(Element)
    expect(screen.getByText('New server sprint')).toBeInstanceOf(Element)
    expect(screen.getByLabelText<HTMLInputElement>('Name *').value).toBe('Unsaved iteration')
    expect(screen.getByLabelText<HTMLInputElement>('Goal (optional)').value).toBe('Unsaved goal')
  })

  test('preserves edit drafts and sends semantic calendar values plus their original local offsets', async () => {
    expect.hasAssertions()
    const view = render(<SprintManager {...props} initialSprints={[sprint()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Local edit' } })
    fireEvent.change(screen.getByLabelText('Start date (optional)'), {
      target: { value: '2026-10-01' },
    })
    view.rerender(<SprintManager {...props} initialSprints={[sprint('sprint-a', 'active', 'Canonical title')]} />)
    expect(screen.getByLabelText<HTMLInputElement>('Name *').value).toBe('Local edit')
    fireEvent.click(screen.getByRole('button', { name: 'Save sprint' }))
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('edit', {
        ...scope,
        sprintId: 'sprint-a',
        name: 'Local edit',
        goal: 'Ship safely',
        start: '2026-10-01',
        end: '',
        startOffset: calendarOffset('2026-10-01'),
        endOffset: 0,
      })
    })
  })

  test('creates from original fields and lets canonical props, not a {id} response, own the list', async () => {
    expect.hasAssertions()
    request.mockResolvedValueOnce({ ok: true, value: { id: 'created-id' } })
    openSprintCreation()
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: '  Sprint 2 ' } })
    fireEvent.change(screen.getByLabelText('Start date (optional)'), {
      target: { value: '2026-10-04' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create sprint' }))
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('create', {
        ...scope,
        name: '  Sprint 2 ',
        goal: '',
        start: '2026-10-04',
        end: '',
        startOffset: calendarOffset('2026-10-04'),
        endOffset: 0,
      })
    })
    await waitFor(() => {
      expect(screen.queryByLabelText('Name *')).toBeNull()
    })
    expect(nativeSubmitted).toHaveBeenCalledWith(null, expect.any(FormData))
    expect(screen.queryByText('created-id')).toBeNull()
  })

  test('uses shared Standard Schema for whitespace names and reversed dates, without manual validation', async () => {
    expect.hasAssertions()
    openSprintCreation()
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: '   ' } })
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create sprint' }).disabled).toBe(true)
    })
    expect(screen.getByRole('alert').textContent).toContain('Name is required')
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Sprint' } })
    fireEvent.change(screen.getByLabelText('Start date (optional)'), {
      target: { value: '2026-10-04' },
    })
    fireEvent.change(screen.getByLabelText('End date (optional)'), {
      target: { value: '2026-10-01' },
    })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('End date')
    })
    expect(request).not.toHaveBeenCalled()
  })

  test('retains failed completion confirmation and original completed issues/story-point summary', async () => {
    expect.hasAssertions()
    render(<SprintManager {...props} initialSprints={[sprint()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Complete sprint' }))
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce({ message: 'Completion denied', ok: false, status: 403 })
    fireEvent.click(screen.getByRole('button', { name: 'Yes, complete' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Completion denied')
    })
    expect(screen.queryByText('Sprint complete: Sprint A')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, complete' }))
    await waitFor(() => {
      expect(screen.getByText('Sprint complete: Sprint A')).toBeInstanceOf(Element)
    })
    expect(screen.getAllByText('5/8')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Issue done' }).getAttribute('href')).toContain(
      '/projects/PROJ/issues/1/issue-done?workspace=alpha',
    )
    expect(request).toHaveBeenLastCalledWith('status', {
      ...scope,
      sprintId: 'sprint-a',
      status: 'completed',
    })
  })

  test('starts planned sprints, moves the initially selected incomplete issues, and confirms archive', async () => {
    expect.hasAssertions()
    const view = render(
      <SprintManager
        {...props}
        initialSprints={[sprint('sprint-a', 'planned'), sprint('sprint-b', 'planned', 'Destination')]}
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Start sprint' })[0])
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('status', {
        ...scope,
        sprintId: 'sprint-a',
        status: 'active',
      })
    })
    view.rerender(
      <SprintManager {...props} initialSprints={[sprint(), sprint('sprint-b', 'planned', 'Destination')]} />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Move issues' })[0])
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'sprint-b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move 1 issues' }))
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('move', {
        ...scope,
        sprintId: 'sprint-a',
        targetId: 'sprint-b',
        issueIds: ['open'],
      })
    })
    const count = request.mock.calls.length
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0])
    expect(request.mock.calls).toHaveLength(count)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, archive' }))
    await waitFor(() => {
      expect(request).toHaveBeenLastCalledWith('archive', { ...scope, sprintId: 'sprint-a' })
    })
  })

  test('preserves timezone-safe timestamps and original story-point parsing', () => {
    const timestamp = dateInputToUnix('2026-10-04')
    expect(timestamp).not.toBeNull()
    expect(unixToDateInput(timestamp)).toBe('2026-10-04')
    expect(calendarTimestamp('2026-10-04', calendarOffset('2026-10-04'))).toBe(timestamp)
    expect(getStoryPoints(issue('x', 'done', 'no-points'))).toBe(0)
  })
})
