import { Effect, Schema } from 'effect'
import type { ReactElement } from 'react'

import { ReviewFilterSchema } from '../../../contracts/review-targets'
import { AGGREGATE_PAGE_SIZE, MAX_AGGREGATE_ISSUES } from '../../../contracts/web-limits'
import { renderMarkdownDocument } from '../../components/markdown/render'
import { RequestServices } from '../../request'
import { requireDataProject, requireDataWorkspace } from '../../server/data-context'
import { ApiError, ScopeError } from '../../server/errors'
import type { RequestScope } from '../../server/request-context'
import {
  checked,
  readDataAttachments,
  readDataComments,
  readDataLinks,
  readDataIssue,
  readDataIssuePage,
  readIssueLookups,
  readIssueMembers,
  readSprint,
  readSprints,
  searchDataIssues,
} from './data'
import { buildFilterQueryParams } from './legacy/IssueList-helpers'
import { issueListQuery } from './query'
import { type IssuePage } from './types'
import { type EpicsInitialData, EpicsPage } from './views/EpicsPage'
import { type IssueDetailInitialData, IssueDetailPage } from './views/IssueDetailPage'
import { type IssuesInitialData, IssuesPage } from './views/IssuesPage'
import { type MyIssuesInitialData, MyIssuesPage, type ScopedIssue } from './views/MyIssuesPage'

export interface IssuesLoaderData {
  readonly workspaceSlug: string
  readonly initialData: IssuesInitialData
}
interface IssueLoaderData {
  readonly scope: RequestScope
  readonly workspaceSlug: string
  readonly initialData: IssueDetailInitialData
}
interface EpicsLoaderData {
  readonly workspaceSlug: string
  readonly initialData: EpicsInitialData
}
const CONCURRENCY = 4
type ReadFailure = ApiError | ScopeError

function workspaceSelection(scope: RequestScope) {
  return scope.selection.kind === 'project' || scope.selection.kind === 'workspace' ? scope.selection.workspace : null
}
function selectedProject(scope: RequestScope) {
  return scope.selection.kind === 'project' ? scope.selection.project : null
}

export function filteredIssueQuery(
  url: URL,
  projects: RequestScope['projects'],
  taskTypes: readonly { id: string; key: string }[],
  project: ReturnType<typeof selectedProject>,
): URLSearchParams {
  const p = url.searchParams
  const query = buildFilterQueryParams(
    {
      filterStatuses: (p.get('status') ?? '').split(',').filter(Boolean),
      filterPriorities: (p.get('priority') ?? '').split(',').filter(Boolean),
      filterProject: project?.key ?? '',
      filterType: p.get('type') ?? '',
      filterEpicId: p.get('epic') ?? '',
      filterSprintId: p.get('sprintId') ?? '',
      hideEpics: p.get('hideEpics') === '1',
      filterDateField:
        p.get('dateField') === 'completed' ? 'completed' : p.get('dateField') === 'updated' ? 'updated' : '',
      filterDateFrom: p.get('dateFrom') ?? '',
      filterDateTo: p.get('dateTo') ?? '',
    },
    projects,
    [...taskTypes],
  )
  for (const key of ['cursor', 'limit', 'assignee', 'parentId', 'noParent', 'typeId', 'review'])
    if (p.has(key)) query.set(key, p.get(key) ?? '')
  if (!query.has('limit')) query.set('limit', '30')
  return query
}

function allPages(
  scope: RequestScope,
  workspaceId: string,
  query: URLSearchParams,
): Effect.Effect<IssuePage, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    query = new URLSearchParams(query)
    query.set('limit', String(AGGREGATE_PAGE_SIZE))
    const page = yield* readDataIssuePage(scope, workspaceId, query)
    const items = [...page.items]
    let cursor = page.nextCursor
    const seen = new Set<string>()
    while (cursor != null) {
      if (items.length >= MAX_AGGREGATE_ISSUES)
        return yield* new ApiError(
          'request',
          422,
          `This view supports at most ${MAX_AGGREGATE_ISSUES} issues. Narrow the filters or use the paginated list.`,
        )
      if (seen.has(String(cursor)))
        return yield* new ApiError('schema', 502, 'The data query returned a repeated issue cursor.')
      seen.add(String(cursor))
      const qs = new URLSearchParams(query)
      qs.set('cursor', String(cursor))
      const next = yield* readDataIssuePage(scope, workspaceId, qs)
      items.push(...next.items)
      cursor = next.nextCursor
    }
    const workspace = yield* checked(() => requireDataWorkspace(scope, workspaceId))
    return {
      ...page,
      items: items.map((entry) => ({ ...entry, workspaceSlug: workspace.slug })),
      nextCursor: cursor,
    }
  })
}
function lookups(scope: RequestScope, workspaceId: string) {
  return Effect.gen(function* () {
    yield* checked(() => requireDataWorkspace(scope, workspaceId))
    return yield* readIssueLookups(workspaceId)
  })
}

export function loadIssues(
  scope: RequestScope,
  url: URL,
): Effect.Effect<IssuesLoaderData | null, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const workspace = workspaceSelection(scope)
    if (!workspace) return null
    yield* checked(() => requireDataWorkspace(scope, workspace.id))
    const workspaceSlug = workspace.slug,
      project = selectedProject(scope),
      projects = scope.projects.filter((entry) => entry.workspace_id === workspace.id)
    if (project) yield* checked(() => requireDataProject(scope, project.id, workspace.id))
    const { statuses, taskTypes } = yield* lookups(scope, workspace.id)
    const review = url.searchParams.has('review')
      ? yield* Schema.decodeUnknownEffect(ReviewFilterSchema)(url.searchParams.get('review')).pipe(
          Effect.mapError(() => new ScopeError(400, 'Invalid review filter.')),
        )
      : undefined
    const query = filteredIssueQuery(url, projects, taskTypes, project),
      epicType = taskTypes.find((entry) => entry.key === 'epic')
    const view =
      url.searchParams.get('view') === 'board'
        ? 'board'
        : url.searchParams.get('view') === 'backlog'
          ? 'backlog'
          : 'list'
    if (view !== 'list') {
      query.set('limit', '100')
      query.delete('cursor')
    }
    const epicQuery = new URLSearchParams({ typeId: epicType?.id ?? '', limit: '100' })
    if (project) epicQuery.set('project', project.id)
    const sprintId = url.searchParams.get('sprintId'),
      q = url.searchParams.get('q') ?? ''
    const { page, epics, sprints, sprintDetail, search } = yield* Effect.all(
      {
        page: view === 'list' ? readDataIssuePage(scope, workspace.id, query) : allPages(scope, workspace.id, query),
        epics: epicType ? allPages(scope, workspace.id, epicQuery) : Effect.succeed({ items: [] } as IssuePage),
        sprints: project ? readSprints(workspace.id, project.id) : Effect.succeed([]),
        sprintDetail: sprintId ? readSprint(workspace.id, sprintId) : Effect.succeed(null),
        search: q ? searchDataIssues(scope, workspace.id, q, project?.id, review) : Effect.succeed(null),
      },
      { concurrency: CONCURRENCY },
    )
    return {
      workspaceSlug,
      initialData: {
        currentUserId: scope.user.id,
        view,
        page: { ...page, items: page.items.map((entry) => ({ ...entry, workspaceSlug })) },
        statuses,
        taskTypes,
        project,
        projects,
        epics: epics.items,
        sprints: sprints.map((entry) => ({ ...entry })),
        sprintDetail,
        search: {
          query: q,
          results: search?.map((entry) => ({ ...entry, workspaceSlug })) ?? null,
        },
      },
    }
  })
}
export function renderIssues(scope: RequestScope, url: URL): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const data = yield* loadIssues(scope, url)
    return (
      <IssuesPage
        scope={scope}
        route={{ pathname: url.pathname, search: url.search }}
        {...(data ?? { workspaceSlug: '', initialData: null })}
      />
    )
  })
}
type IssueRouteParams = Readonly<Record<string, string | undefined>>
function issueIdentifier(url: URL, scope: RequestScope, params: IssueRouteParams): string | null {
  const id = url.searchParams.get('id')
  if (id) return id
  if (!params.issueNumber || !params.projectSlug) return null
  const project = selectedProject(scope)
  if (
    !project ||
    (params.projectSlug !== project.slug && params.projectSlug.toLowerCase() !== project.key.toLowerCase())
  )
    return null
  const number = Number(params.issueNumber)
  if (!/^\d+$/.test(params.issueNumber) || !Number.isSafeInteger(number) || number < 1)
    throw new ScopeError(400, 'The issue reference is not valid.')
  return `${project.key}-${number}`
}
export function loadIssue(
  scope: RequestScope,
  url: URL,
  params: IssueRouteParams = {},
): Effect.Effect<IssueLoaderData | null, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const identifier = yield* checked(() => issueIdentifier(url, scope, params))
    if (!identifier) return null
    const hint = url.searchParams.get('workspace')
    const workspace = hint
      ? scope.workspaces.find((entry) => entry.slug === hint)
      : (workspaceSelection(scope) ?? (scope.workspaces.length === 1 ? scope.workspaces[0] : null))
    if (!workspace) return null
    const workspaceSlug = workspace.slug
    const issue = yield* readDataIssue(scope, workspace.id, identifier)
    const project = yield* checked(() => requireDataProject(scope, issue.project_id ?? '', workspace.id))
    const detailScope: RequestScope = {
      ...scope,
      selection: { kind: 'project', workspace, project },
    }
    const { comments, links, attachments, metadata, members, parent, children } = yield* Effect.all(
      {
        comments: readDataComments(scope, workspace.id, issue.id),
        links: readDataLinks(scope, workspace.id, issue.id),
        attachments: readDataAttachments(scope, workspace.id, issue.id),
        metadata: lookups(scope, workspace.id),
        members: readIssueMembers(workspace.id),
        parent: issue.parent_id ? readDataIssue(scope, workspace.id, issue.parent_id) : Effect.succeed(null),
        children:
          issue.type_key === 'epic'
            ? allPages(scope, workspace.id, new URLSearchParams({ parentId: issue.id, limit: '100' }))
            : Effect.succeed({ items: [] } as IssuePage),
      },
      { concurrency: CONCURRENCY },
    )
    return {
      scope: detailScope,
      workspaceSlug,
      initialData: {
        issue: {
          ...issue,
          workspaceSlug,
          renderedBody: yield* Effect.tryPromise({
            try: () => renderMarkdownDocument(issue.body ?? ''),
            catch: () => new ApiError('schema', 502, 'The issue Markdown could not be rendered.'),
          }),
        },
        comments: yield* Effect.all(
          comments.map((comment) =>
            Effect.tryPromise({
              try: async () => ({
                ...comment,
                renderedBody: await renderMarkdownDocument(comment.body),
              }),
              catch: () => new ApiError('schema', 502, 'The comment Markdown could not be rendered.'),
            }),
          ),
          { concurrency: CONCURRENCY },
        ),
        links,
        attachments,
        ...metadata,
        members: members.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
        })),
        parent: parent ? { ...parent, workspaceSlug } : null,
        children: children.items,
        currentUserId: scope.user.id,
        reviewTargetsFocused: url.searchParams.get('tab') === 'review-targets',
      },
    }
  })
}
export function renderIssue(
  scope: RequestScope,
  url: URL,
  params: IssueRouteParams = {},
): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const data = yield* loadIssue(scope, url, params)
    return <IssueDetailPage scope={data?.scope ?? scope} {...(data ?? { workspaceSlug: '', initialData: null })} />
  })
}
export function loadMyIssues(
  scope: RequestScope,
  url: URL,
): Effect.Effect<MyIssuesInitialData, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const memberships = scope.workspaces
    const pages = yield* Effect.forEach(
      memberships,
      (workspace) =>
        allPages(scope, workspace.id, new URLSearchParams(issueListQuery(url, { assignee: 'me', limit: '100' }))).pipe(
          Effect.map((page) => ({ workspace, page })),
        ),
      { concurrency: CONCURRENCY },
    )
    const issues: ScopedIssue[] = pages.flatMap(({ workspace, page }) =>
      page.items.map((issue) => ({ ...issue, workspaceSlug: workspace.slug })),
    )
    return { issues, memberships }
  })
}
export function renderMyIssues(
  scope: RequestScope,
  url: URL,
): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    return <MyIssuesPage scope={scope} initialData={yield* loadMyIssues(scope, url)} />
  })
}
export function loadEpics(
  scope: RequestScope,
  url: URL,
): Effect.Effect<EpicsLoaderData | null, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const workspace = workspaceSelection(scope),
      project = selectedProject(scope)
    if (!workspace || !project) return null
    yield* checked(() => requireDataProject(scope, project.id, workspace.id))
    const workspaceSlug = workspace.slug
    const { statuses, taskTypes } = yield* lookups(scope, workspace.id),
      epic = taskTypes.find((entry) => entry.key === 'epic')
    const qs = filteredIssueQuery(url, scope.projects, taskTypes, project)
    qs.set('includeRollups', '1')
    qs.set('limit', '100')
    if (epic) qs.set('typeId', epic.id)
    const page = epic ? yield* allPages(scope, workspace.id, qs) : ({ items: [] } as IssuePage)
    return {
      workspaceSlug,
      initialData: {
        page,
        statuses,
        taskTypes,
        project,
        projects: scope.projects.filter((entry) => entry.workspace_id === workspace.id),
        search: url.search,
      },
    }
  })
}
export function renderEpics(scope: RequestScope, url: URL): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const data = yield* loadEpics(scope, url)
    return <EpicsPage scope={scope} {...(data ?? { workspaceSlug: '', initialData: null })} />
  })
}
