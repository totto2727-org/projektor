import { Effect, Schema } from 'effect'

import { dataError, requireDataProject, requireDataWorkspace } from '../../server/data-context'
import { ApiError, ScopeError } from '../../server/errors'
import type { RequestScope } from '../../server/request-context'
import { readDataIssuePage, readSprints } from '../issues/data'
import { readFlowMetrics, readCodeHeatmap } from './data'
import { dateEpochEnd, dateEpochStart, rangeFromUrl } from './helpers'
import { MetricsWindowSchema, SprintListModeSchema } from './input-schemas'
import { IssuePageSchema } from './schemas'
import type { SprintIssue } from './types'
import { MetricsDashboard, SprintManager } from './widgets'

function selectedProject(scope: RequestScope, projectId: string, workspaceId: string) {
  return Effect.try({
    try: () => {
      requireDataWorkspace(scope, workspaceId)
      return requireDataProject(scope, projectId, workspaceId)
    },
    catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
  })
}

/** Fully page scoped issue DTOs on the server, including completed velocity history. */
export function loadSprintIssues(projectId: string, workspaceSlug: string, scope: RequestScope) {
  return Effect.gen(function* () {
    const workspace = scope.workspaces.find((item) => item.slug === workspaceSlug)
    if (!workspace) return yield* new ScopeError(403, 'Selected workspace is not accessible.')
    yield* selectedProject(scope, projectId, workspace.id)
    const issues: SprintIssue[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    let nextCursor: string | null
    do {
      const query = new URLSearchParams({ projectId, limit: '100' })
      if (cursor) query.set('cursor', cursor)
      const page = yield* readDataIssuePage(scope, workspace.id, query).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(IssuePageSchema)),
        Effect.mapError(dataError),
      )
      issues.push(...page.items)
      nextCursor = page.nextCursor
      if (nextCursor && cursors.has(nextCursor))
        return yield* new ApiError('schema', 502, 'Repeated issue pagination cursor')
      if (nextCursor) {
        cursors.add(nextCursor)
        cursor = nextCursor
      }
    } while (nextCursor)
    return issues
  })
}
export function renderSprints(scope: RequestScope, url: URL) {
  return Effect.gen(function* () {
    if (scope.selection.kind !== 'project')
      return <p className='text-text-muted'>Select a project to view its sprints.</p>
    const { project, workspace } = scope.selection
    yield* selectedProject(scope, project.id, workspace.id)
    const mode = yield* Schema.decodeUnknownEffect(SprintListModeSchema)(url.searchParams.get('status') ?? 'all').pipe(
      Effect.mapError(() => new ScopeError(400, 'Invalid sprint status view.')),
    )
    const [sprints, issues] = yield* Effect.all(
      [readSprints(workspace.id, project.id), loadSprintIssues(project.id, workspace.slug, scope)],
      { concurrency: 2 },
    )
    return (
      <SprintManager
        key={`${workspace.slug}:${project.id}`}
        project={project}
        projectId={project.id}
        workspaceSlug={workspace.slug}
        initialSprints={mode === 'all' ? [...sprints] : sprints.filter((sprint) => sprint.status === mode)}
        allSprints={[...sprints]}
        mode={mode}
        initialIssues={issues}
      />
    )
  })
}
export function renderMetrics(scope: RequestScope, url: URL) {
  return Effect.gen(function* () {
    if (scope.selection.kind !== 'project') return <p className='text-text-muted'>Select a project to view metrics.</p>
    const { project, workspace } = scope.selection
    yield* selectedProject(scope, project.id, workspace.id)
    const fallback = rangeFromUrl(new URL(url.pathname, url.origin))
    const window = yield* Schema.decodeUnknownEffect(MetricsWindowSchema)({
      projectId: project.id,
      workspaceSlug: workspace.slug,
      since: url.searchParams.get('since') ?? fallback.since,
      until: url.searchParams.get('until') ?? fallback.until,
      granularity: url.searchParams.get('granularity') ?? fallback.granularity,
      heatmapMode: url.searchParams.get('heatmapMode') ?? 'claims',
      prefix: url.searchParams.get('prefix') ?? '',
    }).pipe(Effect.mapError(() => new ScopeError(400, 'Invalid metrics date range or chart options.')))
    const range = { since: window.since, until: window.until, granularity: window.granularity }
    const mode = window.heatmapMode
    const prefix = window.prefix
    const queryRange = {
      projectId: project.id,
      since: dateEpochStart(range.since),
      until: dateEpochEnd(range.until),
    }
    const [metrics, heatmap] = yield* Effect.all(
      [
        readFlowMetrics(workspace.id, { ...queryRange, granularity: range.granularity, mode, prefix }),
        readCodeHeatmap(workspace.id, { ...queryRange, granularity: range.granularity, mode, prefix }).pipe(
          Effect.map((data) => ({ data, error: null })),
          Effect.catch(() =>
            Effect.succeed({
              data: null,
              error: 'Failed to load code heatmap. Try applying the range again.',
            }),
          ),
        ),
      ],
      { concurrency: 2 },
    )
    // Canonical links carry the selected project/workspace and the effective default range.
    const canonical = new URL(url)
    canonical.searchParams.set('projectId', project.id)
    canonical.searchParams.set('workspace', workspace.slug)
    canonical.searchParams.set('since', range.since)
    canonical.searchParams.set('until', range.until)
    canonical.searchParams.set('granularity', range.granularity)
    return (
      <MetricsDashboard
        key={`${workspace.slug}:${project.id}:${range.since}:${range.until}:${range.granularity}:${mode}:${prefix}`}
        projectId={project.id}
        workspaceSlug={workspace.slug}
        initialMetrics={metrics}
        initialUrl={canonical.toString()}
        initialRange={range}
        initialHeatmap={heatmap.data}
        heatmapMode={mode}
        heatmapError={heatmap.error}
      />
    )
  })
}
