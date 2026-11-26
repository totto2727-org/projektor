import { Predicate } from 'effect'

import { JSON_NULL } from '#contracts/json-null.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import type { schema } from '#db'

import { ConflictError } from './errors.ts'

type WikiDraft = Pick<typeof schema.wikiDrafts.$inferSelect, 'title' | 'content' | 'baseRevisionId' | 'updatedAt'>

interface DraftState {
  revision: string | null
  draft: WikiDraft | null
}

interface DraftIdentity {
  workspaceId: string
  pageId: string
  userId: string
}

/*
 * The head and scratch snapshot are read together, including after a discard removed
 * the scratch row. Only Core calls this after authorizing the page and current user.
 */
export const readWikiDraftState = async function readWikiDraftState(
  db: D1Database,
  { workspaceId, pageId, userId }: DraftIdentity,
): Promise<DraftState> {
  const row = await db
    .prepare(`
    SELECT h.revision, d.title, d.content, d.base_revision_id AS baseRevisionId, d.updated_at AS updatedAt
    FROM wiki_pages p
    LEFT JOIN wiki_draft_heads h ON h.workspace_id = p.workspace_id AND h.page_id = p.id AND h.user_id = ?
    LEFT JOIN wiki_drafts d ON d.workspace_id = p.workspace_id AND d.page_id = p.id AND d.user_id = ?
    WHERE p.workspace_id = ? AND p.id = ?
  `)
    .bind(userId, userId, workspaceId, pageId)
    .first<{
      revision: string | null
      title: string | null
      content: string | null
      baseRevisionId: string | null
      updatedAt: number | null
    }>()
  return fieldsInOrder([
    ['revision', row?.revision ?? JSON_NULL],
    [
      'draft',
      row &&
      Predicate.isNotNullish(row.title) &&
      Predicate.isNotNullish(row.content) &&
      Predicate.isNotNullish(row.updatedAt)
        ? fieldsInOrder([
            ['title', row.title],
            ['content', row.content],
            ['baseRevisionId', row.baseRevisionId],
            ['updatedAt', row.updatedAt],
          ])
        : JSON_NULL,
    ],
  ])
}

export const requireAdvanced = function requireAdvanced(result: D1Result, revision: string): void {
  if (!result.results.some((row) => Predicate.isObjectOrArray(row) && 'revision' in row && row.revision === revision)) {
    throw new ConflictError('The saved draft changed. Reload its current state before saving again.')
  }
}
