import { Predicate } from 'effect'
import type { Effect } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { drizzle, schema } from '#db'

import { queryEffect } from './errors.ts'
import type { DataQueryError } from './errors.ts'
import { buildCfdOverTime } from './flow-metrics-cfd.ts'
import {
  buildAgingWip,
  computeAutonomyRatios,
  computeCoreDistributions,
  computeFlowEfficiencies,
  computeHumanInterventions,
  summarize,
} from './flow-metrics-distributions.ts'
import type { Distribution, FlowIssueRow } from './flow-metrics-distributions.ts'
import {
  buildArrivalVsCompletion,
  buildBugShareOverTime,
  buildReviewLatencyOverTime,
  buildThroughputOverTime,
  buildWipOverTime,
  resolveFlowMetricWindows,
} from './flow-metrics-series.ts'
import { assembleFlowWindowQueries, createFlowIssueWindow, selectFlowIssues } from './flow-metrics-storage.ts'
import type { BugTypeMarker, FlowIssueWindow, fetchWindowCounts } from './flow-metrics-storage.ts'

export type { Distribution } from './flow-metrics-distributions.ts'

/** App-validated range. Authorization and input validation belong to the caller. */
export interface FlowMetricsRange {
  projectId: string
  since?: number
  until?: number
  granularity: 'day' | 'week'
}

export interface FlowMetrics {
  leadTime: Distribution
  leadTimeExcluded: number
  cycleTime: Distribution
  wipOverTime: ReturnType<typeof buildWipOverTime>
  throughputOverTime: ReturnType<typeof buildThroughputOverTime>
  bugShareOverTime: ReturnType<typeof buildBugShareOverTime>
  bugTypeTracked: boolean
  reviewLatency: Distribution
  reviewLatencyOverTime: ReturnType<typeof buildReviewLatencyOverTime>
  humanInterventions: Distribution
  autonomyRatio: Distribution
  cfdOverTime: ReturnType<typeof buildCfdOverTime>
  timeInProgress: Distribution
  arrivalVsCompletionOverTime: ReturnType<typeof buildArrivalVsCompletion>
  flowEfficiency: Distribution
  agingWip: ReturnType<typeof buildAgingWip>
  factoryHealth: Omit<Awaited<ReturnType<typeof fetchWindowCounts>>, 'doneBeforeWindow'>
}

interface IssueActivity {
  durations: ReturnType<typeof computeCoreDistributions>
  inWindow: (timestamp: number) => boolean
  issues: FlowIssueRow[]
}

interface FlowSeries {
  arrivalVsCompletionOverTime: FlowMetrics['arrivalVsCompletionOverTime']
  bugShareOverTime: FlowMetrics['bugShareOverTime']
  bugTypeTracked: boolean
  cfdOverTime: FlowMetrics['cfdOverTime']
  reviewLatencyOverTime: FlowMetrics['reviewLatencyOverTime']
  throughputOverTime: FlowMetrics['throughputOverTime']
  wipOverTime: FlowMetrics['wipOverTime']
}

type MetricWindows = ReturnType<typeof resolveFlowMetricWindows>
type FlowWindowQueries = ReturnType<typeof assembleFlowWindowQueries>

type FlowWindowData = Awaited<ReturnType<typeof Promise.all<FlowWindowQueries>>>

const collectIssueActivity = function collectIssueActivity(
  loaded: FlowIssueRow[],
  { inSqlWindow }: FlowIssueWindow,
  { since, until }: Pick<FlowMetricsRange, 'since' | 'until'>,
): IssueActivity {
  const issues = loaded.filter((issue) => inSqlWindow(issue))

  /*
   * Scope by project only, not created_at: since/until describe an activity window
   * (claimed/done), and an issue created before the window but active inside it must
   * still count (e.g. WIP). The SQL filter bounds the row count by the window.
   */
  const inWindow = (timestamp: number): boolean =>
    (Predicate.isNullish(since) || timestamp >= since) && (Predicate.isNullish(until) || timestamp <= until)

  return { durations: computeCoreDistributions(issues, inWindow), inWindow, issues }
}

const buildFlowSeries = function buildFlowSeries(
  issues: FlowIssueRow[],
  { throughputSince, throughputUntil, wipSince, wipUntil }: MetricWindows,
  {
    bugTypeExists,
    doneBeforeWindow,
    granularity,
    now,
  }: {
    bugTypeExists: BugTypeMarker | undefined
    doneBeforeWindow: number
    granularity: FlowMetricsRange['granularity']
    now: number
  },
): FlowSeries {
  const wipOverTime = buildWipOverTime(issues, wipSince, wipUntil)
  const throughputWindow = { granularity, since: throughputSince, until: throughputUntil }
  const throughputOverTime = buildThroughputOverTime(issues, throughputWindow)
  const reviewLatencyOverTime = buildReviewLatencyOverTime(issues, throughputWindow)
  const cfdOverTime = buildCfdOverTime(issues, throughputWindow, { doneBeforeWindow, now })

  // PROJ-331: A rising bug share signals more shipped defects, alongside work throughput.
  const bugShareOverTime = buildBugShareOverTime(issues, throughputWindow)
  const bugTypeTracked = Predicate.isNotNullish(bugTypeExists)
  const arrivalVsCompletionOverTime = buildArrivalVsCompletion(issues, throughputWindow)
  return {
    arrivalVsCompletionOverTime,
    bugShareOverTime,
    bugTypeTracked,
    cfdOverTime,
    reviewLatencyOverTime,
    throughputOverTime,
    wipOverTime,
  }
}

/*
 * PROJ-921: report completed issues with no ready timestamp separately so a small
 * or skewed lead-time sample remains visible.
 */
const countMissingLeadTimes = function countMissingLeadTimes(
  issues: FlowIssueRow[],
  inWindow: IssueActivity['inWindow'],
): number {
  return issues.filter(
    (issue) => Predicate.isNullish(issue.readyAt) && Predicate.isNotNullish(issue.doneAt) && inWindow(issue.doneAt),
  ).length
}

const summarizeFlowMetrics = function summarizeFlowMetrics(
  { durations, inWindow, issues }: IssueActivity,
  [humanCommentCounts, leaseHeldSeconds, bugTypeExists, windowCounts]: FlowWindowData,
  {
    granularity,
    loaded,
    now,
    windows,
  }: {
    granularity: FlowMetricsRange['granularity']
    loaded: FlowIssueRow[]
    now: number
    windows: MetricWindows
  },
): FlowMetrics {
  const { doneBeforeWindow, ...factoryHealth } = windowCounts
  const humanInterventions = computeHumanInterventions(issues, humanCommentCounts, inWindow)
  const autonomyRatios = computeAutonomyRatios(issues, leaseHeldSeconds, inWindow)
  const series = buildFlowSeries(issues, windows, { bugTypeExists, doneBeforeWindow, granularity, now })
  const flowEfficiencies = computeFlowEfficiencies(issues, leaseHeldSeconds, inWindow)
  const agingWip = buildAgingWip(loaded, now)
  const { leadTimes, cycleTimes, reviewLatencies, timeInProgress } = durations

  return fieldsInOrder([
    ['leadTime', summarize(leadTimes)],
    ['leadTimeExcluded', countMissingLeadTimes(issues, inWindow)],
    ['cycleTime', summarize(cycleTimes)],
    ['wipOverTime', series.wipOverTime],
    ['throughputOverTime', series.throughputOverTime],
    ['bugShareOverTime', series.bugShareOverTime],
    ['bugTypeTracked', series.bugTypeTracked],
    // PROJ-328: review latency measures the in_review to done handoff.
    // Human interventions and autonomy ratios use completed issues.
    ['reviewLatency', summarize(reviewLatencies)],
    ['reviewLatencyOverTime', series.reviewLatencyOverTime],
    ['humanInterventions', summarize(humanInterventions)],
    ['autonomyRatio', summarize(autonomyRatios)],
    // PROJ-329: cumulative flow diagram + time-in-state breakdown.
    ['cfdOverTime', series.cfdOverTime],
    ['timeInProgress', summarize(timeInProgress)],
    // PROJ-330: arrival vs completion, flow efficiency, aging-WIP scatter.
    ['arrivalVsCompletionOverTime', series.arrivalVsCompletionOverTime],
    ['flowEfficiency', summarize(flowEfficiencies)],
    ['agingWip', agingWip],
    // PROJ-334: factory health — fault signals for the machinery itself.
    ['factoryHealth', factoryHealth],
  ])
}

const readFlowMetrics = async function readFlowMetrics({
  db,
  now: fixedNow,
  range,
  workspaceId,
}: {
  db: D1Database
  now?: number
  range: FlowMetricsRange
  workspaceId: string
}): Promise<FlowMetrics> {
  const now = fixedNow ?? currentEpochSeconds()
  const { projectId, since, until, granularity } = range
  const orm = drizzle(db, { schema })
  const windows = resolveFlowMetricWindows({ since, until }, now)
  const issueWindow = createFlowIssueWindow({ now, projectId, since, until, workspaceId })
  const loaded = await selectFlowIssues(orm, issueWindow)
  const activity = collectIssueActivity(loaded, issueWindow, { since, until })
  const details = await Promise.all(
    assembleFlowWindowQueries(orm, {
      issueWindow,
      projectId,
      since,
      throughputSince: windows.throughputSince,
      throughputUntil: windows.throughputUntil,
      until,
      workspaceId,
    }),
  )
  return summarizeFlowMetrics(activity, details, { granularity, loaded, now, windows })
}

/**
 * Read flow metrics when the caller executes the Effect. The caller validates the range and authorizes project access.
 *
 * @param {D1Database} db The target database.
 * @param {string} workspaceId The workspace that owns the project.
 * @param {FlowMetricsRange} range The project, date window and bucket granularity.
 * @param {number} [now] The optional clock value in epoch seconds.
 * @returns {Effect.Effect<FlowMetrics, DataQueryError>} The metrics or their named query error.
 */
// oxlint-disable-next-line eslint/max-params -- Existing callers pass the database, workspace, range and optional clock positionally.
export const getFlowMetrics = function getFlowMetrics(
  db: D1Database,
  workspaceId: string,
  range: FlowMetricsRange,
  now?: number,
): Effect.Effect<FlowMetrics, DataQueryError> {
  return queryEffect('getFlowMetrics', readFlowMetrics.bind(undefined, { db, now, range, workspaceId }))
}
