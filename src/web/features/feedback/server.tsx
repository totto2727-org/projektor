import { Effect, Schema } from 'effect'

import * as feedbackQueries from '#services/feedback'

import { RequestServices } from '../../request'
import type { RequestApi } from '../../server/api-client'
import { dataError, makeDataContext, requireDataProject } from '../../server/data-context'
import { ScopeError } from '../../server/errors'
import type { RequestScope } from '../../server/request-context'
import { FeedbackDetailClient } from './FeedbackDetailClient'
import { FeedbackGridClient } from './FeedbackGridClient'
import { Rows, Sources, Summaries, StatusFields, type Summary } from './schemas'

function NeedProject() {
  return (
    <section className='p-6 bg-surface border border-border rounded-lg'>
      <h1 className='m-0'>Choose a project</h1>
      <p className='text-text-muted'>Feedback sources are managed within a project.</p>
    </section>
  )
}
function NotFound() {
  return (
    <section className='p-6 text-center text-text-muted bg-surface rounded-lg border border-border'>
      Feedback source not found.
    </section>
  )
}
function authorize<T>(read: () => T) {
  return Effect.try({
    try: read,
    catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
  })
}
function requireSourceAdmin(role: string) {
  if (role !== 'owner' && role !== 'admin') throw new ScopeError(403, 'Insufficient permissions')
}
function sourceDto(row: feedbackQueries.FeedbackSourceListRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active === 1,
    allowedOrigins: row.allowed_origins ? JSON.parse(row.allowed_origins) : null,
    tokenPreview: `${row.token_hash.slice(0, 12)}…`,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }
}
function summaryDtos(rows: feedbackQueries.FeedbackSummaryRow[]) {
  const sources = new Map<string, { -readonly [Key in keyof typeof Summary.Type]: (typeof Summary.Type)[Key] }>()
  for (const row of rows) {
    let source = sources.get(row.source_id)
    if (!source) {
      source = {
        sourceId: row.source_id,
        sourceName: row.source_name,
        totalCount: 0,
        versions: [],
      }
      sources.set(row.source_id, source)
    }
    source.totalCount += row.total
    source.versions.push({
      appVersion: row.app_version,
      totalCount: row.total,
      withCommentCount: row.with_comment_count,
      thumbsUpPct: row.thumbs_total > 0 ? Math.round((row.thumbs_up / row.thumbs_total) * 100) : null,
      avgFiveStar: row.five_star_total > 0 ? row.five_star_avg : null,
      lastSeenAt: row.last_seen_at,
    })
  }
  return [...sources.values()]
}
function loadSources(db: Parameters<typeof feedbackQueries.listFeedback>[0], workspaceId: string, projectId: string) {
  return feedbackQueries.listFeedbackSources(db, workspaceId, { projectId }).pipe(
    Effect.flatMap((rows) => Effect.try({ try: () => rows.map(sourceDto), catch: dataError })),
    Effect.flatMap(Schema.decodeUnknownEffect(Sources)),
    Effect.mapError(dataError),
  )
}
function loadSummaries(db: Parameters<typeof feedbackQueries.listFeedback>[0], workspaceId: string, projectId: string) {
  return feedbackQueries
    .readFeedbackSummary(db, workspaceId, { projectId })
    .pipe(Effect.map(summaryDtos), Effect.flatMap(Schema.decodeUnknownEffect(Summaries)), Effect.mapError(dataError))
}

/** Pure reads use the request-local DB. Source-management policy remains in the web app. */
export function renderFeedback(_api: RequestApi, scope: RequestScope, _url: URL) {
  return Effect.gen(function* () {
    if (scope.selection.kind !== 'project') return <NeedProject />
    const services = yield* RequestServices
    const { project, workspace } = scope.selection
    const ctx = yield* authorize(() => {
      const context = makeDataContext(services, scope, workspace.id)
      requireDataProject(scope, project.id, workspace.id)
      requireSourceAdmin(context.workspace.role)
      return context
    })
    const { sources, summaries } = yield* Effect.all(
      {
        sources: loadSources(ctx.db, ctx.workspaceId, project.id),
        summaries: loadSummaries(ctx.db, ctx.workspaceId, project.id),
      },
      { concurrency: 2 },
    )
    return (
      <FeedbackGridClient
        key={`${workspace.slug}:${project.id}`}
        initialSources={sources}
        initialSummaries={summaries}
        projectId={project.id}
        workspaceSlug={workspace.slug}
      />
    )
  })
}

/** Lookup is workspace-scoped, and the source's actual project must be in the authorized catalog. */
export function renderFeedbackDetail(
  _api: RequestApi,
  scope: RequestScope,
  url: URL,
  params: Readonly<Record<string, string | undefined>> = {},
) {
  return Effect.gen(function* () {
    const sourceId = params.sourceId ?? url.searchParams.get('sourceId') ?? url.searchParams.get('id')
    if (!sourceId) return <NotFound />
    const services = yield* RequestServices
    const chosen =
      scope.selection.kind === 'workspace' || scope.selection.kind === 'project' ? scope.selection.workspace : null
    const candidates = chosen ? [chosen] : scope.workspaces
    let entity: { projectId: string; workspaceId: string; workspaceSlug: string } | null = null
    for (const workspace of candidates) {
      const ctx = yield* authorize(() => makeDataContext(services, scope, workspace.id))
      const source = yield* feedbackQueries
        .findFeedbackSourceById(ctx.db, ctx.workspaceId, sourceId)
        .pipe(Effect.mapError(dataError))
      if (!source) continue
      if (
        !scope.projects.some(
          (project) =>
            project.id === source.project_id &&
            project.workspace_id === workspace.id &&
            project.workspace_slug === workspace.slug,
        )
      )
        return <NotFound />
      yield* authorize(() => requireDataProject(scope, source.project_id, workspace.id))
      entity = {
        projectId: source.project_id,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
      }
      break
    }
    if (!entity) return <NotFound />
    const { projectId, workspaceId, workspaceSlug } = entity
    const ctx = yield* authorize(() => {
      const context = makeDataContext(services, scope, workspaceId)
      requireSourceAdmin(context.workspace.role)
      return context
    })
    const { status: initialStatus } = yield* Schema.decodeUnknownEffect(StatusFields)({
      status: url.searchParams.get('status') ?? '',
    }).pipe(Effect.mapError(() => new ScopeError(400, 'Invalid feedback status.')))
    const { sources, rows, summaries } = yield* Effect.all(
      {
        sources: loadSources(ctx.db, workspaceId, projectId),
        rows: feedbackQueries
          .listFeedback(ctx.db, workspaceId, {
            projectId,
            sourceId,
            ...(initialStatus ? { status: initialStatus } : {}),
          })
          .pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                id: row.id,
                sourceId: row.source_id,
                sourceName: row.source_name,
                rating: row.rating,
                ratingScale: row.rating_scale,
                body: row.body,
                submitterLabel: row.submitter_label,
                sourceUrl: row.source_url,
                appVersion: row.app_version,
                status: row.status,
                linkedIssueId: row.linked_issue_id,
                createdAt: row.created_at,
              })),
            ),
            Effect.flatMap(Schema.decodeUnknownEffect(Rows)),
            Effect.mapError(dataError),
          ),
        summaries: loadSummaries(ctx.db, workspaceId, projectId),
      },
      { concurrency: 3 },
    )
    const source = sources.find((item) => item.id === sourceId)
    if (!source) return <NotFound />
    const tab = url.searchParams.get('tab')
    const initialTab = tab === 'summary' || tab === 'settings' ? tab : 'items'
    return (
      <FeedbackDetailClient
        key={`${workspaceSlug}:${sourceId}`}
        initialSource={source}
        initialSources={sources}
        initialRows={rows}
        initialSummary={summaries.find((item) => item.sourceId === sourceId) ?? null}
        initialStatus={initialStatus}
        initialTab={initialTab}
        projectId={projectId}
        workspaceSlug={workspaceSlug}
      />
    )
  })
}
