// @vitest-environment jsdom
import './test/browser.ts'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vite-plus/test'

import { JSON_NULL } from '#tests/json-null.ts'

import { createIssue, readIssuePage, searchIssues, updateIssue } from './actions.ts'
import { IssueBulkProvider, IssueSelectionControl } from './components/issue-list/bulk-actions.tsx'
import { useSavedViews } from './components/issue-list/use-saved-views.ts'
import type { SavedViewFilters } from './components/saved-views.ts'
import { comment, issue, project, scope, secondProject, statuses, taskTypes, workspace } from './test/fixtures.ts'
import { useUnsavedUnloadGuard } from './utils/use-unsaved-unload-guard.ts'
import { EpicsPage } from './views/epics-page.tsx'
import type { EpicsInitialData } from './views/epics-page.tsx'
import { IssueDetailPage } from './views/issue-detail-page.tsx'
import type { IssueDetailInitialData } from './views/issue-detail-page.tsx'
import { IssuesPage } from './views/issues-page.tsx'
import type { IssuesInitialData } from './views/issues-page.tsx'

vi.mock(import('./components/lazy-markdown-editor.tsx'), () => ({
  IssueMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label='Markdown editor'
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value)
      }}
    />
  ),
}))
const listData = function listData(): IssuesInitialData {
  return {
    currentUserId: scope.user.id,
    view: 'list',
    page: { items: [issue()], nextCursor: JSON_NULL, total: 1 },
    statuses,
    taskTypes,
    project: JSON_NULL,
    projects: [project, secondProject],
    epics: [],
    sprints: [],
    sprintDetail: JSON_NULL,
    search: { query: '', results: JSON_NULL },
  }
}
const detailData = function detailData(): IssueDetailInitialData {
  return {
    issue: issue(),
    comments: [comment],
    links: [],
    attachments: [],
    statuses,
    taskTypes,
    members: [scope.user],
    parent: JSON_NULL,
    children: [],
    currentUserId: scope.user.id,
  }
}
describe('canonical issues SSR refresh', () => {
  test('updates loaded rows and lookups without mount fetching or losing an unsaved create form', async () => {
    expect.hasAssertions()
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const route = { pathname: '/issues', search: '?workspace=workspace' }
    const data = listData()
    const view = render(<IssuesPage scope={scope} route={route} workspaceSlug={workspace.slug} initialData={data} />)
    fireEvent.click(screen.getByRole('button', { name: /New issue/u }))
    const dialog = screen.getByRole('dialog', { name: 'Create new issue' })
    const title = within(dialog).getByPlaceholderText('Issue title')
    fireEvent.input(title, { target: { value: 'Unsaved create title' } })
    view.rerender(
      <IssuesPage
        scope={scope}
        route={route}
        workspaceSlug={workspace.slug}
        initialData={{
          ...data,
          page: {
            items: [issue({ id: 'issue-b', title: 'Canonical replacement' })],
            nextCursor: JSON_NULL,
            total: 1,
          },
          statuses: [
            ...statuses,
            { id: 'review', key: 'review', name: 'Review', category: 'started', color: JSON_NULL },
          ],
        }}
      />,
    )
    await waitFor(() => expect(screen.getAllByText('Canonical replacement').length).toBeGreaterThan(0))
    expect(within(screen.getByRole('dialog')).getByPlaceholderText<HTMLInputElement>('Issue title').value).toBe(
      'Unsaved create title',
    )
    expect(screen.queryByText('Original issue')).toBeNull()
    // Effront can publish canonical props before the creation proxy resolves.
    // A late mutation completion must never replace authoritative SSR rows.
    vi.mocked(createIssue).mockResolvedValueOnce({ ok: true, value: { id: 'issue-b', number: 1 } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create issue' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(screen.getAllByText('Canonical replacement').length).toBeGreaterThan(0)
    expect(screen.queryByText('Unsaved create title')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  test('updates authoritative description and comments while preserving unsaved title editing', async () => {
    expect.hasAssertions()
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    sessionStorage.clear()
    const data = detailData()
    const view = render(<IssueDetailPage scope={scope} workspaceSlug={workspace.slug} initialData={data} />)
    fireEvent.click(screen.getByTitle('Edit title'))
    const title = screen.getByDisplayValue('Original issue')
    fireEvent.input(title, { target: { value: 'Unsaved edited title' } })
    view.rerender(
      <IssueDetailPage
        scope={scope}
        workspaceSlug={workspace.slug}
        initialData={{
          ...data,
          issue: issue({ title: 'Server canonical title', body: '**Canonical description**' }),
          comments: [{ ...comment, body: 'Canonical comment' }],
        }}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('Canonical description')).toBeInstanceOf(Element)
    })
    expect(screen.getByText('Canonical comment')).toBeInstanceOf(Element)
    expect(screen.getByDisplayValue('Unsaved edited title')).toBeInstanceOf(Element)
    fireEvent.input(screen.getByPlaceholderText('Add a comment…'), {
      target: { value: 'Private unsent comment' },
    })
    view.rerender(
      <IssueDetailPage
        scope={{ ...scope, user: { ...scope.user, id: 'user-b' } }}
        workspaceSlug={workspace.slug}
        initialData={{ ...data, currentUserId: 'user-b' }}
      />,
    )
    await waitFor(() => {
      expect(screen.getByPlaceholderText<HTMLTextAreaElement>('Add a comment…').value).toBe('')
    })
    view.rerender(<IssueDetailPage scope={scope} workspaceSlug={workspace.slug} initialData={data} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('Private unsent comment')).toBeInstanceOf(Element)
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  test('renders canonical refreshed epics after creation without any browser primary query', async () => {
    expect.hasAssertions()
    const initialData: EpicsInitialData = {
      page: {
        items: [issue({ type_key: 'epic', type_id: 'epic-type' })],
        nextCursor: JSON_NULL,
        total: 1,
      },
      statuses,
      taskTypes,
      project,
      projects: [project],
      search: '?workspace=workspace&projectId=project-a',
    }
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    vi.mocked(createIssue).mockResolvedValue({ ok: true, value: { id: 'created', number: 2 } })
    const view = render(
      <EpicsPage
        scope={{ ...scope, selection: { kind: 'project', workspace, project } }}
        workspaceSlug={workspace.slug}
        initialData={initialData}
      />,
    )
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /New Epic/u }))
    fireEvent.input(screen.getByPlaceholderText('Epic title'), {
      target: { value: 'Created epic' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Epic' }))
    await waitFor(() => {
      expect(createIssue).toHaveBeenCalledOnce()
    })
    view.rerender(
      <EpicsPage
        scope={{ ...scope, selection: { kind: 'project', workspace, project } }}
        workspaceSlug={workspace.slug}
        initialData={{
          ...initialData,
          page: {
            items: [
              issue({ id: 'epic-first', title: 'First refreshed epic', type_key: 'epic' }),
              issue({ id: 'epic-last', title: 'Last refreshed epic', type_key: 'epic' }),
            ],
            nextCursor: JSON_NULL,
            total: 2,
          },
        }}
      />,
    )
    expect(screen.getAllByText('Last refreshed epic').length).toBeGreaterThan(0)
    expect(screen.getAllByText('First refreshed epic').length).toBeGreaterThan(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(readIssuePage).not.toHaveBeenCalled()
  })

  test('submits canonical search and cursor GET navigation with all authorized selectors and no primary query', async () => {
    expect.hasAssertions()
    const route = {
      pathname: '/issues',
      search: '?workspace=workspace&projectId=project-a&status=todo&cursor=previous&tag=one&tag=one&tag=two',
    }
    const data = listData()
    const view = render(
      <IssuesPage
        scope={scope}
        route={route}
        workspaceSlug={workspace.slug}
        initialData={{ ...data, page: { ...data.page, nextCursor: 'next-page' } }}
      />,
    )
    const submissions: { method: string; action: string; values: FormData }[] = []
    view.container.addEventListener('submit', (event) => {
      event.preventDefault()
      const form = event.target as HTMLFormElement
      submissions.push({
        method: form.method,
        action: form.getAttribute('action') ?? '',
        values: new FormData(form),
      })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(submissions[0].method).toBe('get')
    expect(submissions[0].action).toBe('/issues')
    expect(submissions[0].values.get('cursor')).toBe('next-page')
    expect(submissions[0].values.get('workspace')).toBe(workspace.slug)
    expect(submissions[0].values.get('projectId')).toBe(project.id)
    expect(submissions[0].values.get('status')).toBe('todo')
    expect(submissions[0].values.getAll('tag')).toStrictEqual(['one', 'one', 'two'])
    fireEvent.input(screen.getByRole('searchbox', { name: 'Search issues' }), {
      target: { value: 'Canonical term' },
    })
    await waitFor(() => {
      expect(submissions).toHaveLength(2)
    })
    expect(submissions[1].values.get('q')).toBe('Canonical term')
    expect(submissions[1].values.has('cursor')).toBe(false)
    expect(submissions[1].values.get('workspace')).toBe(workspace.slug)
    expect(submissions[1].values.get('projectId')).toBe(project.id)
    expect(submissions[1].values.getAll('tag')).toStrictEqual(['one', 'one', 'two'])
    expect(screen.getAllByText('Original issue').length).toBeGreaterThan(0)
    expect(readIssuePage).not.toHaveBeenCalled()
    expect(searchIssues).not.toHaveBeenCalled()
  })

  test('scopes named views per user and workspace, applying only on explicit interaction', async () => {
    sessionStorage.clear()
    localStorage.clear()
    const onApply = vi.fn<(filters: SavedViewFilters) => void>()
    const filters: SavedViewFilters = {
      statuses: ['todo'],
      priorities: [],
      project: '',
      type: '',
      epicId: '',
      sprintId: '',
      hideEpics: false,
      dateField: '',
      dateFrom: '',
      dateTo: '',
    }
    const hook = renderHook(({ userId, workspaceSlug }) => useSavedViews('', filters, onApply, workspaceSlug, userId), {
      initialProps: { userId: 'user-a', workspaceSlug: 'workspace' },
    })
    act(() => hook.result.current.setSaveViewName('Personal'))
    await act(async () => {
      await hook.result.current.doSaveView()
    })
    expect(hook.result.current.savedViews).toHaveLength(1)
    expect(onApply).not.toHaveBeenCalled()
    expect(localStorage).toHaveLength(0)
    expect(sessionStorage.key(0)).toContain('user-a:workspace:')
    act(() => hook.result.current.applyView(hook.result.current.savedViews[0]))
    expect(onApply).toHaveBeenCalledWith(filters)
    hook.rerender({ userId: 'user-b', workspaceSlug: 'workspace' })
    expect(hook.result.current.savedViews).toHaveLength(0)
    hook.rerender({ userId: 'user-a', workspaceSlug: 'other' })
    expect(hook.result.current.savedViews).toHaveLength(0)
    hook.rerender({ userId: 'user-a', workspaceSlug: 'workspace' })
    expect(hook.result.current.savedViews).toHaveLength(1)
    act(() => hook.result.current.deleteView('Personal'))
    expect(hook.result.current.savedViews).toHaveLength(0)
  })

  test('uses native unload protection only while edits are dirty', () => {
    const hook = renderHook(({ dirty }) => useUnsavedUnloadGuard(dirty), {
      initialProps: { dirty: false },
    })
    const clean = new Event('beforeunload', { cancelable: true })
    globalThis.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    hook.rerender({ dirty: true })
    const dirty = new Event('beforeunload', { cancelable: true })
    globalThis.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    hook.rerender({ dirty: false })
    const saved = new Event('beforeunload', { cancelable: true })
    globalThis.dispatchEvent(saved)
    expect(saved.defaultPrevented).toBe(false)
  })

  test('applies bulk status changes through scoped mutations and refreshes canonical results', async () => {
    expect.hasAssertions()
    vi.mocked(updateIssue).mockResolvedValue({ ok: true, value: { ok: true } })
    const selected = issue()
    render(
      <IssueBulkProvider issues={[selected]} statuses={statuses} workspaceSlug={workspace.slug}>
        <IssueSelectionControl issue={selected} />
      </IssueBulkProvider>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select A-1' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Bulk status' }))
    const option = await screen.findByRole('option', { name: 'Done' })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option)
    await waitFor(() => {
      expect(updateIssue).toHaveBeenCalledOnce()
    })
    expect(readIssuePage).not.toHaveBeenCalled()
    expect(updateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'issue-a',
        workspaceSlug: workspace.slug,
        patch: { statusId: 'done' },
      }),
    )
  })
})
