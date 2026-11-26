import { and, eq, gte, lte } from 'drizzle-orm'
import { Iterable } from 'effect'
import type { Effect } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { SECONDS_PER_DAY, currentEpochSeconds } from '#contracts/time.ts'
import { drizzle, schema } from '#db'

import { queryEffect } from './errors.ts'
import type { DataQueryError } from './errors.ts'

const EMPTY_SEGMENT_COUNT = 0
const PATH_SEGMENT_START = 0
const NO_PATH_SEPARATOR = -1

export interface CodeHeatmapRange {
  projectId: string
  since?: number
  until?: number
  prefix?: string
  mode?: 'claims' | 'contention'
}

export interface CodeHeatmapEntry {
  /*
   * Full path from the workspace root to this segment (the drill-down cursor for a
   * non-leaf entry's children).
   */
  path: string
  // This entry's own path component, relative to the request's `prefix`.
  segment: string
  /*
   * True when this entry is an exact claimed file path (no further segments beneath
   * it) rather than a directory grouping further claims.
   */
  isLeaf: boolean
  distinctIssueCount: number
  claimCount: number
}

// PROJ-338: contention-mode counterpart to CodeHeatmapEntry — sized by claim_conflicts
// (rejected/overridden claimFiles attempts) instead of successful claims.
export interface ContentionHeatmapEntry {
  path: string
  segment: string
  isLeaf: boolean
  distinctRejectedIssueCount: number
  conflictCount: number
}

/*
 * Resolves the path segment one level below `prefix` that `itemPath` falls under, or undefined
 * if `itemPath` IS `prefix` (nothing left to drill into).
 */
const resolveNextSegment = function resolveNextSegment(
  itemPath: string,
  prefix: string,
  prefixWithSlash: string,
): { path: string; isLeaf: boolean } | undefined {
  const rest = itemPath.slice(prefixWithSlash.length)
  const slashIdx = rest.indexOf('/')
  const isLeaf = slashIdx === NO_PATH_SEPARATOR
  const segment = isLeaf ? rest : rest.slice(PATH_SEGMENT_START, slashIdx)
  const path = prefix ? `${prefix}/${segment}` : segment
  return rest
    ? fieldsInOrder([
        ['path', path],
        ['isLeaf', isLeaf],
      ])
    : undefined
}

interface SegmentGroup {
  ids: Set<string>
  count: number
  isLeaf: boolean
}

const ensureSegmentGroup = function ensureSegmentGroup(
  groups: Map<string, SegmentGroup>,
  path: string,
  isLeaf: boolean,
): SegmentGroup {
  const existing = groups.get(path)
  if (existing) {
    return existing
  }
  const group = fieldsInOrder([
    ['ids', new Set<string>()],
    ['count', EMPTY_SEGMENT_COUNT],
    ['isLeaf', isLeaf],
  ])
  groups.set(path, group)
  return group
}

interface HeatmapPrefix {
  prefix: string
  prefixWithSlash: string
}

/*
 * PROJ-332/338: group items (claims or conflicts) one path segment below `prefix` — the
 * natural "list this directory's children" step a file explorer takes, so the caller
 * drills down by re-requesting with `prefix` set to the entry clicked. Shared by
 * groupClaimsByNextSegment and groupConflictsByNextSegment (below), which differ only in
 * how they extract the distinct id to count per group.
 */
const groupItemsByNextSegment = function groupItemsByNextSegment<T extends { path: string }>(
  items: Readonly<T[]>,
  { prefix, prefixWithSlash }: HeatmapPrefix,
  getId: (item: T) => string,
): Map<string, SegmentGroup> {
  const groups = new Map<string, SegmentGroup>()

  Iterable.forEach(items, (item) => {
    const resolved =
      prefix && !item.path.startsWith(prefixWithSlash)
        ? undefined
        : resolveNextSegment(item.path, prefix, prefixWithSlash)
    if (!resolved) {
      return
    }
    const { path, isLeaf } = resolved

    const group = ensureSegmentGroup(groups, path, isLeaf)
    /*
     * A path claimed as both a file and a directory (e.g. `docs` and `docs/x.md`) is a
     * directory: keep it drillable rather than freezing isLeaf on the first item seen.
     */
    if (!isLeaf) {
      group.isLeaf = false
    }
    group.ids.add(getId(item))
    group.count += 1
  })

  return groups
}

const groupClaimsByNextSegment = function groupClaimsByNextSegment(
  claims: Readonly<{ path: string; issueId: string }[]>,
  prefix: string,
): CodeHeatmapEntry[] {
  const prefixWithSlash = prefix ? `${prefix}/` : ''
  const groups = groupItemsByNextSegment(claims, { prefix, prefixWithSlash }, (claim) => claim.issueId)

  return [...groups.entries()]
    .map(([path, group]) =>
      fieldsInOrder([
        ['path', path],
        ['segment', path.slice(prefixWithSlash.length)],
        ['isLeaf', group.isLeaf],
        ['distinctIssueCount', group.ids.size],
        ['claimCount', group.count],
      ]),
    )
    .toSorted(
      (left, right) => right.distinctIssueCount - left.distinctIssueCount || left.path.localeCompare(right.path),
    )
}

const groupConflictsByNextSegment = function groupConflictsByNextSegment(
  conflicts: Readonly<{ path: string; rejectedIssueId: string }[]>,
  prefix: string,
): ContentionHeatmapEntry[] {
  const prefixWithSlash = prefix ? `${prefix}/` : ''
  const groups = groupItemsByNextSegment(conflicts, { prefix, prefixWithSlash }, (conflict) => conflict.rejectedIssueId)

  return [...groups.entries()]
    .map(([path, group]) =>
      fieldsInOrder([
        ['path', path],
        ['segment', path.slice(prefixWithSlash.length)],
        ['isLeaf', group.isLeaf],
        ['distinctRejectedIssueCount', group.ids.size],
        ['conflictCount', group.count],
      ]),
    )
    .toSorted(
      (left, right) =>
        right.distinctRejectedIssueCount - left.distinctRejectedIssueCount || left.path.localeCompare(right.path),
    )
}

const readCodeHeatmap = async function readCodeHeatmap(
  db: D1Database,
  workspaceId: string,
  range: CodeHeatmapRange,
  now: number,
) {
  const { projectId, since, until, prefix, mode } = range
  const orm = drizzle(db, { schema })

  /*
   * Default window mirrors flow-metrics' throughput default (current ISO week plus the
   * preceding 5 weeks) so the heatmap agrees with the rest of the dashboard when no
   * explicit range is passed.
   */
  const windowSince = since ?? now - DEFAULT_HEATMAP_WINDOW_SECONDS
  const windowUntil = until ?? now

  const resolvedMode = mode ?? 'claims'

  if (resolvedMode === 'contention') {
    /*
     * PROJ-338: same window predicate as claims mode, but over claim_conflicts —
     * occurredAt within [since, until], joined to issues (via rejectedIssueId) to scope
     * by project.
     */
    const conflicts = await orm
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

    const entries = groupConflictsByNextSegment(conflicts, prefix ?? '')

    return fieldsInOrder([
      ['prefix', prefix ?? ''],
      ['mode', resolvedMode],
      /*
       * Reuses the claims-mode field name so the response shape doesn't fork in two —
       * here it's the distinct count of *rejected* issues, i.e. issues whose claim
       * attempt lost.
       */
      ['totalDistinctIssues', new Set(conflicts.map((conflict) => conflict.rejectedIssueId)).size],
      ['entries', entries],
    ])
  }

  /*
   * PROJ-332: window predicate matches the rest of flow-metrics — claimedAt within
   * [since, until], not claim overlap. issue_file_claims has no project column, so join
   * issues to scope by project.
   */
  const claims = await orm
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

  const entries = groupClaimsByNextSegment(claims, prefix ?? '')

  return fieldsInOrder([
    ['prefix', prefix ?? ''],
    ['mode', resolvedMode],
    ['totalDistinctIssues', new Set(claims.map((claim) => claim.issueId)).size],
    ['entries', entries],
  ])
}

export type CodeHeatmap = Awaited<ReturnType<typeof readCodeHeatmap>>

/** The caller validates input and authorizes project access before running this Effect. */
const DEFAULT_HEATMAP_WINDOW_DAYS = 42
const DEFAULT_HEATMAP_WINDOW_SECONDS = DEFAULT_HEATMAP_WINDOW_DAYS * SECONDS_PER_DAY

export const getCodeHeatmap = function getCodeHeatmap(
  db: D1Database,
  workspaceId: string,
  range: CodeHeatmapRange,
  now?: number,
): Effect.Effect<CodeHeatmap, DataQueryError> {
  return queryEffect('getCodeHeatmap', () => readCodeHeatmap(db, workspaceId, range, now ?? currentEpochSeconds()))
}
