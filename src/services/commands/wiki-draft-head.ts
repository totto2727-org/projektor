import { Predicate } from 'effect'

import { isWikiRevisionSpecified } from '#contracts/wiki-revision.ts'

import { ConflictError } from './errors.ts'
import type { ServiceCtx } from './types.ts'

interface DraftHeadAdvance {
  expected: string | null | undefined
  revision: string
}

export const advanceHead = function advanceHead(
  ctx: ServiceCtx,
  pageId: string,
  { expected, revision }: DraftHeadAdvance,
): D1PreparedStatement {
  const key = [ctx.workspaceId, ctx.userId, pageId]
  if (!isWikiRevisionSpecified(expected)) {
    /*
     * Existing REST/MCP callers remain last-write-wins, but invalidate any older
     * versioned browser request rather than bypassing the head.
     */
    return ctx.db
      .prepare(`INSERT INTO wiki_draft_heads(workspace_id,user_id,page_id,revision) VALUES (?,?,?,?)
      ON CONFLICT(workspace_id,user_id,page_id) DO UPDATE SET revision = excluded.revision RETURNING revision`)
      .bind(...key, revision)
  }
  if (Predicate.isNullish(expected)) {
    return ctx.db
      .prepare(`INSERT INTO wiki_draft_heads(workspace_id,user_id,page_id,revision) VALUES (?,?,?,?)
      ON CONFLICT(workspace_id,user_id,page_id) DO NOTHING RETURNING revision`)
      .bind(...key, revision)
  }
  return ctx.db
    .prepare(`UPDATE wiki_draft_heads SET revision = ?
    WHERE workspace_id = ? AND user_id = ? AND page_id = ? AND revision = ? RETURNING revision`)
    .bind(revision, ...key, expected)
}

export const requireAdvanced = function requireAdvanced(result: D1Result, revision: string): void {
  if (!result.results.some((row) => Predicate.isObjectOrArray(row) && 'revision' in row && row.revision === revision)) {
    throw new ConflictError('The saved draft changed. Reload its current state before saving again.')
  }
}
