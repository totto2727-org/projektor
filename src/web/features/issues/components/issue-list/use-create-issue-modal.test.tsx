// @vitest-environment jsdom
import '@/features/issues/test/browser.ts'
// Native ActionState keeps typed server failures in the open form without discarding its TanStack draft.
// Unexpected browser transport failures belong to the root React error boundary.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { JSX } from 'react'
import { describe, expect, test, vi } from 'vite-plus/test'

import { createIssue } from '@/features/issues/actions.ts'

import CreateIssueModal from './create-issue-modal.tsx'
import { useCreateIssueModal } from './use-create-issue-modal.ts'

const PROJECTS = [{ id: 'p1', key: 'PROJ', name: 'Projektor', description: null, workspace_slug: 'test-workspace' }]

const Harness = function Harness(): JSX.Element {
  const modal = useCreateIssueModal({
    filterProject: '',
    projects: PROJECTS,
  })
  return (
    <>
      <button type='button' onClick={modal.openCreateModal}>
        New issue
      </button>
      {modal.showCreateModal && <CreateIssueModal {...modal} projects={PROJECTS} taskTypes={[]} statuses={[]} />}
    </>
  )
}

const submitCreateForm = async function submitCreateForm(): Promise<void> {
  const submit = screen.getByRole('button', { name: /create issue/i })
  await waitFor(() => expect(submit).toHaveProperty('disabled', false))
  fireEvent.click(submit)
}

describe('useCreateIssueModal native ActionState failures', () => {
  test('keeps the entered draft when the server reports backend unavailability', async () => {
    vi.mocked(createIssue).mockResolvedValueOnce({
      ok: false,
      status: 502,
      message: 'The API is currently unreachable.',
    })

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'New issue' }))
    fireEvent.input(screen.getByPlaceholderText('Issue title'), {
      target: { value: 'Fix the thing' },
    })
    await submitCreateForm()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/API is currently unreachable/i)
    expect((screen.getByPlaceholderText('Issue title') as HTMLInputElement).value).toBe('Fix the thing')
    const formData = vi.mocked(createIssue).mock.calls[0][1]
    expect(formData.get('title')).toBe('Fix the thing')
    expect(formData.get('projectId')).toBe('p1')
    expect(formData.get('priority')).toBe('medium')
  })

  test('shows a generic message for a non-offline (HTTP) failure', async () => {
    vi.mocked(createIssue).mockResolvedValueOnce({
      ok: false,
      status: 500,
      message: 'Request failed',
    })

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'New issue' }))
    fireEvent.input(screen.getByPlaceholderText('Issue title'), {
      target: { value: 'Fix the thing' },
    })
    await submitCreateForm()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/failed to create issue/i)
    expect(alert.textContent).not.toMatch(/you're offline/i)
  })

  test('clears a previous failure when reopening and displays a new failed attempt', async () => {
    vi.mocked(createIssue)
      .mockResolvedValueOnce({ ok: false, status: 500, message: 'First attempt failed' })
      .mockResolvedValueOnce({ ok: false, status: 502, message: 'Second attempt failed' })

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'New issue' }))
    fireEvent.input(screen.getByPlaceholderText('Issue title'), { target: { value: 'First draft' } })
    await submitCreateForm()
    const element = await screen.findByRole('alert')
    expect(element.textContent).toContain('First attempt failed')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'New issue' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByPlaceholderText('Issue title') as HTMLInputElement).value).toBe('')
    fireEvent.input(screen.getByPlaceholderText('Issue title'), { target: { value: 'Second draft' } })
    await submitCreateForm()
    const targetElement = await screen.findByRole('alert')
    expect(targetElement.textContent).toContain('Second attempt failed')
    expect((screen.getByPlaceholderText('Issue title') as HTMLInputElement).value).toBe('Second draft')
  })
})
