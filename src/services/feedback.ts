import type { Effect } from 'effect'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'

import { queryEffect } from './errors.ts'
import type { DataQueryError } from './errors.ts'

export type FeedbackProjectOptions = Readonly<{ projectId: string }>
export type ListFeedbackOptions = FeedbackProjectOptions &
  Readonly<{
    status?: 'new' | 'reviewed' | 'actioned'
    sourceId?: string
  }>
export interface FeedbackJoinRow {
  id: string
  source_id: string
  source_name: string | null
  rating: number | null
  rating_scale: string | null
  body: string | null
  submitter_label: string | null
  source_url: string | null
  app_version: string | null
  status: string
  linked_issue_id: string | null
  created_at: number
}
export interface FeedbackSummaryRow {
  source_id: string
  source_name: string | null
  app_version: string | null
  total: number
  thumbs_up: number
  thumbs_total: number
  five_star_avg: number | null
  five_star_total: number
  with_comment_count: number
  last_seen_at: number
}
export interface FeedbackSourceListRow {
  id: string
  token_hash: string
  name: string
  description: string | null
  is_active: number
  allowed_origins: string | null
  created_at: number
  revoked_at: number | null
}
export interface FeedbackSourceRow extends FeedbackSourceListRow {
  project_id: string
}

/**
 * Validated filters only. Authorization and response shaping belong to callers.
 *
 * @param {D1Database} db The D1 connection for feedback data.
 * @param {string} workspaceId The workspace to query.
 * @param {ListFeedbackOptions} opts The project and optional source and status filters.
 * @returns {Effect.Effect<FeedbackJoinRow[], DataQueryError>} An effect that reads matching feedback rows in reverse creation order.
 */
export const listFeedback = function listFeedback(
  db: D1Database,
  workspaceId: string,
  opts: ListFeedbackOptions,
): Effect.Effect<FeedbackJoinRow[], DataQueryError> {
  return queryEffect('listFeedback', async () => {
    const clauses = ['f.project_id = ?', 'f.workspace_id = ?']
    const binds: unknown[] = [opts.projectId, workspaceId]
    if (opts.status) {
      clauses.push('f.status = ?')
      binds.push(opts.status)
    }
    if (isNonEmptyText(opts.sourceId)) {
      clauses.push('f.source_id = ?')
      binds.push(opts.sourceId)
    }
    const { results } = await db
      .prepare(`SELECT f.id, f.source_id, s.name AS source_name, f.rating, f.rating_scale, f.body,
            f.submitter_label, f.source_url, f.app_version, f.status, f.linked_issue_id, f.created_at
       FROM feedback f
       LEFT JOIN feedback_sources s ON s.id = f.source_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY f.created_at DESC`)
      .bind(...binds)
      .all<FeedbackJoinRow>()
    return results ?? []
  })
}

/**
 * Raw aggregate rows retain database semantics, including null averages.
 *
 * @param {D1Database} db The D1 connection for feedback data.
 * @param {string} workspaceId The workspace to query.
 * @param {FeedbackProjectOptions} opts The project to summarize.
 * @returns {Effect.Effect<FeedbackSummaryRow[], DataQueryError>} An effect that reads aggregates by source and app version.
 */
export const readFeedbackSummary = function readFeedbackSummary(
  db: D1Database,
  workspaceId: string,
  opts: FeedbackProjectOptions,
): Effect.Effect<FeedbackSummaryRow[], DataQueryError> {
  return queryEffect('readFeedbackSummary', async () => {
    const { results } = await db
      .prepare(`SELECT
         f.source_id, s.name AS source_name, f.app_version,
         COUNT(*) AS total,
         SUM(CASE WHEN f.rating_scale = 'thumbs' AND f.rating > 0 THEN 1 ELSE 0 END) AS thumbs_up,
         SUM(CASE WHEN f.rating_scale = 'thumbs' THEN 1 ELSE 0 END) AS thumbs_total,
         AVG(CASE WHEN f.rating_scale = 'five_star' THEN f.rating END) AS five_star_avg,
         SUM(CASE WHEN f.rating_scale = 'five_star' THEN 1 ELSE 0 END) AS five_star_total,
         SUM(CASE WHEN f.body IS NOT NULL AND f.body != '' THEN 1 ELSE 0 END) AS with_comment_count,
         MAX(f.created_at) AS last_seen_at
       FROM feedback f
       LEFT JOIN feedback_sources s ON s.id = f.source_id
       WHERE f.project_id = ? AND f.workspace_id = ?
       GROUP BY f.source_id, f.app_version
       ORDER BY last_seen_at DESC`)
      .bind(opts.projectId, workspaceId)
      .all<FeedbackSummaryRow>()
    return results ?? []
  })
}

export const listFeedbackSources = function listFeedbackSources(
  db: D1Database,
  workspaceId: string,
  opts: FeedbackProjectOptions,
): Effect.Effect<FeedbackSourceListRow[], DataQueryError> {
  return queryEffect('listFeedbackSources', async () => {
    const { results } = await db
      .prepare(`SELECT id, token_hash, name, description, is_active, allowed_origins, created_at, revoked_at
       FROM feedback_sources WHERE project_id = ? AND workspace_id = ? ORDER BY created_at DESC`)
      .bind(opts.projectId, workspaceId)
      .all<FeedbackSourceListRow>()
    return results ?? []
  })
}

/**
 * Token hashes are database model fields, never a browser response contract.
 *
 * @param {D1Database} db The D1 connection for feedback data.
 * @param {string} workspaceId The workspace to query.
 * @param {string} sourceId The feedback source ID in the workspace.
 * @returns {Effect.Effect<FeedbackSourceRow | null, DataQueryError>} An effect that reads the source row, or null if it is missing.
 */
export const findFeedbackSourceById = function findFeedbackSourceById(
  db: D1Database,
  workspaceId: string,
  sourceId: string,
): Effect.Effect<FeedbackSourceRow | null, DataQueryError> {
  return queryEffect('findFeedbackSourceById', () =>
    db
      .prepare(`SELECT id, project_id, token_hash, name, description, is_active, allowed_origins, created_at, revoked_at
       FROM feedback_sources WHERE id = ? AND workspace_id = ?`)
      .bind(sourceId, workspaceId)
      .first<FeedbackSourceRow>(),
  )
}
