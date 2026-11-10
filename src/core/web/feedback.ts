import { Effect, Schema } from 'effect'

import * as commands from '#commands/feedback'
import * as sources from '#commands/feedback-sources'
import type { ServiceCtx } from '#commands/types'
import * as queries from '#services/feedback'

import { ScopeError } from '../../contracts/errors'
import { requireDataProject, requireDataWorkspace } from '../../contracts/web-data'
import {
  FeedbackIndexSchema,
  FeedbackDetailSchema,
  StatusFields,
  CreatedSource,
  Converted,
  Ok,
} from '../../contracts/web-schemas/feedback'
import { coreFailure, coreReply } from '../contract'
import type { CoreEnvironment } from '../environment'
import { loadBrowserScope, publicWebFailure } from './authentication'
import { browserCommand } from './command'
import type { BrowserCommand } from './command-contract'
import { checked } from './issue-data'
import { webRead } from './issue-operations'
import type { WebRequest } from './scope'

function admin(role: string) {
  if (role !== 'owner' && role !== 'admin') throw new ScopeError(403, 'Insufficient permissions')
}
function sourceDto(row: queries.FeedbackSourceListRow) {
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
function summaryDtos(rows: queries.FeedbackSummaryRow[]) {
  const map = new Map<
    string,
    {
      sourceId: string
      sourceName: string | null
      totalCount: number
      versions: Array<{
        appVersion: string | null
        totalCount: number
        withCommentCount: number
        thumbsUpPct: number | null
        avgFiveStar: number | null
        lastSeenAt: number
      }>
    }
  >()
  for (const row of rows) {
    let source = map.get(row.source_id)
    if (!source) {
      source = { sourceId: row.source_id, sourceName: row.source_name, totalCount: 0, versions: [] }
      map.set(row.source_id, source)
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
  return [...map.values()]
}
function loadSources(env: CoreEnvironment, workspaceId: string, projectId: string) {
  return queries
    .listFeedbackSources(env.DB, workspaceId, { projectId })
    .pipe(Effect.flatMap((rows) => Effect.try({ try: () => rows.map(sourceDto), catch: publicWebFailure })))
}
function loadSummaries(env: CoreEnvironment, workspaceId: string, projectId: string) {
  return queries.readFeedbackSummary(env.DB, workspaceId, { projectId }).pipe(Effect.map(summaryDtos))
}

export const makeFeedbackHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => {
  function mutation<S extends Schema.Top, A>(
    name: string,
    schema: S,
    proof: BrowserCommand,
    operation: (ctx: ServiceCtx) => Promise<A>,
  ) {
    return Effect.flatMap(envSource, (env) => coreReply(name, schema, browserCommand(env, proof, operation)))
  }
  return {
    webFeedbackIndex: (request: WebRequest, workspaceId: string, projectId: string) =>
      Effect.flatMap(envSource, (env) =>
        coreReply(
          'webFeedbackIndex',
          FeedbackIndexSchema,
          webRead(
            env,
            request,
            workspaceId,
            (scope) =>
              Effect.gen(function* () {
                const workspace = yield* checked(() => requireDataWorkspace(scope, workspaceId))
                yield* checked(() => {
                  requireDataProject(scope, projectId, workspaceId)
                  admin(workspace.role)
                })
                return yield* Effect.all(
                  {
                    sources: loadSources(env, workspaceId, projectId),
                    summaries: loadSummaries(env, workspaceId, projectId),
                  },
                  { concurrency: 2 },
                )
              }),
            projectId,
          ),
        ),
      ),
    webFeedbackDetail: (request: WebRequest, sourceId: string, status: string, workspaceId?: string) =>
      Effect.flatMap(envSource, (env) =>
        coreReply(
          'webFeedbackDetail',
          FeedbackDetailSchema,
          Effect.gen(function* () {
            const scope = yield* loadBrowserScope(env, request, { workspaceHint: '', projectHint: '' })
            const filter = yield* Schema.decodeUnknownEffect(StatusFields)({ status }).pipe(
              Effect.mapError(() => coreFailure(400, 'Invalid feedback status.')),
            )
            const candidates = workspaceId
              ? scope.workspaces.filter((workspace) => workspace.id === workspaceId)
              : scope.workspaces
            for (const workspace of candidates) {
              const row = yield* queries.findFeedbackSourceById(env.DB, workspace.id, sourceId)
              if (!row) continue
              const projectId = row.project_id
              if (
                !scope.projects.some(
                  (project) =>
                    project.id === projectId &&
                    project.workspace_id === workspace.id &&
                    project.workspace_slug === workspace.slug,
                )
              )
                return null
              yield* checked(() => {
                requireDataProject(scope, projectId, workspace.id)
                admin(workspace.role)
              })
              const loaded = yield* Effect.all(
                {
                  sources: loadSources(env, workspace.id, projectId),
                  summaries: loadSummaries(env, workspace.id, projectId),
                  rows: queries
                    .listFeedback(env.DB, workspace.id, {
                      projectId,
                      sourceId,
                      ...(filter.status ? { status: filter.status } : {}),
                    })
                    .pipe(
                      Effect.map((rows) =>
                        rows.map((item) => ({
                          id: item.id,
                          sourceId: item.source_id,
                          sourceName: item.source_name,
                          rating: item.rating,
                          ratingScale: item.rating_scale,
                          body: item.body,
                          submitterLabel: item.submitter_label,
                          sourceUrl: item.source_url,
                          appVersion: item.app_version,
                          status: item.status,
                          linkedIssueId: item.linked_issue_id,
                          createdAt: item.created_at,
                        })),
                      ),
                    ),
                },
                { concurrency: 3 },
              )
              const source = loaded.sources.find((item) => item.id === sourceId)
              if (!source) return null
              return {
                source,
                sources: loaded.sources,
                rows: loaded.rows,
                summary: loaded.summaries.find((item) => item.sourceId === sourceId) ?? null,
                status: filter.status,
                projectId,
                workspaceSlug: workspace.slug,
              }
            }
            return null
          }).pipe(Effect.mapError(publicWebFailure)),
        ),
      ),
    webCreateFeedbackSource: (proof: BrowserCommand, input: unknown) =>
      mutation('webCreateFeedbackSource', CreatedSource, proof, (ctx) => sources.createFeedbackSource(ctx, input)),
    webUpdateFeedbackSource: (proof: BrowserCommand, input: unknown) =>
      mutation('webUpdateFeedbackSource', Ok, proof, (ctx) => sources.updateFeedbackSource(ctx, input)),
    webRotateFeedbackSourceToken: (proof: BrowserCommand, input: unknown) =>
      mutation('webRotateFeedbackSourceToken', Schema.Struct({ token: Schema.String }), proof, (ctx) =>
        sources.rotateFeedbackSourceToken(ctx, input),
      ),
    webRevokeFeedbackSource: (proof: BrowserCommand, input: unknown) =>
      mutation('webRevokeFeedbackSource', Ok, proof, (ctx) => sources.revokeFeedbackSource(ctx, input)),
    webUpdateFeedbackStatus: (proof: BrowserCommand, input: unknown) =>
      mutation('webUpdateFeedbackStatus', Ok, proof, (ctx) => commands.updateFeedbackStatus(ctx, input)),
    webConvertFeedback: (proof: BrowserCommand, input: unknown) =>
      mutation('webConvertFeedback', Converted, proof, (ctx) => commands.convertFeedbackToIssue(ctx, input)),
    webBulkReviewFeedback: (proof: BrowserCommand, input: unknown) =>
      mutation('webBulkReviewFeedback', Schema.Struct({ updated: Schema.Number }), proof, (ctx) =>
        commands.bulkMarkReviewed(ctx, input),
      ),
    webBulkConvertFeedback: (proof: BrowserCommand, input: unknown) =>
      mutation(
        'webBulkConvertFeedback',
        Schema.Struct({ ...Converted.fields, convertedCount: Schema.Number }),
        proof,
        (ctx) => commands.bulkConvertToIssue(ctx, input),
      ),
  }
}
