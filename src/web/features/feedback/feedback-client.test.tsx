// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { navigateFeature } from '../wiki/navigation'
import { createFeedbackSource, markFeedbackReviewed, revokeFeedbackSource, rotateFeedbackSourceToken } from './actions'
import FeedbackList, { type Feedback } from './FeedbackList'
import FeedbackSourceDetail from './FeedbackSourceDetail'
import FeedbackSourceSettings, { type FeedbackSource } from './FeedbackSourceSettings'
import NewSourceModal from './NewSourceModal'

vi.mock('../wiki/navigation', () => ({ navigateFeature: vi.fn() }))

vi.mock('./actions', () => ({
  markFeedbackReviewed: vi.fn(),
  revokeFeedbackSource: vi.fn(),
  rotateFeedbackSourceToken: vi.fn(),
  setFeedbackSourceActive: vi.fn(),
  createFeedbackSource: vi.fn(),
  convertFeedbackToIssue: vi.fn(),
  markSelectedFeedbackReviewed: vi.fn(),
  convertSelectedFeedbackToIssue: vi.fn(),
}))
const row: Feedback = {
  id: 'row',
  sourceId: 'source',
  sourceName: null,
  rating: 5,
  ratingScale: 'five_star',
  body: 'Useful feedback',
  submitterLabel: 'Customer',
  sourceUrl: 'https://example.test/page?screen=home',
  appVersion: 'v1',
  status: 'new',
  linkedIssueId: null,
  createdAt: 1,
}
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
const source: FeedbackSource = {
  id: 'source',
  name: 'Customer feedback',
  description: null,
  isActive: true,
  allowedOrigins: null,
  tokenPreview: 'pk_...',
  createdAt: 1,
  revokedAt: null,
}
describe('Feedback hydrated original controls', () => {
  it('creates a source through native action-state FormData and retains its one-time token across refresh', async () => {
    vi.mocked(createFeedbackSource).mockResolvedValue({
      ok: true,
      value: { id: 'source', token: 'new-token' },
    })
    const view = render(<NewSourceModal workspaceSlug='team' projectId='project' onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'New source' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Notes' } })
    const form = screen.getByRole('dialog', { name: 'New feedback source' }).querySelector('form')
    if (!form) throw new Error('Missing native source form')
    fireEvent.submit(form)
    expect(await screen.findByText('new-token')).toBeTruthy()
    const [previous, data] = vi.mocked(createFeedbackSource).mock.calls[0]
    expect(previous).toBeNull()
    expect(data.get('workspaceSlug')).toBe('team')
    expect(data.get('projectId')).toBe('project')
    expect(data.get('name')).toBe('New source')
    expect(data.get('description')).toBe('Notes')
    view.rerender(<NewSourceModal workspaceSlug='team' projectId='project' onClose={vi.fn()} />)
    expect(screen.getByText('new-token')).toBeTruthy()
  })
  it('navigates status through the URL and waits for canonical server status props', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    const view = render(<FeedbackList workspaceSlug='team' projectId='project' sourceId='source' initialRows={[row]} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    const option = await screen.findByRole('option', { name: 'Reviewed' })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option)
    await waitFor(() =>
      expect(navigateFeature).toHaveBeenLastCalledWith(
        '/feedback/source?projectId=project&tab=items&workspace=team&status=reviewed',
      ),
    )
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toContain('All')
    view.rerender(
      <FeedbackList
        workspaceSlug='team'
        projectId='project'
        sourceId='source'
        initialRows={[{ ...row, status: 'reviewed' }]}
        initialStatus='reviewed'
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toContain('Reviewed')
  })
  it('validates source configuration through TanStack before sending a semantic create action', async () => {
    render(<NewSourceModal workspaceSlug='team' projectId='project' onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'New source' } })
    fireEvent.change(screen.getByLabelText('Allowed origins (one per line, optional)'), {
      target: { value: 'a'.repeat(2001) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create source' }))
    expect(await screen.findByText('Enter at most 50 origins, each at most 2000 characters.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create source' }).hasAttribute('disabled')).toBe(true)
    expect(createFeedbackSource).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('New source')
  })
  it('preserves original Arrow/Home/End roving tab keyboard behavior', () => {
    const view = render(
      <FeedbackSourceDetail
        workspaceSlug='team'
        projectId='project'
        initialSource={source}
        initialSources={[source]}
        initialRows={[row]}
        initialSummary={null}
      />,
    )
    const items = screen.getByRole('tab', { name: 'Items' })
    items.focus()
    fireEvent.keyDown(items, { key: 'ArrowRight' })
    expect(navigateFeature).toHaveBeenLastCalledWith('/feedback/source?projectId=project&workspace=team&tab=summary')
    expect(screen.getByRole('tab', { name: 'Items' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Summary' }))
    view.rerender(
      <FeedbackSourceDetail
        workspaceSlug='team'
        projectId='project'
        initialSource={source}
        initialSources={[source]}
        initialRows={[row]}
        initialSummary={null}
        initialTab='summary'
      />,
    )
    expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'End' })
    expect(navigateFeature).toHaveBeenLastCalledWith('/feedback/source?projectId=project&workspace=team&tab=settings')
    expect(screen.getByRole('tab', { name: 'Settings' }).getAttribute('href')).toContain('tab=settings')
    expect(revokeFeedbackSource).not.toHaveBeenCalled()
    expect(rotateFeedbackSourceToken).not.toHaveBeenCalled()
  })
  it('does not revoke a source when its danger confirmation is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<FeedbackSourceSettings workspaceSlug='team' projectId='project' source={source} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke source' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(revokeFeedbackSource).not.toHaveBeenCalled()
    expect(rotateFeedbackSourceToken).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate token' }))
    expect(screen.getByText('Rotate? Old token dies.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(revokeFeedbackSource).not.toHaveBeenCalled()
    expect(rotateFeedbackSourceToken).not.toHaveBeenCalled()
  })
  it('renders initial rows without client bootstrap and expands original URL context in both responsive trees', () => {
    render(<FeedbackList workspaceSlug='team' projectId='project' sourceId='source' initialRows={[row]} />)
    expect(revokeFeedbackSource).not.toHaveBeenCalled()
    expect(rotateFeedbackSourceToken).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByText('Context (1)')[0])
    expect(screen.getAllByText('screen: home')).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: row.sourceUrl ?? '' })[0].getAttribute('rel')).toBe(
      'noopener noreferrer',
    )
  })
  it('updates reviewed status optimistically and rolls back a failed mutation', async () => {
    let reject!: (cause: Error) => void
    vi.mocked(markFeedbackReviewed).mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    render(<FeedbackList workspaceSlug='team' projectId='project' sourceId='source' initialRows={[row]} />)
    fireEvent.click(screen.getAllByText('Mark reviewed')[0])
    expect(screen.getAllByText('reviewed').length).toBeGreaterThan(0)
    await act(async () => {
      reject(new Error('Denied'))
    })
    expect(screen.getAllByText('new').length).toBeGreaterThan(0)
    expect(screen.getByRole('alert').textContent).toContain('Denied')
  })
  it('adopts refreshed row DTOs in-place', () => {
    const view = render(<FeedbackList workspaceSlug='team' projectId='project' sourceId='source' initialRows={[row]} />)
    view.rerender(
      <FeedbackList
        workspaceSlug='team'
        projectId='project'
        sourceId='source'
        initialRows={[{ ...row, body: 'Refreshed feedback' }]}
      />,
    )
    expect(screen.getAllByText('Refreshed feedback').length).toBeGreaterThan(0)
    expect(revokeFeedbackSource).not.toHaveBeenCalled()
    expect(rotateFeedbackSourceToken).not.toHaveBeenCalled()
  })
})
