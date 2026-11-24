// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Iterable } from 'effect'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import type { RequestScope } from '@/server/request-context.ts'

import { ProjectNav } from './project-nav.tsx'

const workspace = { id: 'workspace-1', slug: 'team', name: 'Team', role: 'owner' } as const
const project = {
  id: 'project-1',
  name: 'Project',
  key: 'PROJ',
  slug: 'project',
  description: null,
  workspace_id: workspace.id,
  workspace_name: workspace.name,
  workspace_slug: workspace.slug,
  open_issue_count: 0,
  backlog_issue_count: 0,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
}
const scope: RequestScope = {
  user: { id: 'user-1', name: 'User', email: 'user@example.test' },
  workspaces: [workspace],
  projects: [project],
  selection: { kind: 'project', workspace, project },
}
const url = 'https://frontend.test/wiki/page?workspace=team&projectId=project-1'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('covers ProjectNav SSR width fallback', () => {
  test('keeps all scoped native links scrollable before JavaScript runs', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(<ProjectNav scope={scope} url={url} />)
    const nav = container.querySelector('nav')
    expect(nav?.classList.contains('overflow-x-auto')).toBe(true)
    const links = Array.from(nav?.querySelectorAll('a') ?? [])
    expect(links.map((link) => link.textContent)).toStrictEqual([
      'Overview',
      'Issues',
      'Wiki',
      'Sprints',
      'Epics',
      'Metrics',
      'Feedback',
    ])
    Iterable.forEach(links, (link) => {
      const href = new URL(link.getAttribute('href') ?? '', url)
      expect(href.searchParams.get('workspace')).toBe('team')
      expect(href.searchParams.get('projectId')).toBe('project-1')
    })
  })

  test('does not clip the existing More popup after width measurement', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    )
    render(<ProjectNav scope={scope} url={url} />)
    const nav = screen.getByRole('navigation', { name: 'Project sections' })
    expect(nav.classList.contains('overflow-x-auto')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /More/u }))
    expect(screen.getByRole('menu', { name: 'More project sections' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Feedback' })).toBeTruthy()
  })
})
