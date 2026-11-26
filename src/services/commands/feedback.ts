import { String, Iterable, Predicate, Effect, Number } from 'effect'
import { flattenError } from 'zod'

import {
  BulkFeedbackIdsSchema,
  ConvertFeedbackSchema,
  ListFeedbackSchema,
  SubmitFeedbackSchema,
  UpdateFeedbackSchema,
} from '#contracts/inputs/feedback.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import * as feedbackQueries from '#services/feedback.ts'

import { canWriteProject, requireProjectAccess, requireProjectInWorkspace } from './access.ts'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors.ts'
import { createIssueFromFeedback } from './issues.ts'
import { inChunks } from './sql.ts'
import type { ServiceCtx } from './types.ts'

const ACTIVE_SOURCE_FLAG = 1
const POSITIVE_THUMBS_THRESHOLD = 0
const CONVERTED_TITLE_MAX_LENGTH = 120
const NO_RATINGS = 0
const PERCENT_MULTIPLIER = 100

const requireProjectWriteAccess = async function requireProjectWriteAccess(
  ctx: ServiceCtx,
  projectId: string,
): Promise<void> {
  await requireProjectInWorkspace(ctx, projectId)
  const role = await requireProjectAccess(ctx, projectId)
  if (!canWriteProject(role)) {
    throw new ForbiddenError('Insufficient permissions')
  }
}

export const hashFeedbackToken = async function hashFeedbackToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface SubmitSourceRow {
  id: string
  workspace_id: string
  project_id: string
  is_active: number
  allowed_origins: string | null
  revoked_at: number | null
}

const resolveFeedbackSource = async function resolveFeedbackSource(
  db: D1Database,
  tokenHash: string,
): Promise<SubmitSourceRow> {
  const source = await db
    .prepare(
      `SELECT id, workspace_id, project_id, is_active, allowed_origins, revoked_at
       FROM feedback_sources WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<SubmitSourceRow>()

  // Unknown or revoked → treated as an invalid credential (route maps NotFound → 401).
  if (!source || Predicate.isNotNullish(source.revoked_at)) {
    throw new NotFoundError('Invalid feedback token')
  }
  // Inactive → the credential is real but the source is paused (kill switch) → 403.
  if (source.is_active !== ACTIVE_SOURCE_FLAG) {
    throw new ForbiddenError('Feedback source is inactive')
  }

  return source
}

const parseSubmitFeedbackBody = function parseSubmitFeedbackBody(rawBody: unknown) {
  const parsed = SubmitFeedbackSchema.safeParse(rawBody)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  return parsed.data
}

const insertFeedbackRow = async function insertFeedbackRow(
  db: D1Database,
  source: SubmitSourceRow,
  input: ReturnType<typeof parseSubmitFeedbackBody>,
): Promise<string> {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await db
    .prepare(
      `INSERT INTO feedback
       (id, source_id, workspace_id, project_id, rating, rating_scale, body, submitter_label,
        source_url, app_version, status, linked_issue_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', NULL, ?)`,
    )
    .bind(
      id,
      source.id,
      source.workspace_id,
      source.project_id,
      input.rating ?? null,
      input.ratingScale ?? null,
      input.body ?? null,
      input.submitterLabel ?? null,
      input.sourceUrl ?? null,
      input.appVersion ?? null,
      now,
    )
    .run()
  return id
}

const resolveCorsAllowOrigin = function resolveCorsAllowOrigin(
  source: SubmitSourceRow,
  requestOrigin: string | null,
): string | null {
  const allowed = source.allowed_origins ? (JSON.parse(source.allowed_origins) as string[]) : null
  return allowed &&
    Predicate.isNotNullish(requestOrigin) &&
    String.isNonEmpty(requestOrigin) &&
    allowed.includes(requestOrigin)
    ? requestOrigin
    : null
}

export const submitFeedback = async function submitFeedback(
  db: D1Database,
  token: string,
  rawBody: unknown,
  requestOrigin: string | null,
): Promise<{ id: string; corsAllowOrigin: string | null }> {
  const tokenHash = await hashFeedbackToken(token)
  const source = await resolveFeedbackSource(db, tokenHash)
  const input = parseSubmitFeedbackBody(rawBody)
  const id = await insertFeedbackRow(db, source, input)
  const corsAllowOrigin = resolveCorsAllowOrigin(source, requestOrigin)
  return { id, corsAllowOrigin }
}

export interface FeedbackView {
  id: string
  sourceId: string
  sourceName: string | null
  rating: number | null
  ratingScale: string | null
  body: string | null
  submitterLabel: string | null
  sourceUrl: string | null
  appVersion: string | null
  status: string
  linkedIssueId: string | null
  createdAt: number
}

export const listFeedback = async function listFeedback(ctx: ServiceCtx, input: unknown): Promise<FeedbackView[]> {
  const parsed = ListFeedbackSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { projectId, status, sourceId } = parsed.data

  await requireProjectInWorkspace(ctx, projectId)
  await requireProjectAccess(ctx, projectId)

  const results = await Effect.runPromise(
    feedbackQueries.listFeedback(ctx.db, ctx.workspaceId, { projectId, status, sourceId }),
  )

  return (results ?? []).map((result) => ({
    id: result.id,
    sourceId: result.source_id,
    sourceName: result.source_name,
    rating: result.rating,
    ratingScale: result.rating_scale,
    body: result.body,
    submitterLabel: result.submitter_label,
    sourceUrl: result.source_url,
    appVersion: result.app_version,
    status: result.status,
    linkedIssueId: result.linked_issue_id,
    createdAt: result.created_at,
  }))
}

interface FeedbackScopeRow {
  project_id: string
}

// REST always passes the URL path's projectId (scoping the lookup, 404 on mismatch);
// MCP omits it and the row's own project_id is used instead.
const requireFeedbackScope = async function requireFeedbackScope(
  ctx: ServiceCtx,
  feedbackId: string,
  projectId: string | undefined,
): Promise<string> {
  const clauses = ['id = ?', 'workspace_id = ?']
  const binds: unknown[] = [feedbackId, ctx.workspaceId]
  if (Predicate.isNotNullish(projectId) && String.isNonEmpty(projectId)) {
    clauses.push('project_id = ?')
    binds.push(projectId)
  }
  const row = await ctx.db
    .prepare(`SELECT project_id FROM feedback WHERE ${clauses.join(' AND ')}`)
    .bind(...binds)
    .first<FeedbackScopeRow>()
  if (!row) {
    throw new NotFoundError('Feedback not found')
  }
  return row.project_id
}

export const updateFeedbackStatus = async function updateFeedbackStatus(
  ctx: ServiceCtx,
  input: unknown,
): Promise<{ ok: true }> {
  const parsed = UpdateFeedbackSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { projectId, feedbackId, status } = parsed.data

  const resolvedProjectId = await requireFeedbackScope(ctx, feedbackId, projectId)
  await requireProjectWriteAccess(ctx, resolvedProjectId)

  await ctx.db
    .prepare('UPDATE feedback SET status = ? WHERE id = ? AND workspace_id = ?')
    .bind(status, feedbackId, ctx.workspaceId)
    .run()

  return { ok: true }
}

const ratingLabel = function ratingLabel(rating: number | null, scale: string | null): string {
  if (Predicate.isNullish(rating)) {
    return 'Rating'
  }
  if (scale === 'thumbs') {
    return rating > POSITIVE_THUMBS_THRESHOLD ? '👍 Positive' : '👎 Negative'
  }
  return `${rating}★`
}

interface ConvertFeedbackRow {
  rating: number | null
  rating_scale: string | null
  body: string | null
  submitter_label: string | null
  status: string
  linked_issue_id: string | null
}

export const convertFeedbackToIssue = async function convertFeedbackToIssue(
  ctx: ServiceCtx,
  input: unknown,
): Promise<{ id: string; number?: number }> {
  const parsed = ConvertFeedbackSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { projectId, feedbackId } = parsed.data

  const resolvedProjectId = await requireFeedbackScope(ctx, feedbackId, projectId)
  await requireProjectWriteAccess(ctx, resolvedProjectId)

  const fb = await ctx.db
    .prepare(
      `SELECT rating, rating_scale, body, submitter_label, status, linked_issue_id
       FROM feedback WHERE id = ? AND project_id = ? AND workspace_id = ?`,
    )
    .bind(feedbackId, resolvedProjectId, ctx.workspaceId)
    .first<ConvertFeedbackRow>()
  if (!fb) {
    throw new NotFoundError('Feedback not found')
  }
  /*
   * Already converted — reject re-conversion rather than silently creating a
   * second issue or re-linking; the caller should follow the existing linked issue.
   */
  if (fb.linked_issue_id) {
    throw new ConflictError('Feedback already converted to an issue')
  }

  const title = fb.body
    ? String.takeLeft(fb.body, CONVERTED_TITLE_MAX_LENGTH)
    : `${ratingLabel(fb.rating, fb.rating_scale)} feedback`
  const footer =
    `— submitted via feedback source${fb.submitter_label ? ` by ${fb.submitter_label}` : ''}` +
    (Predicate.isNotNullish(fb.rating) ? `, rating: ${fb.rating} (${fb.rating_scale})` : '')

  return createIssueFromFeedback(
    ctx,
    {
      projectId: resolvedProjectId,
      title,
      body: [fb.body ?? '', '', footer].join('\n'),
      priority: 'medium',
    },
    [feedbackId],
  )
}

export const bulkMarkReviewed = async function bulkMarkReviewed(
  ctx: ServiceCtx,
  input: unknown,
): Promise<{ updated: number }> {
  const parsed = BulkFeedbackIdsSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { projectId, feedbackIds } = parsed.data

  await requireProjectWriteAccess(ctx, projectId)

  let updated = 0
  await inChunks(feedbackIds, async (chunk) => {
    const placeholders = chunk.map(() => '?').join(', ')
    const result = await ctx.db
      .prepare(
        `UPDATE feedback SET status = 'reviewed'
         WHERE id IN (${placeholders}) AND project_id = ? AND workspace_id = ?`,
      )
      .bind(...chunk, projectId, ctx.workspaceId)
      .run()
    updated += result.meta.changes
    return []
  })

  return { updated }
}

interface BulkConvertFeedbackRow {
  id: string
  rating: number | null
  rating_scale: string | null
  body: string | null
  submitter_label: string | null
  linked_issue_id: string | null
}

export const bulkConvertToIssue = async function bulkConvertToIssue(
  ctx: ServiceCtx,
  input: unknown,
): Promise<{ id: string; number?: number; convertedCount: number }> {
  const parsed = BulkFeedbackIdsSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { projectId, feedbackIds } = parsed.data

  await requireProjectWriteAccess(ctx, projectId)

  const rows = await inChunks(feedbackIds, (chunk) => {
    const placeholders = chunk.map(() => '?').join(', ')
    return ctx.db
      .prepare(
        `SELECT id, rating, rating_scale, body, submitter_label, linked_issue_id
         FROM feedback WHERE id IN (${placeholders}) AND project_id = ? AND workspace_id = ?`,
      )
      .bind(...chunk, projectId, ctx.workspaceId)
      .all<BulkConvertFeedbackRow>()
      .then((result) => result.results)
  })
  if (rows.length !== feedbackIds.length) {
    throw new NotFoundError('Feedback not found')
  }
  /*
   * All-or-nothing: any row already converted rejects the whole batch rather than
   * partially converting or silently re-linking.
   */
  if (rows.some((row) => row.linked_issue_id)) {
    throw new ConflictError('One or more selected items are already linked to an issue')
  }

  const byId = new Map(rows.map((row) => [row.id, row]))
  const orderedRows = feedbackIds
    .map((id) => byId.get(id))
    .filter((row): row is BulkConvertFeedbackRow => Predicate.isNotNullish(row))
  const body = orderedRows
    .map((fb, index) => {
      const footer =
        `— submitted via feedback source${fb.submitter_label ? ` by ${fb.submitter_label}` : ''}` +
        (Predicate.isNotNullish(fb.rating) ? `, rating: ${fb.rating} (${fb.rating_scale})` : '')
      return [`${Number.increment(index)}. ${ratingLabel(fb.rating, fb.rating_scale)}`, fb.body ?? '', footer].join(
        '\n',
      )
    })
    .join('\n\n')

  const issue = await createIssueFromFeedback(
    ctx,
    {
      projectId,
      title: `${feedbackIds.length} feedback items`,
      body,
      priority: 'medium',
    },
    feedbackIds,
  )

  return { ...issue, convertedCount: feedbackIds.length }
}

export interface FeedbackVersionSummary {
  appVersion: string | null
  totalCount: number
  withCommentCount: number
  thumbsUpPct: number | null
  avgFiveStar: number | null
  lastSeenAt: number
}

export interface FeedbackSourceSummary {
  sourceId: string
  sourceName: string | null
  totalCount: number
  versions: FeedbackVersionSummary[]
}

export const getFeedbackSummary = async function getFeedbackSummary(
  ctx: ServiceCtx,
  input: Readonly<{ projectId: string }>,
): Promise<FeedbackSourceSummary[]> {
  const { projectId } = input

  await requireProjectInWorkspace(ctx, projectId)
  await requireProjectAccess(ctx, projectId)

  const results = await Effect.runPromise(feedbackQueries.readFeedbackSummary(ctx.db, ctx.workspaceId, { projectId }))

  const bySource = new Map<string, FeedbackSourceSummary>()
  Iterable.forEach(results ?? [], (result) => {
    let src = bySource.get(result.source_id)
    if (!src) {
      src = { sourceId: result.source_id, sourceName: result.source_name, totalCount: 0, versions: [] }
      bySource.set(result.source_id, src)
    }
    src.totalCount += result.total
    src.versions.push({
      appVersion: result.app_version,
      totalCount: result.total,
      withCommentCount: result.with_comment_count,
      thumbsUpPct:
        result.thumbs_total > NO_RATINGS
          ? Math.round((result.thumbs_up / result.thumbs_total) * PERCENT_MULTIPLIER)
          : null,
      avgFiveStar: result.five_star_total > NO_RATINGS ? result.five_star_avg : null,
      lastSeenAt: result.last_seen_at,
    })
  })
  return [...bySource.values()]
}
