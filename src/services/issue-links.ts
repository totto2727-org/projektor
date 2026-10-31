import { and, asc, eq, inArray, or } from 'drizzle-orm'

import { drizzle, schema } from '#db'

import { inChunks } from './custom-fields'
import { queryEffect } from './errors'

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

/** Application authorizes the parent issue. Linked metadata retains the API's workspace-only semantics. */
export function listLinksForIssue(db: D1Database, workspaceId: string, issueId: string) {
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
    const issueRows = await inChunks([...new Set(enriched.map((r) => r.linkedIssueId))], (chunk) =>
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
        .where(and(inArray(schema.issues.id, chunk), eq(schema.issues.workspaceId, workspaceId))),
    )
    const byId = new Map(issueRows.map((r) => [r.id, r]))
    return enriched.map((r) => {
      const linked = byId.get(r.linkedIssueId)
      return {
        id: r.id,
        type: r.type,
        linkedIssueId: r.linkedIssueId,
        linkedIssueTitle: linked?.title ?? '',
        linkedIssueNumber: linked?.number ?? 0,
        linkedIssueProjectKey: linked?.projectKey ?? '',
        linkedIssueStatusCategory: linked?.statusCategory ?? '',
        createdById: r.createdById,
        createdAt: r.createdAt,
      }
    })
  })
}
