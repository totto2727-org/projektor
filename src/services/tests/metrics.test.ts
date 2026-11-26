import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { SQL_NULL } from '#db/sql-null.ts'
import { migratedDb } from '#db/test/helpers.ts'
import { getCodeHeatmap } from '#services/code-heatmap.ts'
import { DataQueryError } from '#services/errors.ts'
import { getFlowMetrics } from '#services/flow-metrics.ts'
import { JSON_NULL } from '#tests/json-null.ts'
import { runTestEffect } from '#tests/run-effect.ts'

const DAY = 86_400
const now = 3 * DAY

/**
 * Executes the production Drizzle SQL against the complete migrated SQLite schema.
 *
 * @param {DatabaseSync} sqlite - The SQLite database with migrations applied.
 * @param {() => void} onQuery - The function to call before each read.
 * @returns {D1Database} The D1 read methods that use this database.
 */
const readDatabase = function readDatabase(sqlite: DatabaseSync, onQuery: () => void = () => {}): D1Database {
  const prepare = function prepare(sql: string, bindings: SQLInputValue[] = []) {
    return {
      all: async () => {
        onQuery()
        return { results: sqlite.prepare(sql).all(...bindings) }
      },
      bind: (...values: SQLInputValue[]) => prepare(sql, values),
      raw: async () => {
        onQuery()
        return sqlite
          .prepare(sql)
          .all(...bindings)
          .map((row) => Object.values(row))
      },
    }
  }
  return { prepare } as unknown as D1Database
}

const distribution = (value: number): { count: number; avg: number; p50: number; p90: number } => ({
  avg: value,
  count: 1,
  p50: value,
  p90: value,
})

describe('shared metrics migrated SQLite reads', () => {
  let sqlite: DatabaseSync
  let db: D1Database

  beforeEach(() => {
    sqlite = migratedDb()
    db = readDatabase(sqlite)
    sqlite.exec(`
			INSERT INTO workspaces (id,name,slug,created_at) VALUES ('wa','A','a',1),('wb','B','b',1);
			INSERT INTO users (id,email,name,created_at) VALUES ('u','user@example.com','U',1);
			INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES
			 ('pa','wa','A','A',1,1),('pb','wb','B','B',1,1),('other','wa','Other','OTHER',1,1);
			INSERT INTO task_types (id,workspace_id,key,name) VALUES ('bug','wa','bug','Bug');
			INSERT INTO agent_sessions (id,workspace_id,name,started_at,last_heartbeat_at) VALUES ('agent','wa','Agent',1,1);
		`)
    const insert = sqlite.prepare(`INSERT INTO issues
			(id,workspace_id,project_id,number,title,status,created_by_id,created_at,updated_at,ready_at,claimed_at,in_review_at,done_at,review_bounce_count,type_id)
			VALUES (?,?,?,?, 'Issue',?, 'u',?,?, ?,?,?,?, ?,?)`)
    insert.run('done', 'wa', 'pa', 1, 'done', DAY + 10, DAY + 70, DAY + 20, DAY + 30, DAY + 50, DAY + 70, 2, 'bug')
    insert.run('old', 'wa', 'pa', 2, 'done', 1, DAY - 1, SQL_NULL, SQL_NULL, SQL_NULL, DAY - 1, 0, SQL_NULL)
    insert.run('future-open', 'wa', 'pa', 3, 'in_progress', now, now, SQL_NULL, now, SQL_NULL, SQL_NULL, 0, SQL_NULL)
    insert.run(
      'foreign',
      'wb',
      'pb',
      1,
      'done',
      DAY + 10,
      DAY + 70,
      DAY + 20,
      DAY + 30,
      DAY + 50,
      DAY + 70,
      10,
      SQL_NULL,
    )
    insert.run(
      'other-project',
      'wa',
      'other',
      1,
      'done',
      DAY + 10,
      DAY + 70,
      DAY + 20,
      DAY + 30,
      DAY + 50,
      DAY + 70,
      10,
      SQL_NULL,
    )
    sqlite.exec(`
			INSERT INTO issue_comments (id,issue_id,author_id,body,created_at,updated_at,author_kind) VALUES
			 ('human','done','u','Human',1,1,'human'),('agent-comment','done','u','Agent',1,1,'agent'),('legacy','done','u','Legacy',1,1,NULL);
			INSERT INTO issue_leases (id,workspace_id,issue_id,agent_session_id,claimed_at,released_at,release_reason) VALUES
			 ('lease','wa','done','agent',${DAY + 30},${DAY + 50},'expired');
			INSERT INTO issue_file_claims (id,workspace_id,issue_id,path,claimed_at,released_at,release_reason) VALUES
			 ('claim','wa','done','src/a.ts',${DAY + 30},${DAY + 50},'agent_ended');
			INSERT INTO issue_gate_rejections (id,workspace_id,issue_id,occurred_at) VALUES ('gate','wa','done',${DAY + 50});
			INSERT INTO wip_cap_denials (id,workspace_id,project_id,issue_id,occurred_at) VALUES ('cap','wa','pa','done',${DAY + 50});
		`)
  })

  afterEach(() => sqlite.close())

  test('preserves the complete windowed output, historical CFD baseline, human attribution and present aging snapshot', async () => {
    const result = await runTestEffect(
      getFlowMetrics(db, 'wa', { granularity: 'day', projectId: 'pa', since: DAY, until: now - 1 }, now),
    )
    expect(result).toStrictEqual({
      agingWip: [{ ageSeconds: 0, id: 'future-open', status: 'in_progress' }],
      arrivalVsCompletionOverTime: [
        { bucketStart: '1970-01-02', completed: 1, created: 1, net: 0 },
        { bucketStart: '1970-01-03', completed: 0, created: 0, net: 0 },
      ],
      autonomyRatio: distribution(0.5),
      bugShareOverTime: [
        { bucketStart: '1970-01-02', bugCount: 1, bugSharePercent: 1, total: 1 },
        { bucketStart: '1970-01-03', bugCount: 0, bugSharePercent: JSON_NULL, total: 0 },
      ],
      bugTypeTracked: true,
      cfdOverTime: [
        { backlogTodo: 0, bucketStart: '1970-01-02', done: 2, inProgress: 0, inReview: 0 },
        { backlogTodo: 0, bucketStart: '1970-01-03', done: 2, inProgress: 0, inReview: 0 },
      ],
      cycleTime: distribution(40),
      factoryHealth: { abandonedClaims: 1, gateRejections: 1, leaseExpiries: 1, wipCapPressure: 1 },
      flowEfficiency: distribution(0.4),
      humanInterventions: distribution(3),
      leadTime: distribution(50),
      leadTimeExcluded: 0,
      reviewLatency: distribution(20),
      reviewLatencyOverTime: [
        { bucketStart: '1970-01-02', p50: 20 },
        { bucketStart: '1970-01-03', p50: JSON_NULL },
      ],
      throughputOverTime: [
        { bucketStart: '1970-01-02', count: 1 },
        { bucketStart: '1970-01-03', count: 0 },
      ],
      timeInProgress: distribution(20),
      wipOverTime: [
        { count: 0, date: '1970-01-02' },
        { count: 0, date: '1970-01-03' },
      ],
    })
  })

  test('retains unbounded default distributions and deterministic default day/ISO-week buckets', async () => {
    const result = await runTestEffect(getFlowMetrics(db, 'wa', { granularity: 'week', projectId: 'pa' }, now))
    expect(result.leadTime).toStrictEqual(distribution(50))
    expect(result.leadTimeExcluded).toBe(1)
    expect(result.humanInterventions.count).toBe(2)
    expect(result.throughputOverTime).toHaveLength(6)
    expect(result.wipOverTime).toHaveLength(31)
    expect(result.throughputOverTime.at(-1)).toStrictEqual({ bucketStart: '1969-12-29', count: 2 })
  })

  test('clamps partial weekly edges and returns empty data without cross-workspace leakage', async () => {
    const partial = await runTestEffect(
      getFlowMetrics(db, 'wa', { granularity: 'week', projectId: 'pa', since: DAY + 60, until: DAY + 70 }, now),
    )
    expect(partial.throughputOverTime).toStrictEqual([{ bucketStart: '1969-12-29', count: 1 }])
    expect(partial.arrivalVsCompletionOverTime[0]).toMatchObject({
      completed: 1,
      created: 0,
      net: -1,
    })
    const foreign = await runTestEffect(
      getFlowMetrics(db, 'wa', { granularity: 'day', projectId: 'pb', since: DAY, until: now }, now),
    )
    expect(foreign.leadTime).toStrictEqual({ avg: JSON_NULL, count: 0, p50: JSON_NULL, p90: JSON_NULL })
    expect(foreign.agingWip).toStrictEqual([])
    expect(foreign.factoryHealth).toStrictEqual({
      abandonedClaims: 0,
      gateRejections: 0,
      leaseExpiries: 0,
      wipCapPressure: 0,
    })
  })

  test('retains claims drill-down, stable count ordering, inclusive bounds and unfiltered total distinct issues', async () => {
    const insert = sqlite.prepare(
      'INSERT INTO issue_file_claims (id,workspace_id,issue_id,path,claimed_at,released_at) VALUES (?,?,?,?,?,?)',
    )
    insert.run('nested', 'wa', 'old', 'src/nested/a.ts', DAY, DAY + 1)
    insert.run('same', 'wa', 'done', 'src', DAY + 1, DAY + 2)
    insert.run('docs', 'wa', 'future-open', 'docs/a.md', DAY + 2, DAY + 3)
    insert.run('end', 'wa', 'done', 'z.ts', now, now + 1)
    insert.run('before', 'wa', 'done', 'outside.ts', DAY - 1, DAY)
    insert.run('foreign-claim', 'wb', 'foreign', 'foreign.ts', DAY, SQL_NULL)
    insert.run('other-claim', 'wa', 'other-project', 'other.ts', DAY, SQL_NULL)
    const result = await runTestEffect(getCodeHeatmap(db, 'wa', { projectId: 'pa', since: DAY, until: now }, now))
    expect(result).toStrictEqual({
      entries: [
        { claimCount: 3, distinctIssueCount: 2, isLeaf: false, path: 'src', segment: 'src' },
        { claimCount: 1, distinctIssueCount: 1, isLeaf: false, path: 'docs', segment: 'docs' },
        { claimCount: 1, distinctIssueCount: 1, isLeaf: true, path: 'z.ts', segment: 'z.ts' },
      ],
      mode: 'claims',
      prefix: '',
      totalDistinctIssues: 3,
    })
    const nested = await runTestEffect(
      getCodeHeatmap(db, 'wa', { prefix: 'src', projectId: 'pa', since: DAY, until: now }, now),
    )
    expect(nested).toStrictEqual({
      entries: [
        { claimCount: 1, distinctIssueCount: 1, isLeaf: true, path: 'src/a.ts', segment: 'a.ts' },
        {
          claimCount: 1,
          distinctIssueCount: 1,
          isLeaf: false,
          path: 'src/nested',
          segment: 'nested',
        },
      ],
      mode: 'claims',
      prefix: 'src',
      totalDistinctIssues: 3,
    })
  })

  test('retains contention DTO names and tenant/project/default-window filters', async () => {
    const insert = sqlite.prepare(
      'INSERT INTO claim_conflicts (id,workspace_id,path,rejected_issue_id,holding_issue_id,occurred_at) VALUES (?,?,?,?,?,?)',
    )
    insert.run('c1', 'wa', 'src/a.ts', 'done', 'old', DAY)
    insert.run('c2', 'wa', 'src/b.ts', 'old', 'done', now)
    insert.run('c3', 'wa', 'src/a.ts', 'done', 'old', DAY + 1)
    insert.run('cf', 'wb', 'foreign.ts', 'foreign', 'foreign', DAY)
    insert.run('cp', 'wa', 'other.ts', 'other-project', 'done', DAY)
    const result = await runTestEffect(getCodeHeatmap(db, 'wa', { mode: 'contention', projectId: 'pa' }, now))
    expect(result).toStrictEqual({
      entries: [
        {
          conflictCount: 3,
          distinctRejectedIssueCount: 2,
          isLeaf: false,
          path: 'src',
          segment: 'src',
        },
      ],
      mode: 'contention',
      prefix: '',
      totalDistinctIssues: 2,
    })
    await expect(
      runTestEffect(getCodeHeatmap(db, 'wa', { mode: 'contention', projectId: 'pb' }, now)),
    ).resolves.toStrictEqual({
      entries: [],
      mode: 'contention',
      prefix: '',
      totalDistinctIssues: 0,
    })
  })

  test('defers SQL execution and reports query failures with the package DataQueryError', async () => {
    let queries = 0
    const tracked = readDatabase(sqlite, () => {
      queries++
    })
    const flow = getFlowMetrics(tracked, 'wa', { granularity: 'day', projectId: 'pa', since: DAY, until: now }, now)
    const heatmap = getCodeHeatmap(tracked, 'wa', { projectId: 'pa' }, now)
    expect(queries).toBe(0)
    await runTestEffect(flow)
    await runTestEffect(heatmap)
    expect(queries).toBeGreaterThan(0)
    const failed = {
      prepare: () => {
        throw new Error('database unavailable')
      },
    } as unknown as D1Database
    const error = await runTestEffect(getCodeHeatmap(failed, 'wa', { projectId: 'pa' }, now).pipe(Effect.flip))
    expect(error).toBeInstanceOf(DataQueryError)
    expect(error.operation).toBe('getCodeHeatmap')
    const flowError = await runTestEffect(
      getFlowMetrics(failed, 'wa', { granularity: 'day', projectId: 'pa' }, now).pipe(Effect.flip),
    )
    expect(flowError).toBeInstanceOf(DataQueryError)
    expect(flowError.operation).toBe('getFlowMetrics')
  })
})
