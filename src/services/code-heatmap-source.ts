import { and, eq, gte, lte } from 'drizzle-orm'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { schema } from '#db'
import type { drizzle } from '#db'

export interface HeatmapQueryScope {
  projectId: string
  windowSince: number
  windowUntil: number
  workspaceId: string
}

export interface HeatmapClaimRow {
  path: string
  issueId: string
}

export interface HeatmapConflictRow {
  path: string
  rejectedIssueId: string
}

/*
 * PROJ-338: same window predicate as claims mode, but over claim_conflicts —
 * occurredAt within [since, until], joined to issues (via rejectedIssueId) to scope
 * by project.
 */
export const readHeatmapConflicts = function readHeatmapConflicts(
  orm: ReturnType<typeof drizzle>,
  { projectId, windowSince, windowUntil, workspaceId }: HeatmapQueryScope,
): PromiseLike<HeatmapConflictRow[]> {
  return orm
    .select({
      path: schema.claimConflicts.path,
      rejectedIssueId: schema.claimConflicts.rejectedIssueId,
    })
    .from(schema.claimConflicts)
    .innerJoin(schema.issues, eq(schema.claimConflicts.rejectedIssueId, schema.issues.id))
    .where(
      and(
        eq(schema.claimConflicts.workspaceId, workspaceId),
        eq(schema.issues.projectId, projectId),
        gte(schema.claimConflicts.occurredAt, windowSince),
        lte(schema.claimConflicts.occurredAt, windowUntil),
      ),
    )
}

/*
 * PROJ-332: window predicate matches the rest of flow-metrics — claimedAt within
 * [since, until], not claim overlap. issue_file_claims has no project column, so join
 * issues to scope by project.
 */
export const readHeatmapClaims = function readHeatmapClaims(
  orm: ReturnType<typeof drizzle>,
  { projectId, windowSince, windowUntil, workspaceId }: HeatmapQueryScope,
): PromiseLike<HeatmapClaimRow[]> {
  return orm
    .select(
      fieldsInOrder([
        ['path', schema.issueFileClaims.path],
        ['issueId', schema.issueFileClaims.issueId],
      ]),
    )
    .from(schema.issueFileClaims)
    .innerJoin(schema.issues, eq(schema.issueFileClaims.issueId, schema.issues.id))
    .where(
      and(
        eq(schema.issueFileClaims.workspaceId, workspaceId),
        eq(schema.issues.projectId, projectId),
        gte(schema.issueFileClaims.claimedAt, windowSince),
        lte(schema.issueFileClaims.claimedAt, windowUntil),
      ),
    )
}
