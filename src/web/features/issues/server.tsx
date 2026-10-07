import { Effect } from 'effect'
import type { ReactElement } from 'react'

import { listComments } from '#services/comments'
import { listLinksForIssue } from '#services/issue-links'
import { findSprintById, listSprints } from '#services/sprints'
import { listTaskStatuses } from '#services/task-statuses'
import { listTaskTypes } from '#services/task-types'
import { listWorkspaceMembers } from '#services/workspaces'

import { renderMarkdownDocument } from '../../components/markdown/render'
import { RequestServices } from '../../request'
import type { RequestApi } from '../../server/api-client'
import { authorizeDataEntity, dataError, requireDataProject, requireDataWorkspace } from '../../server/data-context'
import { ApiError, ScopeError } from '../../server/errors'
import type { RequestScope } from '../../server/request-context'
import { checked, readDataAttachments, readDataIssue, readDataIssuePage, searchDataIssues } from './data'
import { buildFilterQueryParams } from './legacy/IssueList-helpers'
import { issueListQuery } from './query'
import { type IssuePage, normalizeComments, normalizeLinks, normalizeStatuses, normalizeTaskTypes } from './types'
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
  for (const key of ['cursor', 'limit', 'assignee', 'parentId', 'noParent', 'typeId'])
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
    const page = yield* readDataIssuePage(scope, workspaceId, query)
    const items = [...page.items]
    let cursor = page.nextCursor
    const seen = new Set<string>()
    while (cursor != null) {
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
    const { db } = yield* RequestServices
    yield* checked(() => requireDataWorkspace(scope, workspaceId))
    return yield* Effect.all(
      {
        statuses: listTaskStatuses(db, workspaceId).pipe(Effect.mapError(dataError), Effect.map(normalizeStatuses)),
        taskTypes: listTaskTypes(db, workspaceId).pipe(Effect.mapError(dataError), Effect.map(normalizeTaskTypes)),
      },
      { concurrency: CONCURRENCY },
    )
  })
}

export function loadIssues(
  _api: RequestApi,
  scope: RequestScope,
  url: URL,
): Effect.Effect<IssuesLoaderData | null, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const workspace = workspaceSelection(scope)
    if (!workspace) return null
    yield* checked(() => requireDataWorkspace(scope, workspace.id))
    const { db } = yield* RequestServices
    const workspaceSlug = workspace.slug,
      project = selectedProject(scope),
      projects = scope.projects.filter((entry) => entry.workspace_id === workspace.id)
    if (project) yield* checked(() => requireDataProject(scope, project.id, workspace.id))
    const { statuses, taskTypes } = yield* lookups(scope, workspace.id)
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
        sprints: project
          ? listSprints(db, workspace.id, { projectId: project.id }).pipe(Effect.mapError(dataError))
          : Effect.succeed([]),
        sprintDetail: sprintId
          ? findSprintById(db, workspace.id, sprintId).pipe(
              Effect.mapError(dataError),
              Effect.flatMap((row) => checked(() => authorizeDataEntity(scope, workspace.id, row))),
            )
          : Effect.succeed(null),
        search: q ? searchDataIssues(scope, workspace.id, q, project?.id) : Effect.succeed(null),
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
export function renderIssues(
  api: RequestApi,
  scope: RequestScope,
  url: URL,
): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const data = yield* loadIssues(api, scope, url)
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
  _api: RequestApi,
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
    const { db } = yield* RequestServices
    const workspaceSlug = workspace.slug
    const issue = yield* readDataIssue(scope, workspace.id, identifier)
    const project = yield* checked(() => requireDataProject(scope, issue.project_id ?? '', workspace.id))
    const detailScope: RequestScope = {
      ...scope,
      selection: { kind: 'project', workspace, project },
    }
    const { comments, links, attachments, metadata, members, parent, children } = yield* Effect.all(
      {
        comments: listComments(db, workspace.id, issue.id).pipe(
          Effect.mapError(dataError),
          Effect.map(normalizeComments),
        ),
        links: listLinksForIssue(db, workspace.id, issue.id).pipe(
          Effect.mapError(dataError),
          Effect.map(normalizeLinks),
        ),
        attachments: readDataAttachments(scope, workspace.id, issue.id),
        metadata: lookups(scope, workspace.id),
        members: listWorkspaceMembers(db, workspace.id).pipe(Effect.mapError(dataError)),
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
      },
    }
  })
}
export function renderIssue(
  api: RequestApi,
  scope: RequestScope,
  url: URL,
  params: IssueRouteParams = {},
): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const data = yield* loadIssue(api, scope, url, params)
    return <IssueDetailPage scope={data?.scope ?? scope} {...(data ?? { workspaceSlug: '', initialData: null })} />
  })
}
export function loadMyIssues(
  _api: RequestApi,
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
  api: RequestApi,
  scope: RequestScope,
  url: URL,
): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    return <MyIssuesPage scope={scope} initialData={yield* loadMyIssues(api, scope, url)} />
  })
}
export function loadEpics(
  _api: RequestApi,
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
export function renderEpics(
  api: RequestApi,
  scope: RequestScope,
  url: URL,
): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const data = yield* loadEpics(api, scope, url)
    return <EpicsPage scope={scope} {...(data ?? { workspaceSlug: '', initialData: null })} />
  })
}
