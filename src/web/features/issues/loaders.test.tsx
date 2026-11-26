import { Iterable, Effect, Result, Schema } from 'effect'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { ApiResults } from '#contracts/api-results.ts'
import { SearchResultsSchema } from '#contracts/web-schemas/issue-actions.ts'
import { AttachmentSchema, IssueSchema, normalizeAttachments } from '#contracts/web-schemas/issues.ts'
import { runInOrder } from '#tests/run-effect.ts'
import type * as AttachmentActions from '@/attachment-actions.ts'
import { ApiError, ScopeError } from '@/server/errors.ts'
import type { RequestScope } from '@/server/request-context.ts'

import type * as Actions from './actions.ts'
import { readDataIssuePage, searchDataIssues } from './data.ts'
import {
  filteredIssueQuery,
  loadEpics,
  loadIssue,
  loadIssues,
  loadMyIssues,
  renderIssue,
  renderIssues,
  renderMyIssues,
} from './server.tsx'
import { issueDataFixture } from './test/data-fixture.ts'
import { issue, project, scope, secondProject, taskTypes, workspace } from './test/fixtures.ts'

const decodeAttachment = Schema.decodeUnknownResult(AttachmentSchema)

vi.mock('../../attachment-actions', () => ({
  uploadAttachment: vi.fn<typeof AttachmentActions.uploadAttachment>(),
  uploadInlineImage: vi.fn<typeof AttachmentActions.uploadInlineImage>(),
}))
vi.mock('./actions', () => ({
  createIssue: vi.fn<typeof Actions.createIssue>(),
  updateIssue: vi.fn<typeof Actions.updateIssue>(),
  readIssue: vi.fn<typeof Actions.readIssue>(),
  readIssuePage: vi.fn<typeof Actions.readIssuePage>(),
  searchIssues: vi.fn<typeof Actions.searchIssues>(),
  readComments: vi.fn<typeof Actions.readComments>(),
  addComment: vi.fn<typeof Actions.addComment>(),
  editComment: vi.fn<typeof Actions.editComment>(),
  deleteComment: vi.fn<typeof Actions.deleteComment>(),
  readLinks: vi.fn<typeof Actions.readLinks>(),
  addIssueLink: vi.fn<typeof Actions.addIssueLink>(),
  deleteIssueLink: vi.fn<typeof Actions.deleteIssueLink>(),
  shareIssue: vi.fn<typeof Actions.shareIssue>(),
  readAttachments: vi.fn<typeof Actions.readAttachments>(),
  addAttachmentLink: vi.fn<typeof Actions.addAttachmentLink>(),
  deleteAttachment: vi.fn<typeof Actions.deleteAttachment>(),
  setAttachmentReviewStatus: vi.fn<typeof Actions.setAttachmentReviewStatus>(),
  searchWikiAttachments: vi.fn<typeof Actions.searchWikiAttachments>(),
  updateSprint: vi.fn<typeof Actions.updateSprint>(),
}))
const databases: ReturnType<typeof issueDataFixture>[] = []
const fixture = function fixture() {
  const data = issueDataFixture()
  databases.push(data)
  return data
}
const selected: RequestScope = { ...scope, selection: { kind: 'project', workspace, project } }
const listUrl = new URL('https://front.test/issues?workspace=workspace')
const detailUrl = new URL('https://front.test/issues/view?id=issue-a&workspace=workspace')

const expectRenderedText = function expectRenderedText(html: string, fragments: Readonly<string[]>): void {
  expect(fragments.filter((fragment) => !html.includes(fragment))).toStrictEqual([])
}

const expectHiddenText = function expectHiddenText(html: string, fragments: Readonly<string[]>): void {
  expect(fragments.filter((fragment) => html.includes(fragment))).toStrictEqual([])
}

describe('complete direct D1 issues SSR loaders', () => {
  afterEach(() => {
    Iterable.forEach(databases.splice(0), (data) => {
      data.close()
    })
  })

  test('requires an explicit nullable review status in API and Web attachment replies', () => {
    expect.hasAssertions()
    const attachment = {
      id: 'file',
      kind: 'file' as const,
      filename: 'review.pdf',
      contentType: 'application/pdf',
      size: 1,
      url: null,
      createdAt: 1,
      reviewStatus: null,
      wikiPage: null,
    }
    Iterable.forEach([null, 'fixing', 'in_review', 'changes_requested', 'done'], (reviewStatus) => {
      const value = { ...attachment, reviewStatus }
      expect(Schema.is(AttachmentSchema)(value)).toBe(true)
      expect(Schema.is(ApiResults.apiGetAttachment)(value)).toBe(true)
      const decoded = Result.getOrThrow(decodeAttachment(value))
      expect(normalizeAttachments([decoded])[0]?.reviewStatus).toBe(reviewStatus)
    })
    const { reviewStatus: _status, ...omitted } = attachment
    expect(Schema.is(AttachmentSchema)(omitted)).toBe(false)
    expect(Schema.is(ApiResults.apiGetAttachment)(omitted)).toBe(false)
    expect(Schema.is(AttachmentSchema)({ ...attachment, reviewStatus: undefined })).toBe(false)
    expect(Schema.is(ApiResults.apiGetAttachment)({ ...attachment, reviewStatus: undefined })).toBe(false)
  })

  test('requires review target arrays in issue and search replies, including empty selections', () => {
    expect.hasAssertions()
    const value = issue()
    const result = { ...value, status: 'todo' }
    expect(Schema.is(IssueSchema)(value)).toBe(true)
    expect(Schema.is(SearchResultsSchema)([result])).toBe(true)
    Iterable.forEach([undefined, null], (reviewTargets) => {
      expect(Schema.is(IssueSchema)({ ...value, reviewTargets })).toBe(false)
      expect(Schema.is(SearchResultsSchema)([{ ...result, reviewTargets }])).toBe(false)
    })
  })

  test('returns empty review target arrays from detail, list and search when no attachments are selected', async () => {
    const data = fixture()
    const detail = await data.run(loadIssue(scope, detailUrl))
    expect(detail?.initialData.issue.reviewTargets).toStrictEqual([])
    const page = await data.run(readDataIssuePage(workspace.id, new URLSearchParams()))
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.map((entry) => entry.reviewTargets)).toStrictEqual(page.items.map(() => []))
    const results = await data.run(searchDataIssues(workspace.id, 'Original'))
    expect(results.length).toBeGreaterThan(0)
    expect(results.map((entry) => entry.reviewTargets)).toStrictEqual(results.map(() => []))
  })

  test('includes only explicitly selected targets in canonical list, search, My Issues and focused detail reads', async () => {
    const data = fixture()
    data.sqlite.exec(`
      UPDATE attachments SET review_status = 'fixing' WHERE id = 'file-a';
      INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,url,entity_type,entity_id,created_by_id,created_at,review_status) VALUES
        ('review-a','workspace-a','url','','Review first','text/uri-list',0,'https://example.test/review','issue','issue-a','user-a',2,'in_review'),
        ('not-selected','workspace-a','file','file-key','Not selected.txt','text/plain',10,NULL,'issue','issue-a','user-a',3,NULL),
        ('hidden-target','workspace-a','url','','Hidden target','text/uri-list',0,'https://example.test/secret','issue','hidden-issue','user-a',4,'in_review');
    `)
    const list = await data.run(loadIssues(scope, listUrl))
    const targets = list?.initialData.page.items.find((entry) => entry.id === 'issue-a')?.reviewTargets
    expect(targets?.map((entry) => [entry.id, entry.status])).toStrictEqual([
      ['review-a', 'in_review'],
      ['file-a', 'fixing'],
    ])
    expect(
      list?.initialData.page.items
        .flatMap((entry) => entry.reviewTargets)
        .some((entry) => entry.id === 'hidden-target'),
    ).toBe(false)
    const search = await data.run(searchDataIssues(workspace.id, 'Original'))
    expect(search.find((entry) => entry.id === 'issue-a')?.reviewTargets).toStrictEqual(targets)
    const mine = await data.run(loadMyIssues(scope, new URL('https://front.test/my-issues')))
    expect(mine.issues.find((entry) => entry.id === 'issue-a')?.reviewTargets).toStrictEqual(targets)
    const focused = await data.run(loadIssue(scope, new URL(`${detailUrl}&tab=review-targets`)))
    expect([
      focused?.initialData.reviewTargetsFocused,
      focused?.initialData.issue.reviewTargets,
      focused?.initialData.attachments.find((entry) => entry.id === 'file-a')?.reviewStatus,
    ]).toStrictEqual([true, targets, 'fixing'])
    const html = renderToString(await data.run(renderIssues(scope, listUrl)))
    expect(html).toContain('Review targets: Review first +1 (レビュー中)')
    expect(html).not.toContain('Hidden target')
  })

  test('loads cross-project review matches before pagination and applies the same filter to search', async () => {
    const data = fixture()
    data.sqlite.exec(`
      UPDATE attachments SET review_status='in_review' WHERE id='file-a';
      INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,url,entity_type,entity_id,created_by_id,created_at,review_status) VALUES
        ('review-b','workspace-a','url','','Project B review','text/uri-list',0,'https://example.test/b','issue','issue-b','user-a',2,'in_review'),
        ('hidden-review','workspace-a','url','','Secret review','text/uri-list',0,'https://example.test/hidden','issue','hidden-issue','user-a',3,'in_review');
    `)
    data.insertIssue({ createdAt: 99, id: 'newest-ordinary', number: 2, title: 'Ordinary issue' })
    const url = new URL(`${listUrl}&review=in_review&limit=1`)
    const first = await data.run(loadIssues(scope, url))
    expect(first?.initialData.project).toBeNull()
    expect(first?.initialData.page.total).toBe(2)
    expect(first?.initialData.page.items.map((entry) => entry.id)).toStrictEqual(['issue-b'])
    expect(first?.initialData.page.items[0].assignee_id).toBeNull()
    url.searchParams.set('cursor', String(first?.initialData.page.nextCursor))
    const second = await data.run(loadIssues(scope, url))
    expect(second?.initialData.page.items.map((entry) => entry.id)).toStrictEqual(['issue-a'])
    expect(second?.initialData.page.nextCursor).toBeNull()
    const searchUrl = new URL(`${listUrl}&review=in_review&q=issue`)
    const search = await data.run(loadIssues(scope, searchUrl))
    expect(search?.initialData.search.results?.map((entry) => entry.id).toSorted()).toStrictEqual([
      'issue-a',
      'issue-b',
    ])
    data.sqlite.exec("UPDATE attachments SET review_status='done' WHERE id='review-b'")
    const refreshed = await data.run(loadIssues(scope, searchUrl))
    expect(refreshed?.initialData.search.results?.map((entry) => entry.id)).toStrictEqual(['issue-a'])
    expect(refreshed?.initialData.page.total).toBe(1)
    const html = renderToString(await data.run(renderIssues(scope, searchUrl)))
    expect(html).toContain('Original issue')
    expectHiddenText(html, ['Second project issue', 'Secret review'])
  })

  test.each(['done', 'all', '', 'invalid'])(
    'rejects unsupported review mode %s instead of silently broadening results',
    async (review) => {
      const data = fixture()
      await expect(data.run(loadIssues(scope, new URL(`${listUrl}&review=${review}&q=issue`)))).rejects.toMatchObject({
        status: 400,
      })
    },
  )

  test('keeps workspace-wide issues and the full authorized project selector', async () => {
    const data = fixture()
    const result = await data.run(loadIssues(scope, listUrl))
    expect(result?.initialData.project).toBeNull()
    expect(result?.initialData.projects.map((entry) => entry.id)).toStrictEqual([project.id, secondProject.id])
    expect(result?.initialData.page.items.map((entry) => entry.id)).toStrictEqual(['issue-b', 'issue-a'])
    expect(result?.initialData.page.items.find((entry) => entry.id === 'issue-a')?.customFields[0].value).toBe('3')
    expect(result?.initialData.page.items.every((entry) => entry.workspaceSlug === workspace.slug)).toBe(true)
  })

  test('maps original filters and project UUID to the app query DTO', () => {
    const qs = filteredIssueQuery(
      new URL(
        'https://front.test/issues?projectId=project-a&status=todo,done&priority=high&hideEpics=1&dateField=completed&dateFrom=2026-10-01&dateTo=2026-10-04',
      ),
      scope.projects,
      taskTypes,
      project,
    )
    expect([qs.get('project'), qs.has('projectId')]).toStrictEqual([project.id, false])
    expect([qs.get('statusIds'), qs.get('priorities'), qs.get('excludeTypeIds')]).toStrictEqual([
      'todo,done',
      'high',
      'epic-type',
    ])
    expect([qs.has('completedAfter'), qs.has('completedBefore')]).toStrictEqual([true, true])
  })

  test('covers SSR-renders original rows, selectors, story points, and modal trigger before effects', async () => {
    const data = fixture()
    const html = renderToString(await data.run(renderIssues(scope, listUrl)))
    expectRenderedText(html, ['Original issue', '3', 'New issue', 'Filter by project', 'workspace=workspace'])
    expect(html).not.toContain('Loading issues')
  })

  test('resolves a UUID in its authorized membership before selecting its catalog project', async () => {
    const data = fixture()
    const result = await data.run(
      loadIssue(
        {
          ...scope,
          selection: { kind: 'selection-required', target: 'project', reason: 'ambiguous' },
        },
        detailUrl,
      ),
    )
    expect(result?.scope.selection).toStrictEqual({ kind: 'project', project, workspace })
    expect([
      result?.initialData.currentUserId,
      result?.initialData.comments[0].author_id,
      result?.initialData.attachments[0].kind,
    ]).toStrictEqual([scope.user.id, scope.user.id, 'url'])
  })

  test('renders the actual detail projection without the list-only assignee_name alias', async () => {
    const data = fixture()
    const url = new URL('https://front.test/projects/a/issues/1/outdated-title?workspace=workspace')
    const params = { projectSlug: 'a', issueNumber: '1', titleSlug: 'outdated-title' }
    const detail = await data.run(loadIssue(selected, url, params))
    expect(detail?.initialData.issue.assignee_name).toBeNull()
    expect(detail?.initialData.issue.body).toBe('**Original description**')
    const list = await data.run(readDataIssuePage(workspace.id, new URLSearchParams({ project: project.id })))
    expect(list.items[0].assignee_name).toBe('user')
    expect(list.items[0].body).toBeNull()
    const html = renderToString(await data.run(renderIssue(selected, url, params)))
    expectRenderedText(html, ['Original issue', '<strong>Original description</strong>'])
  })

  test('preserves an explicit archived project filter without granting hidden archived projects', async () => {
    const data = fixture()
    data.sqlite.exec("UPDATE projects SET archived_at = 2 WHERE id IN ('project-a', 'hidden-project')")
    const page = await data.run(readDataIssuePage(workspace.id, new URLSearchParams({ project: project.id })))
    expect(page.items.map((item) => item.id)).toContain('issue-a')
    await expect(
      data.run(readDataIssuePage(workspace.id, new URLSearchParams({ project: 'hidden-project' }))),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('does not fetch an unauthorized workspace or expand an unauthorized catalog project', async () => {
    expect.hasAssertions()
    const data = fixture()
    await expect(
      data.run(loadIssue(scope, new URL('https://front.test/issues/view?id=issue-a&workspace=foreign'))),
    ).resolves.toBeNull()
    await runInOrder(['hidden-issue', 'other-issue'], async (id): Promise<void> => {
      const error = await data.run(
        Effect.flip(loadIssue(scope, new URL(`https://front.test/issues/view?id=${id}&workspace=workspace`))),
      )
      expect(error).toBeInstanceOf(ScopeError)
      expect(error.status).toBe(404)
    })
  })

  test('renders complete detail description, comments, files, custom fields and author controls in SSR', async () => {
    const data = fixture()
    const html = renderToString(
      await data.run(
        renderIssue(selected, new URL('https://front.test/projects/a/issues/1/outdated-title?workspace=workspace'), {
          projectSlug: 'a',
          issueNumber: '1',
          titleSlug: 'outdated-title',
        }),
      ),
    )
    expectRenderedText(html, [
      'Original issue',
      '<strong>Original description</strong>',
      'Existing comment',
      'Reference',
      'Edit story points',
    ])
    expect(html).not.toContain('No issue ID')
  })

  test('pages through each authenticated membership for MyIssues without imposing the selected project', async () => {
    const data = fixture()
    Iterable.forEach(Iterable.range(0, 103 - 1), (index): void => {
      data.insertIssue({
        assigneeId: scope.user.id,
        createdAt: 5,
        id: `my-${String(index).padStart(3, '0')}`,
        number: index + 2,
      })
    })
    const other = { ...workspace, id: 'workspace-b', slug: 'other' }
    const otherProject = {
      ...project,
      id: 'other-project',
      key: 'O',
      workspace_id: other.id,
      workspace_slug: other.slug,
    }
    const memberships = {
      ...selected,
      workspaces: [workspace, other],
      projects: [...scope.projects, otherProject],
    }
    const result = await data.run(
      loadMyIssues(memberships, new URL('https://front.test/my-issues?projectId=project-a')),
    )
    expect(result.issues).toHaveLength(105)
    expect(new Set(result.issues.map((entry) => entry.id)).size).toBe(105)
    expect(new Set(result.issues.map((entry) => entry.workspaceSlug))).toStrictEqual(
      new Set([workspace.slug, other.slug]),
    )
  })

  test('rejects oversized board aggregates but keeps the ordinary list paginated', async () => {
    const data = fixture()
    Iterable.forEach(Iterable.range(0, 1000 - 1), (index): void => {
      data.insertIssue({ id: `budget-${index}`, number: 100 + index })
    })
    await expect(
      data.run(
        loadIssues(selected, new URL('https://front.test/issues?workspace=workspace&projectId=project-a&view=board')),
      ),
    ).rejects.toMatchObject({ status: 422 })
    const result = await data.run(
      loadIssues(selected, new URL('https://front.test/issues?workspace=workspace&projectId=project-a&view=list')),
    )
    expect(result?.initialData.page.items).toHaveLength(30)
    expect(result?.initialData.page.nextCursor).not.toBeNull()
  })

  test.each(['dateField=updated&dateFrom=2026-02-30', 'dateField=completed&dateFrom=2026-10-04&dateTo=2026-10-01'])(
    'rejects invalid calendar query %s',
    async (query) => {
      const data = fixture()
      await expect(
        data.run(loadIssues(scope, new URL(`https://front.test/issues?workspace=workspace&${query}`))),
      ).rejects.toMatchObject({ status: 400 })
    },
  )

  test('covers SSR-renders later-page review work first while excluding closed and unassigned work', async () => {
    const data = fixture()
    data.sqlite.exec(
      "INSERT INTO task_statuses (id,workspace_id,key,name,category,position,is_default) VALUES ('review','workspace-a','in_review','In Review','in_progress',2,0)",
    )
    data.insertIssue({
      assigneeId: scope.user.id,
      createdAt: 0,
      id: 'review',
      number: 200,
      priority: 'low',
      statusId: 'review',
      title: 'Old review first',
    })
    Iterable.forEach(Iterable.range(0, 103 - 1), (index): void => {
      data.insertIssue({
        assigneeId: scope.user.id,
        createdAt: 10,
        id: `new-${index}`,
        number: index + 2,
        title: `New todo ${index}`,
      })
    })
    data.insertIssue({
      assigneeId: scope.user.id,
      id: 'closed',
      number: 201,
      statusId: 'done',
      title: 'Closed work excluded',
    })
    const html = renderToStaticMarkup(await data.run(renderMyIssues(selected, new URL('https://front.test/my-issues'))))
    expect(html.match(/<table/gu)).toHaveLength(1)
    expect(html).toContain('105 issues')
    expect(html.indexOf('Old review first')).toBeLessThan(html.indexOf('New todo'))
    expectHiddenText(html, [
      'Closed work excluded',
      'Second project issue',
      'Hidden secret',
      'Other membership issue',
      'Include done',
    ])
  })

  test('loads complete board sets and performs project-scoped real FTS search', async () => {
    const data = fixture()
    Iterable.forEach(Iterable.range(0, 102 - 1), (index): void => {
      data.insertIssue({
        createdAt: 5,
        id: `board-${String(index).padStart(3, '0')}`,
        number: index + 2,
        title: 'needle',
      })
    })
    const result = await data.run(
      loadIssues(
        selected,
        new URL('https://front.test/issues?workspace=workspace&projectId=project-a&view=board&q=needle'),
      ),
    )
    expect(result?.initialData.view).toBe('board')
    expect(result?.initialData.page.items).toHaveLength(103)
    expect(result?.initialData.page.nextCursor).toBeNull()
    expect(result?.initialData.search.results).toHaveLength(20)
    expect(result?.initialData.search.results?.every((entry) => entry.project_id === project.id)).toBe(true)
    await expect(data.run(searchDataIssues(workspace.id, 'secret'))).resolves.toStrictEqual([])
  })

  test('keeps query schema and driver failures in the typed Effect error channel', async () => {
    const data = fixture()
    const invalid = await data.run(
      Effect.flip(loadIssues(scope, new URL('https://front.test/issues?workspace=workspace&cursor=not-a-cursor'))),
    )
    expect(invalid).toBeInstanceOf(ScopeError)
    expect(invalid.status).toBe(400)
    data.sqlite.exec('DROP TABLE task_statuses')
    const error = await data.run(Effect.flip(loadIssues(scope, listUrl)))
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(500)
    expect(error.message).not.toContain('SELECT')
  })

  test('loads epic rollups from the shared batched query without per-epic detail fanout', async () => {
    const data = fixture()
    data.insertIssue({ id: 'epic-a', number: 2, typeId: 'epic-type' })
    data.insertIssue({ id: 'child-a', number: 3, parentId: 'epic-a', statusId: 'done' })
    data.sqlite.exec("UPDATE issues SET status='done' WHERE id='child-a'")
    const result = await data.run(loadEpics(selected, new URL('https://front.test/epics?projectId=project-a')))
    expect(result?.initialData.page.items).toHaveLength(1)
    expect(result?.initialData.page.items[0].rollup).toMatchObject({
      done: 1,
      remaining: 0,
      total: 1,
    })
    const detail = await data.run(
      loadIssue(scope, new URL('https://front.test/issues/view?id=epic-a&workspace=workspace')),
    )
    expect(detail?.initialData.children.map((entry) => entry.id)).toStrictEqual(['child-a'])
  })

  test('enforces linked wiki visibility without hiding the unavailable attachment row', async () => {
    const data = fixture()
    data.sqlite.exec(
      `INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,linked_wiki_page_id,entity_type,entity_id,created_by_id,created_at) VALUES ('wiki-link','workspace-a','wiki_ref','','Hidden wiki','','0','wiki-hidden','issue','issue-a','user-a',2)`,
    )
    const result = await data.run(loadIssue(scope, detailUrl))
    expect(result?.initialData.attachments.find((entry) => entry.id === 'wiki-link')?.wikiPage).toBeNull()
  })
})
