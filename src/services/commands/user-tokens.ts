import { Predicate } from 'effect'
import { flattenError } from 'zod'

import { CreateUserTokenSchema } from '#contracts/inputs/user-tokens.ts'
import { currentEpochSeconds } from '#contracts/time.ts'

import { ForbiddenError, ValidationError } from './errors.ts'

/*
 * These handlers run pre-workspace-context (login/token minting are user-scoped,
 * not workspace-scoped), so they take a narrower ctx than ServiceCtx.
 */
export interface UserCtx {
  db: D1Database
  userId: string
}

const hashToken = async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(buf))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const getUserWorkspaces = async function getUserWorkspaces(ctx: UserCtx): Promise<Record<string, unknown>[]> {
  const { results } = await ctx.db
    .prepare(
      `SELECT w.id, w.name, w.slug, wm.role
     FROM workspaces w
     JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE wm.user_id = ?`,
    )
    .bind(ctx.userId)
    .all()
  return results
}

export const createUserToken = async function createUserToken(ctx: UserCtx, raw: unknown): Promise<{ token: string }> {
  const result = CreateUserTokenSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(flattenError(result.error))
  }

  const { name, workspaceId, scopes, expiresAt } = result.data

  /*
   * PROJ-17: when minting a workspace-scoped token, the caller must be a member
   * of that workspace. Omitting workspaceId mints a user-scoped token (NULL in DB),
   * which is valid across all workspaces the user is a member of.
   */
  if (Predicate.isNotNullish(workspaceId)) {
    const member = await ctx.db
      .prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, ctx.userId)
      .first()
    if (!member) {
      throw new ForbiddenError()
    }
  }

  const rawToken = crypto.randomUUID() + crypto.randomUUID()
  const hash = await hashToken(rawToken)

  await ctx.db
    .prepare(
      `INSERT INTO api_tokens (id, workspace_id, user_id, name, token_hash, scopes, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      workspaceId ?? null,
      ctx.userId,
      name,
      hash,
      JSON.stringify(scopes),
      expiresAt ?? null,
      currentEpochSeconds(),
    )
    .run()

  return { token: rawToken }
}

export const deleteUserToken = async function deleteUserToken(ctx: UserCtx, id: string): Promise<{ ok: boolean }> {
  /*
   * PROJ-923: null agent_sessions.token_id explicitly (ON DELETE SET NULL isn't
   * guaranteed on D1, PROJ-407), in the same batch as the delete.
   */
  await ctx.db.batch([
    ctx.db
      .prepare(
        'UPDATE agent_sessions SET token_id = NULL WHERE token_id IN (SELECT id FROM api_tokens WHERE id = ? AND user_id = ?)',
      )
      .bind(id, ctx.userId),
    ctx.db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').bind(id, ctx.userId),
  ])
  return { ok: true }
}
