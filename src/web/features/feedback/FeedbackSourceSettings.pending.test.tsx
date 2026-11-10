// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vite-plus/test'

vi.mock('./actions', () => ({
  rotateFeedbackSourceToken: vi.fn(),
  revokeFeedbackSource: vi.fn(),
  setFeedbackSourceActive: vi.fn(),
}))

import { rotateFeedbackSourceToken } from './actions'
import FeedbackSourceSettings from './FeedbackSourceSettings'

// The transport is deferred so repeated confirmation arrives before completion.
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('single-flights rapid rotation confirmation and reveals only its resulting token', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof rotateFeedbackSourceToken>>>()
  vi.mocked(rotateFeedbackSourceToken).mockReturnValue(pending.promise)
  render(
    <FeedbackSourceSettings
      projectId='project'
      source={{
        id: 'source',
        name: 'Source',
        description: null,
        isActive: true,
        allowedOrigins: null,
        tokenPreview: 'old…',
        createdAt: 1,
        revokedAt: null,
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Rotate token' }))
  const confirm = screen.getByRole('button', { name: 'Yes' })
  act(() => {
    confirm.click()
    confirm.click()
  })
  expect(rotateFeedbackSourceToken).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Rotating…' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: 'No' }).hasAttribute('disabled')).toBe(true)
  await act(async () => pending.resolve({ ok: true, value: { token: 'new-token' } }))
  expect(screen.getByText('new-token')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Rotating…' })).toBeNull()
})

it('releases rotation confirmation after a failure so a deliberate retry can succeed', async () => {
  vi.mocked(rotateFeedbackSourceToken).mockRejectedValueOnce(new Error('Unavailable'))
  vi.mocked(rotateFeedbackSourceToken).mockResolvedValueOnce({ ok: true, value: { token: 'retry-token' } })
  render(
    <FeedbackSourceSettings
      projectId='project'
      source={{
        id: 'source',
        name: 'Source',
        description: null,
        isActive: true,
        allowedOrigins: null,
        tokenPreview: 'old…',
        createdAt: 1,
        revokedAt: null,
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Rotate token' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes' })))
  expect(screen.getByRole('alert').textContent).toContain('Unavailable')
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes' })))
  expect(screen.getByText('retry-token')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})
