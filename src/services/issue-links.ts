import { and, asc, eq, inArray, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { drizzle, schema } from '#db'

import { inChunks } from './custom-fields.ts'
import { queryEffect } from './errors.ts'

export interface IssueLinkRow {
  id: string
  type: 'blocks' | 'blocked_by' | 'relates_to' | 'duplicates'
  linkedIssueId: string
  linkedIssueTitle: string
  linkedIssueNumber: number
  linkedIssueProjectKey: string
  linkedIssueStatusCategory: string
  createdById: string
  createdAt: number
}

/** The application supplies current linked-project visibility alongside parent authorization. */
export const listLinksForIssue = function listLinksForIssue(
  db: D1Database,
  workspaceId: string,
  issueId: string,
  visibility?: SQL,
) {
  return queryEffect('listLinksForIssue', async (): Promise<IssueLinkRow[]> => {
    const orm = drizzle(db, { schema })
    const rows = await orm
      .select()
      .from(schema.issueLinks)
      .where(
        and(
          eq(schema.issueLinks.workspaceId, workspaceId),
          or(eq(schema.issueLinks.sourceIssueId, issueId), eq(schema.issueLinks.targetIssueId, issueId)),
        ),
      )
      .orderBy(asc(schema.issueLinks.createdAt))
    const enriched = rows.map((row) => ({
      id: row.id,
      type: row.sourceIssueId !== issueId && row.type === 'blocks' ? ('blocked_by' as const) : row.type,
      linkedIssueId: row.sourceIssueId === issueId ? row.targetIssueId : row.sourceIssueId,
      createdById: row.createdById,
      createdAt: row.createdAt,
    }))
    const issueRows = await inChunks([...new Set(enriched.map((link) => link.linkedIssueId))], (chunk) =>
      orm
        .select({
          id: schema.issues.id,
          title: schema.issues.title,
          number: schema.issues.number,
          statusCategory: schema.issues.statusCategory,
          projectKey: schema.projects.key,
        })
        .from(schema.issues)
        .leftJoin(schema.projects, eq(schema.issues.projectId, schema.projects.id))
        .where(and(inArray(schema.issues.id, chunk), eq(schema.issues.workspaceId, workspaceId), visibility)),
    )
    const byId = new Map(issueRows.map((row) => [row.id, row]))
    return enriched
      .filter((link) => !visibility || byId.has(link.linkedIssueId))
      .map((link) => {
        const linked = byId.get(link.linkedIssueId)
        return {
          id: link.id,
          type: link.type,
          linkedIssueId: link.linkedIssueId,
          linkedIssueTitle: linked?.title ?? '',
          linkedIssueNumber: linked?.number ?? 0,
          linkedIssueProjectKey: linked?.projectKey ?? '',
          linkedIssueStatusCategory: linked?.statusCategory ?? '',
          createdById: link.createdById,
          createdAt: link.createdAt,
        }
      })
  })
}
