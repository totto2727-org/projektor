import { String, Predicate, Iterable, Effect, Schema } from 'effect'

import * as sources from '#commands/feedback-sources.ts'
import * as commands from '#commands/feedback.ts'
import type { ServiceCtx } from '#commands/types.ts'
import { ScopeError } from '#contracts/errors.ts'
import { HTTP_FORBIDDEN, HTTP_BAD_REQUEST } from '#contracts/http-status.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { requireDataProject, requireDataWorkspace } from '#contracts/web-data.ts'
import {
  FeedbackIndexSchema,
  FeedbackDetailSchema,
  StatusFields,
  CreatedSource,
  Converted,
  Ok,
} from '#contracts/web-schemas/feedback.ts'
import type { CoreReply } from '#core/contract.ts'
import { coreFailure, coreReply } from '#core/contract.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import * as queries from '#services/feedback.ts'

import { loadBrowserScope, publicWebFailure } from './authentication.ts'
import type { BrowserCommand } from './command-contract.ts'
import { browserCommand } from './command.ts'
import { checked } from './issue-data.ts'
import { webRead } from './issue-operations.ts'
import type { WebRequest } from './scope.ts'

const admin = function admin(role: string): void {
  if (role !== 'owner' && role !== 'admin') {
    throw new ScopeError(HTTP_FORBIDDEN, 'Insufficient permissions')
  }
}
const sourceDto = function sourceDto(row: queries.FeedbackSourceListRow) {
  return fieldsInOrder([
    ['id', row.id],
    ['name', row.name],
    ['description', row.description],
    ['isActive', row.is_active === 1],
    ['allowedOrigins', row.allowed_origins ? JSON.parse(row.allowed_origins) : null],
    ['tokenPreview', `${row.token_hash.slice(0, 12)}…`],
    ['createdAt', row.created_at],
    ['revokedAt', row.revoked_at],
  ])
}
const summaryDtos = function summaryDtos(rows: queries.FeedbackSummaryRow[]) {
  const map = new Map<
    string,
    {
      sourceId: string
      sourceName: string | null
      totalCount: number
      versions: {
        appVersion: string | null
        totalCount: number
        withCommentCount: number
        thumbsUpPct: number | null
        avgFiveStar: number | null
        lastSeenAt: number
      }[]
    }
  >()
  Iterable.forEach(rows, (row) => {
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
  })
  return [...map.values()]
}
const loadSources = function loadSources(env: CoreEnvironment, workspaceId: string, projectId: string) {
  return queries
    .listFeedbackSources(env.DB, workspaceId, { projectId })
    .pipe(Effect.flatMap((rows) => Effect.try({ catch: publicWebFailure, try: () => rows.map(sourceDto) })))
}
const loadSummaries = function loadSummaries(env: CoreEnvironment, workspaceId: string, projectId: string) {
  return queries.readFeedbackSummary(env.DB, workspaceId, { projectId }).pipe(Effect.map(summaryDtos))
}

export const makeFeedbackHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => {
  const mutation = function mutation<S extends Schema.Top, A>(
    name: string,
    schema: S,
    proof: BrowserCommand,
    operation: (ctx: ServiceCtx) => Promise<A>,
  ): CoreReply<R, S> {
    return Effect.flatMap(envSource, (env) => coreReply(name, schema, browserCommand(env, proof, operation)))
  }
  return {
    webFeedbackIndex: (request: WebRequest, workspaceId: string, projectId: string): CoreReply<R> =>
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
    webFeedbackDetail: (request: WebRequest, sourceId: string, status: string, workspaceId?: string): CoreReply<R> =>
      Effect.flatMap(envSource, (env) =>
        coreReply(
          'webFeedbackDetail',
          FeedbackDetailSchema,
          Effect.gen(function* () {
            const scope = yield* loadBrowserScope(
              env,
              request,
              fieldsInOrder([
                ['workspaceHint', ''],
                ['projectHint', ''],
              ]),
            )
            const filter = yield* Schema.decodeUnknownEffect(StatusFields)({ status }).pipe(
              Effect.mapError(() => coreFailure(HTTP_BAD_REQUEST, 'Invalid feedback status.')),
            )
            const candidates =
              Predicate.isNotNullish(workspaceId) && String.isNonEmpty(workspaceId)
                ? scope.workspaces.filter((workspace) => workspace.id === workspaceId)
                : scope.workspaces
            for (const workspace of candidates) {
              const row = yield* queries.findFeedbackSourceById(env.DB, workspace.id, sourceId)
              if (!row) {
                continue
              }
              const projectId = row.project_id
              if (
                !scope.projects.some(
                  (project) =>
                    project.id === projectId &&
                    project.workspace_id === workspace.id &&
                    project.workspace_slug === workspace.slug,
                )
              ) {
                return null
              }
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
                        rows.map((item) =>
                          fieldsInOrder([
                            ['id', item.id],
                            ['sourceId', item.source_id],
                            ['sourceName', item.source_name],
                            ['rating', item.rating],
                            ['ratingScale', item.rating_scale],
                            ['body', item.body],
                            ['submitterLabel', item.submitter_label],
                            ['sourceUrl', item.source_url],
                            ['appVersion', item.app_version],
                            ['status', item.status],
                            ['linkedIssueId', item.linked_issue_id],
                            ['createdAt', item.created_at],
                          ]),
                        ),
                      ),
                    ),
                },
                { concurrency: 3 },
              )
              const source = loaded.sources.find((item) => item.id === sourceId)
              if (!source) {
                return null
              }
              return fieldsInOrder([
                ['source', source],
                ['sources', loaded.sources],
                ['rows', loaded.rows],
                ['summary', loaded.summaries.find((item) => item.sourceId === sourceId) ?? null],
                ['status', filter.status],
                ['projectId', projectId],
                ['workspaceSlug', workspace.slug],
              ])
            }
            return null
          }).pipe(Effect.mapError(publicWebFailure)),
        ),
      ),
    webCreateFeedbackSource: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      mutation('webCreateFeedbackSource', CreatedSource, proof, async (ctx) =>
        sources.createFeedbackSource(ctx, input),
      ),
    webUpdateFeedbackSource: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      mutation('webUpdateFeedbackSource', Ok, proof, async (ctx) => sources.updateFeedbackSource(ctx, input)),
    webRotateFeedbackSourceToken: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      mutation('webRotateFeedbackSourceToken', Schema.Struct({ token: Schema.String }), proof, async (ctx) =>
        sources.rotateFeedbackSourceToken(ctx, input),
      ),
    webRevokeFeedbackSource: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      mutation('webRevokeFeedbackSource', Ok, proof, async (ctx) => sources.revokeFeedbackSource(ctx, input)),
    webUpdateFeedbackStatus: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      mutation('webUpdateFeedbackStatus', Ok, proof, async (ctx) => commands.updateFeedbackStatus(ctx, input)),
    webConvertFeedback: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      mutation('webConvertFeedback', Converted, proof, async (ctx) => commands.convertFeedbackToIssue(ctx, input)),
    webBulkReviewFeedback: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      mutation('webBulkReviewFeedback', Schema.Struct({ updated: Schema.Number }), proof, async (ctx) =>
        commands.bulkMarkReviewed(ctx, input),
      ),
    webBulkConvertFeedback: (proof: BrowserCommand, input: unknown): CoreReply<R> =>
      mutation(
        'webBulkConvertFeedback',
        Schema.Struct({ ...Converted.fields, convertedCount: Schema.Number }),
        proof,
        async (ctx) => commands.bulkConvertToIssue(ctx, input),
      ),
  }
}
