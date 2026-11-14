// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vite-plus/test'

vi.mock('../legacy/IssueList', () => ({
  default: ({ initialData }: { initialData: IssuesInitialData }) => (
    <ul aria-label='Canonical issues'>
      {initialData.page.items.map((entry) => (
        <li key={entry.id}>{entry.title}</li>
      ))}
    </ul>
  ),
}))

import { issue, project, scope, secondProject, workspace } from '../test/fixtures'
import { IssueReviewNavigation } from './IssueReviewNavigation'
import { type IssuesInitialData, IssuesPage } from './IssuesPage'

afterEach(cleanup)

const route = {
  pathname: '/issues',
  search:
    '?workspace=workspace&projectId=project-a&project=A&q=release+%26+review&cursor=older&view=board&assignee=someone&epic=epic-a&sprintId=sprint-a&review=active',
}

it.each([
  ['All issues', null],
  ['レビュー中', 'in_review'],
  ['修正中', 'fixing'],
  ['要修正', 'changes_requested'],
  ['未完了の対象', 'active'],
] as const)(
  'makes %s a native server navigation that clears pagination and preserves normal query scope',
  (label, review) => {
    render(<IssueReviewNavigation route={route} workspaceSlug={workspace.slug} project={project} />)
    const link = screen.getByRole('link', { name: label })
    const next = new URL(link.getAttribute('href') ?? '', 'https://frontend.test')
    expect(link.tagName).toBe('A')
    expect(next.pathname).toBe('/issues')
    expect(next.searchParams.get('review')).toBe(review)
    expect(next.searchParams.has('cursor')).toBe(false)
    expect(next.searchParams.get('view')).toBe(review ? 'list' : 'board')
    for (const key of ['workspace', 'projectId', 'project', 'q', 'assignee', 'epic', 'sprintId']) {
      expect(next.searchParams.get(key)).toBe(new URLSearchParams(route.search).get(key))
    }
    link.focus()
    expect(document.activeElement).toBe(link)
  },
)

it.each(['backlog', 'board', 'list'])(
  'enters every review filter in paginated list view from %s without retaining a stale cursor',
  (view) => {
    render(
      <IssueReviewNavigation
        route={{ pathname: '/issues', search: `?workspace=workspace&view=${view}&cursor=old` }}
        workspaceSlug={workspace.slug}
        project={null}
      />,
    )
    for (const link of within(screen.getByRole('navigation')).getAllByRole('link')) {
      const url = new URL(link.getAttribute('href') ?? '', 'https://frontend.test')
      expect(url.searchParams.get('view')).toBe(link.textContent === 'All issues' ? view : 'list')
      expect(url.searchParams.has('cursor')).toBe(false)
    }
  },
)

it.each([
  [null, 'All issues'],
  ['in_review', 'レビュー中'],
  ['fixing', '修正中'],
  ['changes_requested', '要修正'],
  ['active', '未完了の対象'],
  ['done', 'All issues'],
  ['unrecognized', 'All issues'],
] as const)('marks only the URL-owned %s filter as the current page', (review, label) => {
  const search = new URLSearchParams({ workspace: workspace.slug })
  if (review) search.set('review', review)
  render(
    <IssueReviewNavigation
      route={{ pathname: '/issues', search: `?${search}` }}
      workspaceSlug={workspace.slug}
      project={null}
    />,
  )
  const navigation = screen.getByRole('navigation', { name: 'レビューステータスで課題を絞り込む' })
  expect(
    within(navigation)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent),
  ).toEqual([label])
})

it('offers cross-project review navigation that cannot inherit project, assignee, epic, sprint or search confinement', () => {
  render(<IssueReviewNavigation route={route} workspaceSlug='team space' project={project} />)
  const link = screen.getByRole('link', { name: '全プロジェクトのレビュー' })
  const url = new URL(link.getAttribute('href') ?? '', 'https://frontend.test')
  expect(url.pathname).toBe('/issues')
  expect(Array.from(url.searchParams.entries())).toEqual([
    ['workspace', 'team space'],
    ['review', 'in_review'],
    ['view', 'list'],
  ])
  expect(screen.getByText('表示範囲: A · Project A')).toBeTruthy()
  expect(screen.queryByText('表示範囲: アクセスできる全プロジェクト')).toBeNull()
})

it('labels the workspace-wide scope prominently and puts reviewing first among the review filters', () => {
  render(
    <IssueReviewNavigation
      route={{ pathname: '/issues', search: '?workspace=workspace' }}
      workspaceSlug={workspace.slug}
      project={null}
    />,
  )
  expect(screen.getByText('表示範囲: アクセスできる全プロジェクト')).toBeTruthy()
  expect(screen.queryByRole('link', { name: '全プロジェクトのレビュー' })).toBeNull()
  const navigation = screen.getByRole('navigation')
  expect(
    within(navigation)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['All issues', 'レビュー中', '修正中', '要修正', '未完了の対象'])
  expect(navigation.className).toContain('flex-wrap')
  for (const link of within(navigation).getAllByRole('link')) {
    expect(link.className).toContain('min-h-[44px]')
    expect(new URL(link.getAttribute('href') ?? '', 'https://frontend.test').searchParams.has('projectId')).toBe(false)
  }
})

it('uses the canonical workspace when the incoming route contains an obsolete workspace selector', () => {
  render(
    <IssueReviewNavigation
      route={{ pathname: '/issues', search: '?workspace=old&projectId=project-a' }}
      workspaceSlug='current'
      project={project}
    />,
  )
  for (const link of screen.getAllByRole('link')) {
    expect(new URL(link.getAttribute('href') ?? '', 'https://frontend.test').searchParams.get('workspace')).toBe(
      'current',
    )
  }
})

it('renders readable scope and complete native review navigation without JavaScript', () => {
  const html = renderToStaticMarkup(
    <IssueReviewNavigation route={route} workspaceSlug={workspace.slug} project={project} />,
  )
  const document = new DOMParser().parseFromString(html, 'text/html')
  expect(document.body.textContent).toContain('表示範囲: A · Project A')
  expect(document.querySelectorAll('nav a')).toHaveLength(5)
  expect(document.querySelector('nav a[aria-current="page"]')?.textContent).toBe('未完了の対象')
  const review = Array.from(document.querySelectorAll('nav a')).find((link) => link.textContent === 'レビュー中')
  expect(new URL(review?.getAttribute('href') ?? '', 'https://frontend.test').searchParams.get('review')).toBe(
    'in_review',
  )
  expect(document.querySelector('button, select')).toBeNull()
})

it('integrates scope and review navigation above canonical cross-project issue results without filtering them in React', () => {
  const initialData: IssuesInitialData = {
    currentUserId: scope.user.id,
    view: 'list',
    page: {
      items: [
        issue({ title: 'Project A result' }),
        issue({ id: 'issue-b', title: 'Project B result', project_id: secondProject.id }),
      ],
    },
    statuses: [],
    taskTypes: [],
    project: null,
    projects: [project, secondProject],
    epics: [],
    sprints: [],
    sprintDetail: null,
    search: { query: '', results: null },
  }
  render(
    <IssuesPage
      scope={scope}
      route={{ pathname: '/issues', search: '?workspace=workspace&review=in_review' }}
      workspaceSlug={workspace.slug}
      initialData={initialData}
    />,
  )
  expect(screen.getByRole('heading', { name: 'Issues' })).toBeTruthy()
  expect(screen.getByText('表示範囲: アクセスできる全プロジェクト')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'レビュー中' }).getAttribute('aria-current')).toBe('page')
  expect(
    within(screen.getByRole('list', { name: 'Canonical issues' }))
      .getAllByRole('listitem')
      .map((entry) => entry.textContent),
  ).toEqual(['Project A result', 'Project B result'])
})
