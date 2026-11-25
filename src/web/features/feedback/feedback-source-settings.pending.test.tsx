// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, afterEach, expect, test, vi } from 'vite-plus/test'

import { JSON_NULL } from '#tests/json-null.ts'

import { rotateFeedbackSourceToken } from './actions.ts'
import { FeedbackSourceSettings } from './feedback-source-settings.tsx'

vi.mock('./actions', () => ({
  rotateFeedbackSourceToken: vi.fn(),
  revokeFeedbackSource: vi.fn(),
  setFeedbackSourceActive: vi.fn(),
}))

// The transport is deferred so repeated confirmation arrives before completion.
describe('covers feedback source actions in progress', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  test('single-flights rapid rotation confirmation and reveals only its resulting token', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof rotateFeedbackSourceToken>>>()
    vi.mocked(rotateFeedbackSourceToken).mockReturnValue(pending.promise)
    render(
      <FeedbackSourceSettings
        projectId='project'
        source={{
          id: 'source',
          name: 'Source',
          description: JSON_NULL,
          isActive: true,
          allowedOrigins: JSON_NULL,
          tokenPreview: 'old…',
          createdAt: 1,
          revokedAt: JSON_NULL,
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
    expect(screen.getByText('new-token')).toBeInstanceOf(Element)
    expect(screen.queryByRole('button', { name: 'Rotating…' })).toBeNull()
  })

  test('releases rotation confirmation after a failure so a deliberate retry can succeed', async () => {
    vi.mocked(rotateFeedbackSourceToken).mockRejectedValueOnce(new Error('Unavailable'))
    vi.mocked(rotateFeedbackSourceToken).mockResolvedValueOnce({ ok: true, value: { token: 'retry-token' } })
    render(
      <FeedbackSourceSettings
        projectId='project'
        source={{
          id: 'source',
          name: 'Source',
          description: JSON_NULL,
          isActive: true,
          allowedOrigins: JSON_NULL,
          tokenPreview: 'old…',
          createdAt: 1,
          revokedAt: JSON_NULL,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rotate token' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes' })))
    expect(screen.getByRole('alert').textContent).toContain('Unavailable')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes' })))
    expect(screen.getByText('retry-token')).toBeInstanceOf(Element)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
