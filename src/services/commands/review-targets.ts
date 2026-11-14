import type { ServiceCtx } from './types'

export function buildCloseIssueReviewTargetsStatement(
  ctx: ServiceCtx,
  selector: { issueId: string } | { statusId: string },
): D1PreparedStatement {
  const column = 'issueId' in selector ? 'id' : 'status_id'
  const value = 'issueId' in selector ? selector.issueId : selector.statusId
  return ctx.db
    .prepare(
      `UPDATE attachments
       SET review_status = CASE
         WHEN EXISTS (
           SELECT 1 FROM issues i
           WHERE i.id = attachments.entity_id AND i.workspace_id = attachments.workspace_id
             AND COALESCE(NULLIF(i.status_category, ''), i.status) = 'cancelled'
         ) THEN NULL ELSE 'done' END
       WHERE workspace_id = ? AND entity_type = 'issue' AND kind IN ('file', 'url')
         AND review_status IS NOT NULL
         AND entity_id IN (
           SELECT id FROM issues
           WHERE workspace_id = ? AND ${column} = ?
             AND COALESCE(NULLIF(status_category, ''), status) IN ('done', 'cancelled')
         )`,
    )
    .bind(ctx.workspaceId, ctx.workspaceId, value)
}
