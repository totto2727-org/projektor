import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { flattenError } from 'zod'

import {
  AddCommentSchema,
  DeleteCommentSchema,
  ListCommentsSchema,
  UpdateCommentSchema,
} from '#contracts/inputs/comments.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { drizzle, schema } from '#db'
import { listComments as queryComments } from '#services/comments.ts'

import { assertProjectAccess } from './access.ts'
import type { AccessMode } from './access.ts'
import { ForbiddenError, NotFoundError, ValidationError } from './errors.ts'
import { broadcastWorkspaceEvent } from './realtime.ts'
import type { ServiceCtx } from './types.ts'

interface CommentRow {
  id: string
  body: string
  created_at: number
  updated_at: number
  author_id: string
  author_name: string
  author_email: string
}

/*
 * PROJ-311: a comment is reachable only if its issue's project is visible to the
 * user (owner/admin bypass). Throw the issue-not-found error to avoid leaking that
 * an issue exists in a project the user was never granted.
 */
const assertIssueVisible = async function assertIssueVisible(
  ctx: ServiceCtx,
  issueId: string,
  mode: AccessMode = 'read',
): Promise<string> {
  const orm = drizzle(ctx.db, { schema })
  const issue = await orm
    .select({ projectId: schema.issues.projectId })
    .from(schema.issues)
    .where(and(eq(schema.issues.id, issueId), eq(schema.issues.workspaceId, ctx.workspaceId)))
    .get()
  if (!issue) {
    throw new NotFoundError('Issue not found')
  }
  await assertProjectAccess(ctx, issue.projectId, mode, {
    notFoundMessage: 'Issue not found',
    projectLoadedFromWorkspaceRow: true,
  })
  return issue.projectId
}

export const listComments = async function listComments(ctx: ServiceCtx, input: unknown): Promise<CommentRow[]> {
  const parsed = ListCommentsSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { issueId } = parsed.data

  await assertIssueVisible(ctx, issueId)
  return Effect.runPromise(queryComments(ctx.db, ctx.workspaceId, issueId))
}

export const addComment = async function addComment(ctx: ServiceCtx, input: unknown): Promise<{ id: string }> {
  const parsed = AddCommentSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { issueId, body } = parsed.data

  const projectId = await assertIssueVisible(ctx, issueId, 'edit')

  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  const orm = drizzle(ctx.db, { schema })

  await buildAddCommentInsertStatement(ctx, orm, { body, id, issueId, now }).run()

  await broadcastWorkspaceEvent(ctx, {
    type: 'comment.created',
    projectId,
    data: { id, issueId, authorId: ctx.userId },
  })

  return { id }
}

/*
 * PROJ-870: build (without executing) the comment INSERT, for a caller that has already
 * validated issue visibility/permissions itself (e.g. updateIssue, recording a completion
 * report) and wants to fold this insert into its own ctx.db.batch() instead of paying for
 * addComment's separate assertIssueVisible re-check and its own round trip. addComment
 * runs the same statement, so the row shape (incl. authorKind) has one source of truth.
 */
export function buildAddCommentInsertStatement(
  ctx: ServiceCtx,
  orm: ReturnType<typeof drizzle>,
  opts: Readonly<{ id: string; issueId: string; body: string; now: number }>,
): D1PreparedStatement {
  const query = orm
    .insert(schema.issueComments)
    .values(
      fieldsInOrder([
        ['id', opts.id],
        ['issueId', opts.issueId],
        ['authorId', ctx.userId],
        ['body', opts.body],
        ['createdAt', opts.now],
        ['updatedAt', opts.now],
        /*
         * PROJ-328: stamped from the authenticated principal type, not a caller-supplied
         * field — see ServiceCtx.authKind.
         */
        ['authorKind', ctx.authKind ?? null],
      ]),
    )
    .toSQL()
  return ctx.db.prepare(query.sql).bind(...query.params)
}

export const updateComment = async function updateComment(ctx: ServiceCtx, input: unknown): Promise<{ ok: true }> {
  const parsed = UpdateCommentSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { issueId, commentId, body } = parsed.data

  const projectId = await assertIssueVisible(ctx, issueId, 'edit')

  const orm = drizzle(ctx.db, { schema })
  const comment = await orm
    .select(
      fieldsInOrder([
        ['id', schema.issueComments.id],
        ['authorId', schema.issueComments.authorId],
      ]),
    )
    .from(schema.issueComments)
    .where(and(eq(schema.issueComments.id, commentId), eq(schema.issueComments.issueId, issueId)))
    .get()

  if (!comment) {
    throw new NotFoundError('Comment not found')
  }
  if (comment.authorId !== ctx.userId) {
    throw new ForbiddenError('Forbidden')
  }

  await orm
    .update(schema.issueComments)
    .set({ body, updatedAt: currentEpochSeconds() })
    .where(eq(schema.issueComments.id, commentId))

  await broadcastWorkspaceEvent(ctx, {
    type: 'comment.updated',
    projectId,
    data: { id: commentId, issueId },
  })

  return { ok: true }
}

export const deleteComment = async function deleteComment(ctx: ServiceCtx, input: unknown): Promise<{ ok: true }> {
  const parsed = DeleteCommentSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  const { issueId, commentId } = parsed.data

  const projectId = await assertIssueVisible(ctx, issueId, 'edit')

  const orm = drizzle(ctx.db, { schema })
  const comment = await orm
    .select(
      fieldsInOrder([
        ['id', schema.issueComments.id],
        ['authorId', schema.issueComments.authorId],
      ]),
    )
    .from(schema.issueComments)
    .where(and(eq(schema.issueComments.id, commentId), eq(schema.issueComments.issueId, issueId)))
    .get()

  if (!comment) {
    throw new NotFoundError('Comment not found')
  }

  const canDelete = comment.authorId === ctx.userId || ctx.role === 'admin' || ctx.role === 'owner'
  if (!canDelete) {
    throw new ForbiddenError('Forbidden')
  }

  await orm.delete(schema.issueComments).where(eq(schema.issueComments.id, commentId))

  await broadcastWorkspaceEvent(ctx, {
    type: 'comment.deleted',
    projectId,
    data: { id: commentId, issueId },
  })

  return { ok: true }
}
