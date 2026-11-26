import { String, Predicate, Iterable, Effect, Schema } from 'effect'
import type { ReactElement } from 'react'

import { HTTP_BAD_REQUEST, HTTP_BAD_GATEWAY, HTTP_UNPROCESSABLE_CONTENT } from '#contracts/http-status.ts'
import { hasSingleItem } from '#contracts/item-count.ts'
import { ReviewFilterSchema } from '#contracts/review-targets.ts'
import { AGGREGATE_PAGE_SIZE, MAX_AGGREGATE_ISSUES } from '#contracts/web-limits.ts'
import { renderMarkdownDocument } from '@/components/markdown/render.ts'
import { RequestServices } from '@/request.ts'
import { requireDataProject, requireDataWorkspace } from '@/server/data-context.ts'
import { ApiError, ScopeError } from '@/server/errors.ts'
import type { RequestScope } from '@/server/request-context.ts'

import { buildFilterQueryParams } from './components/issue-list-helpers.ts'
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
} from './data.ts'
import { issueListQuery } from './query.ts'
import type { IssuePage } from './types.ts'
import { EpicsPage } from './views/epics-page.tsx'
import type { EpicsInitialData } from './views/epics-page.tsx'
import { IssueDetailPage } from './views/issue-detail-page.tsx'
import type { IssueDetailInitialData } from './views/issue-detail-page.tsx'
import { IssuesPage } from './views/issues-page.tsx'
import type { IssuesInitialData } from './views/issues-page.tsx'
import { MyIssuesPage } from './views/my-issues-page.tsx'
import type { MyIssuesInitialData, ScopedIssue } from './views/my-issues-page.tsx'

export type IssuesLoaderData = Readonly<{
  workspaceSlug: string
  initialData: IssuesInitialData
}>
type IssueLoaderData = Readonly<{
  scope: RequestScope
  workspaceSlug: string
  initialData: IssueDetailInitialData
}>
type EpicsLoaderData = Readonly<{
  workspaceSlug: string
  initialData: EpicsInitialData
}>
const decodeReviewFilter = Schema.decodeUnknownEffect(ReviewFilterSchema)

const CONCURRENCY = 4
type ReadFailure = ApiError | ScopeError

const workspaceSelection = function workspaceSelection(scope: RequestScope) {
  return scope.selection.kind === 'project' || scope.selection.kind === 'workspace' ? scope.selection.workspace : null
}
const selectedProject = function selectedProject(scope: RequestScope) {
  return scope.selection.kind === 'project' ? scope.selection.project : null
}

export const filteredIssueQuery = function filteredIssueQuery(
  url: URL,
  projects: RequestScope['projects'],
  taskTypes: Readonly<{ id: string; key: string }[]>,
  project: ReturnType<typeof selectedProject>,
): URLSearchParams {
  const queryParams = url.searchParams
  const query = buildFilterQueryParams(
    {
      filterStatuses: (queryParams.get('status') ?? '').split(',').filter(Boolean),
      filterPriorities: (queryParams.get('priority') ?? '').split(',').filter(Boolean),
      filterProject: project?.key ?? '',
      filterType: queryParams.get('type') ?? '',
      filterEpicId: queryParams.get('epic') ?? '',
      filterSprintId: queryParams.get('sprintId') ?? '',
      hideEpics: queryParams.get('hideEpics') === '1',
      filterDateField:
        queryParams.get('dateField') === 'completed'
          ? 'completed'
          : queryParams.get('dateField') === 'updated'
            ? 'updated'
            : '',
      filterDateFrom: queryParams.get('dateFrom') ?? '',
      filterDateTo: queryParams.get('dateTo') ?? '',
    },
    projects,
    [...taskTypes],
  )
  Iterable.forEach(['cursor', 'limit', 'assignee', 'parentId', 'noParent', 'typeId', 'review'], (key) => {
    if (queryParams.has(key)) {
      query.set(key, queryParams.get(key) ?? '')
    }
  })
  if (!query.has('limit')) {
    query.set('limit', '30')
  }
  return query
}

const allPages = function allPages(
  scope: RequestScope,
  workspaceId: string,
  query: URLSearchParams,
): Effect.Effect<IssuePage, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    query = new URLSearchParams(query)
    query.set('limit', globalThis.String(AGGREGATE_PAGE_SIZE))
    const page = yield* readDataIssuePage(workspaceId, query)
    const items = [...page.items]
    let cursor = page.nextCursor
    const seen = new Set<string>()
    while (Predicate.isNotNullish(cursor)) {
      if (items.length >= MAX_AGGREGATE_ISSUES) {
        return yield* new ApiError(
          'request',
          HTTP_UNPROCESSABLE_CONTENT,
          `This view supports at most ${MAX_AGGREGATE_ISSUES} issues. Narrow the filters or use the paginated list.`,
        )
      }
      if (seen.has(globalThis.String(cursor))) {
        return yield* new ApiError('schema', HTTP_BAD_GATEWAY, 'The data query returned a repeated issue cursor.')
      }
      seen.add(globalThis.String(cursor))
      const qs = new URLSearchParams(query)
      qs.set('cursor', globalThis.String(cursor))
      const next = yield* readDataIssuePage(workspaceId, qs)
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
const lookups = function lookups(scope: RequestScope, workspaceId: string) {
  return Effect.gen(function* () {
    yield* checked(() => requireDataWorkspace(scope, workspaceId))
    return yield* readIssueLookups(workspaceId)
  })
}

export const loadIssues = function loadIssues(
  scope: RequestScope,
  url: URL,
): Effect.Effect<IssuesLoaderData | null, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const workspace = workspaceSelection(scope)
    if (!workspace) {
      return null
    }
    yield* checked(() => requireDataWorkspace(scope, workspace.id))
    const workspaceSlug = workspace.slug,
      project = selectedProject(scope),
      projects = scope.projects.filter((entry) => entry.workspace_id === workspace.id)
    if (project) {
      yield* checked(() => requireDataProject(scope, project.id, workspace.id))
    }
    const { statuses, taskTypes } = yield* lookups(scope, workspace.id)
    const review = url.searchParams.has('review')
      ? yield* decodeReviewFilter(url.searchParams.get('review')).pipe(
          Effect.mapError(() => new ScopeError(HTTP_BAD_REQUEST, 'Invalid review filter.')),
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
    if (project) {
      epicQuery.set('project', project.id)
    }
    const sprintId = url.searchParams.get('sprintId'),
      searchTerm = url.searchParams.get('q') ?? ''
    const { page, epics, sprints, sprintDetail, search } = yield* Effect.all(
      {
        page: view === 'list' ? readDataIssuePage(workspace.id, query) : allPages(scope, workspace.id, query),
        epics: epicType ? allPages(scope, workspace.id, epicQuery) : Effect.succeed({ items: [] }),
        sprints: project ? readSprints(workspace.id, project.id) : Effect.succeed([]),
        sprintDetail:
          Predicate.isNotNullish(sprintId) && String.isNonEmpty(sprintId)
            ? readSprint(workspace.id, sprintId)
            : Effect.succeed(null),
        search: searchTerm
          ? searchDataIssues(workspace.id, searchTerm, { projectId: project?.id, review })
          : Effect.succeed(null),
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
          query: searchTerm,
          results: search?.map((entry) => ({ ...entry, workspaceSlug })) ?? null,
        },
      },
    }
  })
}
export const renderIssues = function renderIssues(
  scope: RequestScope,
  url: URL,
): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
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
const issueIdentifier = function issueIdentifier(
  url: URL,
  scope: RequestScope,
  params: IssueRouteParams,
): string | null {
  const id = url.searchParams.get('id')
  if (Predicate.isNotNullish(id) && String.isNonEmpty(id)) {
    return id
  }
  if (!params.issueNumber || !params.projectSlug) {
    return null
  }
  const project = selectedProject(scope)
  if (
    !project ||
    (params.projectSlug !== project.slug && params.projectSlug.toLowerCase() !== project.key.toLowerCase())
  ) {
    return null
  }
  const number = Number(params.issueNumber)
  if (!/^\d+$/u.test(params.issueNumber) || !Number.isSafeInteger(number) || number < 1) {
    throw new ScopeError(HTTP_BAD_REQUEST, 'The issue reference is not valid.')
  }
  return `${project.key}-${number}`
}
export const loadIssue = function loadIssue(
  scope: RequestScope,
  url: URL,
  params: IssueRouteParams = {},
): Effect.Effect<IssueLoaderData | null, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const identifier = yield* checked(() => issueIdentifier(url, scope, params))
    if (Predicate.isNullish(identifier) || String.isEmpty(identifier)) {
      return null
    }
    const hint = url.searchParams.get('workspace')
    const workspace =
      Predicate.isNotNullish(hint) && String.isNonEmpty(hint)
        ? scope.workspaces.find((entry) => entry.slug === hint)
        : (workspaceSelection(scope) ?? (hasSingleItem(scope.workspaces) ? scope.workspaces[0] : null))
    if (!workspace) {
      return null
    }
    const workspaceSlug = workspace.slug
    const issue = yield* readDataIssue(workspace.id, identifier)
    const project = yield* checked(() => requireDataProject(scope, issue.project_id ?? '', workspace.id))
    const detailScope: RequestScope = {
      ...scope,
      selection: { kind: 'project', workspace, project },
    }
    const { comments, links, attachments, metadata, members, parent, children } = yield* Effect.all(
      {
        comments: readDataComments(workspace.id, issue.id),
        links: readDataLinks(workspace.id, issue.id),
        attachments: readDataAttachments(workspace.id, issue.id),
        metadata: lookups(scope, workspace.id),
        members: readIssueMembers(workspace.id),
        parent: issue.parent_id ? readDataIssue(workspace.id, issue.parent_id) : Effect.succeed(null),
        children:
          issue.type_key === 'epic'
            ? allPages(scope, workspace.id, new URLSearchParams({ parentId: issue.id, limit: '100' }))
            : Effect.succeed({ items: [] }),
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
            catch: () => new ApiError('schema', HTTP_BAD_GATEWAY, 'The issue Markdown could not be rendered.'),
            try: () => renderMarkdownDocument(issue.body ?? ''),
          }),
        },
        comments: yield* Effect.all(
          comments.map((comment) =>
            Effect.tryPromise({
              catch: () => new ApiError('schema', HTTP_BAD_GATEWAY, 'The comment Markdown could not be rendered.'),
              try: async () => ({
                ...comment,
                renderedBody: await renderMarkdownDocument(comment.body),
              }),
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
export const renderIssue = function renderIssue(
  scope: RequestScope,
  url: URL,
  params: IssueRouteParams = {},
): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const data = yield* loadIssue(scope, url, params)
    return <IssueDetailPage scope={data?.scope ?? scope} {...(data ?? { workspaceSlug: '', initialData: null })} />
  })
}
export const loadMyIssues = function loadMyIssues(
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
export const renderMyIssues = function renderMyIssues(
  scope: RequestScope,
  url: URL,
): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    return <MyIssuesPage scope={scope} initialData={yield* loadMyIssues(scope, url)} />
  })
}
export const loadEpics = function loadEpics(
  scope: RequestScope,
  url: URL,
): Effect.Effect<EpicsLoaderData | null, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const workspace = workspaceSelection(scope),
      project = selectedProject(scope)
    if (!workspace || !project) {
      return null
    }
    yield* checked(() => requireDataProject(scope, project.id, workspace.id))
    const workspaceSlug = workspace.slug
    const { statuses, taskTypes } = yield* lookups(scope, workspace.id),
      epic = taskTypes.find((entry) => entry.key === 'epic')
    const qs = filteredIssueQuery(url, scope.projects, taskTypes, project)
    qs.set('includeRollups', '1')
    qs.set('limit', '100')
    if (epic) {
      qs.set('typeId', epic.id)
    }
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
export const renderEpics = function renderEpics(
  scope: RequestScope,
  url: URL,
): Effect.Effect<ReactElement, ReadFailure, RequestServices> {
  return Effect.gen(function* () {
    const data = yield* loadEpics(scope, url)
    return <EpicsPage scope={scope} {...(data ?? { workspaceSlug: '', initialData: null })} />
  })
}
