import { and, eq, gte, lte, sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'
import { Predicate } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { schema } from '#db'
import type { drizzle } from '#db'

const NO_FACTORY_EVENTS = 0

/*
 * PROJ-334: factory-health tiles — fault signals for the machinery itself, not the
 * work. Each count is windowed by when the fault EVENT happened (released_at /
 * occurred_at), not by an issue's doneAt like the distribution tiles above, since a
 * lease expiry or abandoned claim can happen on an issue that never completes in this
 * window (or ever). All counts are project-scoped the same way the rest of this
 * endpoint is.
 */
interface FactoryHealth {
  leaseExpiries: number
  abandonedClaims: number
  gateRejections: number
  wipCapPressure: number
}

interface FactoryHealthWindow {
  createdUntil: number
  doneBefore: number | undefined
  projectId: string
  since: number
  until: number
  workspaceId: string
}

const countOf = function countOf(query: SQLWrapper): SQL {
  return sql`(${query})`
}

const queryExpiredLeases = function queryExpiredLeases(
  orm: ReturnType<typeof drizzle>,
  { projectId, since, until, workspaceId }: FactoryHealthWindow,
  count: SQL,
): SQLWrapper {
  return orm
    .select({ n: count })
    .from(schema.issueLeases)
    .innerJoin(schema.issues, eq(schema.issueLeases.issueId, schema.issues.id))
    .where(
      and(
        eq(schema.issueLeases.workspaceId, workspaceId),
        eq(schema.issues.projectId, projectId),
        eq(schema.issueLeases.releaseReason, 'expired'),
        gte(schema.issueLeases.releasedAt, since),
        lte(schema.issueLeases.releasedAt, until),
      ),
    )
}

const queryAbandonedClaims = function queryAbandonedClaims(
  orm: ReturnType<typeof drizzle>,
  { projectId, since, until, workspaceId }: FactoryHealthWindow,
  count: SQL,
): SQLWrapper {
  return orm
    .select({ n: count })
    .from(schema.issueFileClaims)
    .innerJoin(schema.issues, eq(schema.issueFileClaims.issueId, schema.issues.id))
    .where(
      and(
        eq(schema.issueFileClaims.workspaceId, workspaceId),
        eq(schema.issues.projectId, projectId),
        eq(schema.issueFileClaims.releaseReason, 'agent_ended'),
        gte(schema.issueFileClaims.releasedAt, since),
        lte(schema.issueFileClaims.releasedAt, until),
      ),
    )
}

const queryGateRejections = function queryGateRejections(
  orm: ReturnType<typeof drizzle>,
  { projectId, since, until, workspaceId }: FactoryHealthWindow,
  count: SQL,
): SQLWrapper {
  return orm
    .select({ n: count })
    .from(schema.issueGateRejections)
    .innerJoin(schema.issues, eq(schema.issueGateRejections.issueId, schema.issues.id))
    .where(
      and(
        eq(schema.issueGateRejections.workspaceId, workspaceId),
        eq(schema.issues.projectId, projectId),
        gte(schema.issueGateRejections.occurredAt, since),
        lte(schema.issueGateRejections.occurredAt, until),
      ),
    )
}

// PROJ-342: WIP-cap denials — claims rejected for hitting the per-project agent
// WIP cap. Recorded at the denial site in claimIssue (services/issue-leases.ts).
const queryWipCapDenials = function queryWipCapDenials(
  orm: ReturnType<typeof drizzle>,
  { projectId, since, until, workspaceId }: FactoryHealthWindow,
  count: SQL,
): SQLWrapper {
  return orm
    .select({ n: count })
    .from(schema.wipCapDenials)
    .where(
      and(
        eq(schema.wipCapDenials.workspaceId, workspaceId),
        eq(schema.wipCapDenials.projectId, projectId),
        gte(schema.wipCapDenials.occurredAt, since),
        lte(schema.wipCapDenials.occurredAt, until),
      ),
    )
}

const queryEarlierCompletions = function queryEarlierCompletions(
  orm: ReturnType<typeof drizzle>,
  { createdUntil, doneBefore, projectId, workspaceId }: FactoryHealthWindow,
  count: SQL,
): SQLWrapper | undefined {
  return Predicate.isNullish(doneBefore)
    ? undefined
    : orm
        .select({ n: count })
        .from(schema.issues)
        .where(
          and(
            eq(schema.issues.workspaceId, workspaceId),
            eq(schema.issues.projectId, projectId),
            lte(schema.issues.createdAt, createdUntil),
            sql`${schema.issues.doneAt} < ${doneBefore}`,
          ),
        )
}

/*
 * PROJ-866: the four factory-health counts and the CFD's done-before-window count are
 * independent scalar COUNT(*)s, so they run as subqueries of one statement (anchored on
 * the project row) instead of five round trips that each fetched every matching row.
 */
export const fetchWindowCounts = async function fetchWindowCounts(
  orm: ReturnType<typeof drizzle>,
  window: FactoryHealthWindow,
): Promise<FactoryHealth & { doneBeforeWindow: number }> {
  const { projectId, workspaceId } = window
  const count = sql`count(*)`
  const leaseExpiriesQuery = queryExpiredLeases(orm, window, count)
  const abandonedClaimsQuery = queryAbandonedClaims(orm, window, count)
  const gateRejectionsQuery = queryGateRejections(orm, window, count)
  const wipCapPressureQuery = queryWipCapDenials(orm, window, count)
  const doneBeforeWindowQuery = queryEarlierCompletions(orm, window, count)
  const row = await orm
    .select(
      fieldsInOrder([
        ['leaseExpiries', countOf(leaseExpiriesQuery)],
        ['abandonedClaims', countOf(abandonedClaimsQuery)],
        ['gateRejections', countOf(gateRejectionsQuery)],
        ['wipCapPressure', countOf(wipCapPressureQuery)],
        ['doneBeforeWindow', Predicate.isNullish(doneBeforeWindowQuery) ? sql`0` : countOf(doneBeforeWindowQuery)],
      ]),
    )
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, workspaceId)))
    .get()

  return fieldsInOrder([
    ['leaseExpiries', Number(row?.leaseExpiries ?? NO_FACTORY_EVENTS)],
    ['abandonedClaims', Number(row?.abandonedClaims ?? NO_FACTORY_EVENTS)],
    ['gateRejections', Number(row?.gateRejections ?? NO_FACTORY_EVENTS)],
    ['wipCapPressure', Number(row?.wipCapPressure ?? NO_FACTORY_EVENTS)],
    ['doneBeforeWindow', Number(row?.doneBeforeWindow ?? NO_FACTORY_EVENTS)],
  ])
}
