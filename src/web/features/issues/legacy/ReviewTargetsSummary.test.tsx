// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import type { ReviewTarget } from '../../../../contracts/review-targets'
import { issue } from '../test/fixtures'
import { ReviewTargetsSummary } from './ReviewTargetsSummary'

afterEach(cleanup)

function target(overrides: Partial<ReviewTarget> = {}): ReviewTarget {
  return {
    id: 'reference',
    kind: 'url',
    filename: 'Reference',
    url: 'https://example.test',
    status: 'fixing',
    ...overrides,
  }
}

describe('issue review target summary', () => {
  it('always displays an unconfigured link, including server-rendered HTML', () => {
    const value = { ...issue(), workspaceSlug: 'team space' }
    render(<ReviewTargetsSummary issue={value} />)
    const link = screen.getByRole('link', { name: 'Review targets: 対象なし' })
    const url = new URL(link.getAttribute('href') ?? '', 'https://front.test')
    expect(url.searchParams.get('workspace')).toBe('team space')
    expect(url.searchParams.get('tab')).toBe('review-targets')
    expect(renderToStaticMarkup(<ReviewTargetsSummary issue={value} />)).toContain('対象なし')
  })

  it('prioritizes a reviewing target over earlier attachments and shows the remaining count', () => {
    const targets = Object.freeze([
      target(),
      target({ id: 'review', filename: 'Review this', status: 'in_review' }),
      target({ id: 'done', filename: 'Completed', status: 'done' }),
    ])
    render(<ReviewTargetsSummary issue={{ ...issue(), reviewTargets: targets }} />)
    const link = screen.getByRole('link', { name: 'Review targets: Review this +1 (レビュー中)' })
    expect(link.textContent).toContain('+1')
    expect(screen.queryByText('Completed')).toBeNull()
    expect(link.className).toContain('border-accent')
    expect(screen.queryByText('レビュー不要')).toBeNull()
    expect(targets.map((entry) => entry.id)).toEqual(['reference', 'review', 'done'])
  })

  it.each([
    ['fixing', '修正中'],
    ['changes_requested', '要修正'],
  ] as const)('shows %s as not ready for review through text and a muted treatment', (status, label) => {
    render(<ReviewTargetsSummary issue={{ ...issue(), reviewTargets: [target({ status })] }} />)
    const link = screen.getByRole('link', { name: `Review targets: Reference (${label})` })
    expect(link.textContent).toContain('レビュー不要')
    expect(link.className).toContain('text-text-muted')
    expect(screen.queryByText(/^\+\d+$/)).toBeNull()
  })

  it('preserves fallback issue and workspace identity when opening the focused page', () => {
    render(<ReviewTargetsSummary issue={{ ...issue(), id: 'id /?', project_key: null, workspaceSlug: 'other' }} />)
    const url = new URL(screen.getByRole('link').getAttribute('href') ?? '', 'https://front.test')
    expect(url.pathname).toBe('/issues/view')
    expect(url.searchParams.get('id')).toBe('id /?')
    expect(url.searchParams.get('workspace')).toBe('other')
    expect(url.searchParams.get('tab')).toBe('review-targets')
  })

  it('marks a mixture of fixing and changes requested as review not needed', () => {
    render(
      <ReviewTargetsSummary
        issue={{ ...issue(), reviewTargets: [target(), target({ id: 'changes', status: 'changes_requested' })] }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Review targets: Reference +1 (修正中)' })
    expect(link.textContent).toContain('レビュー不要')
    expect(link.className).not.toContain('border-accent')
  })

  it('hides completed targets entirely, including their names, statuses and counts', () => {
    render(
      <ReviewTargetsSummary
        issue={{ ...issue(), reviewTargets: [target({ filename: 'Hidden completion', status: 'done' })] }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Review targets: 対象なし' })
    expect(link.textContent).not.toContain('Hidden completion')
    expect(link.textContent).not.toContain('完了')
    expect(screen.queryByText(/^\+\d+$/)).toBeNull()
  })
})
