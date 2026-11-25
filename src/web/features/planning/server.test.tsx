import { Effect, Result, Schema, pipe } from 'effect'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vite-plus/test'

import { resetProvisioningCacheForTests } from '#commands/provisioning.ts'
import { resetAuthCachesForTests } from '#services/authentication.ts'
import { runTestEffect, runInOrder } from '#tests/run-effect.ts'
import { coreResult, browserRequest } from '@/core.ts'
import { makeRequestServices, RequestServices } from '@/request.ts'
import type { ApiError, ScopeError } from '@/server/errors.ts'
import type { RequestScope } from '@/server/request-context.ts'
import { testEnvironment } from '@/server/test/resources.ts'

import { featureDatabase } from './action-test-fixture.ts'
import type * as Actions from './actions.ts'
import { defaultRange, rangeFromUrl } from './helpers.ts'
import { HeatmapSchema, MetricsSchema, SprintsSchema } from './schemas.ts'
import { loadSprintIssues, renderMetrics, renderSprints } from './server.tsx'

vi.mock('./actions', () => ({
  createSprint: vi.fn<typeof Actions.createSprint>(),
  editSprint: vi.fn<typeof Actions.editSprint>(),
  setSprintStatus: vi.fn<typeof Actions.setSprintStatus>(),
  archiveSprint: vi.fn<typeof Actions.archiveSprint>(),
  moveSprintIssues: vi.fn<typeof Actions.moveSprintIssues>(),
}))
vi.hoisted(() =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn<MediaQueryList['addEventListener']>(),
      removeEventListener: vi.fn<MediaQueryList['removeEventListener']>(),
    })),
  ),
)

const decodeSprints = Schema.decodeUnknownResult(SprintsSchema, { errors: 'all' })
const decodeMetrics = Schema.decodeUnknownResult(MetricsSchema, { errors: 'all' })
const decodeHeatmap = Schema.decodeUnknownResult(HeatmapSchema)

function runWithDatabase<T>(
  database: ReturnType<typeof featureDatabase>,
  url: URL,
  use: (scope: RequestScope) => Effect.Effect<T, ApiError | ScopeError, RequestServices>,
) {
  resetAuthCachesForTests()
  resetProvisioningCacheForTests()
  const transport = vi.spyOn(globalThis, 'fetch')
  const result = runTestEffect(
    Effect.gen(function* () {
      const services = yield* makeRequestServices(new Request(url), testEnvironment(database.db))
      const scope = yield* services.scope({
        requireProject: true,
        projectHint: 'p1',
        workspaceHint: 'alpha',
      })
      return yield* use(scope).pipe(Effect.provideService(RequestServices, services))
    }),
  )
  return { result, transport }
}
function issueRows(database: ReturnType<typeof featureDatabase>, count: number): void {
  const statement = database.sqlite.prepare(
    "INSERT INTO issues (id,workspace_id,project_id,number,title,created_by_id,created_at,updated_at,sprint_id,status) VALUES (?, 'w1', 'p1', ?, ?, 'u1', 1, 1, 's1', 'done')",
  )
  for (let index = 0; index < count; index += 1) {
    statement.run(`i${String(index).padStart(3, '0')}`, index + 1, `Completed task ${index}`)
  }
}

describe('planning SSR named shared queries on real migrated D1', () => {
  test.each(['all', 'planned', 'active', 'completed'] as const)(
    'renders URL %s mode with full sprint and velocity context without read HTTP',
    async (mode) => {
      const database = featureDatabase()
      database.sqlite.exec(
        "UPDATE sprints SET status='completed' WHERE id='s1'; UPDATE sprints SET status='active' WHERE id='s2'",
      )
      issueRows(database, 1)
      const run = runWithDatabase(database, new URL(`https://front.example/sprints?status=${mode}`), (scope) =>
        renderSprints(scope, new URL(`https://front.example/sprints?status=${mode}`)),
      )
      const node = await run.result
      expect(node.props.mode).toBe(mode)
      expect(node.props.allSprints.map((item: { id: string }) => item.id)).toStrictEqual(['s1', 's2'])
      expect(node.props.initialSprints.map((item: { status: string }) => item.status)).toStrictEqual(
        ['completed', 'active'].filter((status) => mode === 'all' || status === mode),
      )
      expect(node.props.initialIssues).toHaveLength(1)
      expect(renderToStaticMarkup(node)).toContain('Velocity')
      expect(run.transport).toHaveBeenCalledTimes(0)
    },
  )

  test('loads every issue page, including same-timestamp ties and real custom fields, for velocity', async () => {
    const database = featureDatabase()
    issueRows(database, 205)
    database.sqlite
      .exec(`INSERT INTO custom_field_definitions (id,workspace_id,key,label,type,created_at) VALUES ('points','w1','story_points','Story points','number',1);
			INSERT INTO custom_field_values (issue_id,field_id,value) VALUES ('i000','points','5');
			INSERT INTO issues (id,workspace_id,project_id,number,title,created_by_id,created_at,updated_at) VALUES ('private','w2','foreign',1,'Private','u1',999,999)`)
    database.sqlite.exec(
      "INSERT INTO issues (id,workspace_id,project_id,number,title,created_by_id,created_at,updated_at) VALUES ('other-project-issue','w1','other',1,'Other project','u1',998,998)",
    )
    const run = runWithDatabase(database, new URL('https://front.example/sprints'), (scope) =>
      loadSprintIssues('p1', 'alpha', scope),
    )
    const issues = await run.result
    expect(issues.some((item) => item.id === 'other-project-issue')).toBe(false)
    expect(issues).toHaveLength(205)
    expect(new Set(issues.map((item) => item.id)).size).toBe(205)
    expect(issues.find((item) => item.id === 'i000')?.customFields).toStrictEqual([{ key: 'story_points', value: '5' }])
    expect(issues.some((item) => item.id === 'private')).toBe(false)
    expect(run.transport).toHaveBeenCalledTimes(0)
  })

  test('rejects aggregates over the explicit budget instead of returning partial velocity', async () => {
    const database = featureDatabase()
    issueRows(database, 1001)
    await expect(
      runWithDatabase(database, new URL('https://front.example/sprints'), (scope) =>
        loadSprintIssues('p1', 'alpha', scope),
      ).result,
    ).rejects.toMatchObject({ _tag: 'ApiError', status: 422 })
  })

  test('rejects inaccessible selected projects before loading project data', async () => {
    const database = featureDatabase()
    const run = runWithDatabase(database, new URL('https://front.example/sprints'), (scope) =>
      renderSprints({ ...scope, projects: [] }, new URL('https://front.example/sprints')),
    )
    await expect(run.result).rejects.toMatchObject({ _tag: 'ScopeError', status: 404 })
  })

  test('rejects invalid sprint modes and metrics ranges rather than sending HTTP reads', async () => {
    expect.hasAssertions()
    const database = featureDatabase()
    await expect(
      runWithDatabase(database, new URL('https://front.example/sprints'), (scope) =>
        renderSprints(scope, new URL('https://front.example/sprints?status=archived')),
      ).result,
    ).rejects.toMatchObject({ _tag: 'ScopeError', status: 400 })
    await runInOrder(
      ['since=2026-10-04&until=2026-10-01', 'since=2026-02-30', 'since=2020-01-01&until=2026-01-01'],
      async (query): Promise<void> => {
        await expect(
          runWithDatabase(database, new URL('https://front.example/metrics'), (scope) =>
            renderMetrics(scope, new URL(`https://front.example/metrics?${query}`)),
          ).result,
        ).rejects.toMatchObject({ _tag: 'ScopeError', status: 400 })
      },
    )
  })

  test('private Core rejects excessive metrics ranges with HTTP 400 before chart allocation', async () => {
    const database = featureDatabase()
    const run = runWithDatabase(database, new URL('https://front.example/metrics'), () =>
      Effect.gen(function* () {
        const services = yield* RequestServices
        return yield* coreResult(
          MetricsSchema,
          services.core.webFlowMetrics(browserRequest(services.request), 'w1', {
            projectId: 'p1',
            since: 0,
            until: 366 * 86_400,
            granularity: 'day',
            mode: 'claims',
            prefix: '',
          }),
        )
      }),
    )
    await expect(run.result).rejects.toMatchObject({ _tag: 'ScopeError', status: 400 })
  })

  test('uses the exact UTC metrics window and contention prefix from the URL against real rows', async () => {
    const database = featureDatabase()
    issueRows(database, 1)
    const doneAt = Date.parse('2026-09-02T12:00:00Z') / 1000
    database.sqlite
      .prepare("UPDATE issues SET ready_at=?, claimed_at=?, done_at=? WHERE id='i000'")
      .run(doneAt - 3600, doneAt - 1800, doneAt)
    database.sqlite
      .prepare(
        "INSERT INTO claim_conflicts (id,workspace_id,path,rejected_issue_id,holding_issue_id,occurred_at) VALUES ('conflict','w1','src/api/server.ts','i000','i000',?)",
      )
      .run(doneAt)
    const url = new URL(
      'https://front.example/metrics?since=2026-09-01&until=2026-10-01&granularity=day&heatmapMode=contention&prefix=src',
    )
    const run = runWithDatabase(database, url, (scope) => renderMetrics(scope, url))
    const node = await run.result
    expect(node.props.initialRange).toStrictEqual({
      granularity: 'day',
      since: '2026-09-01',
      until: '2026-10-01',
    })
    expect(node.props.initialMetrics.leadTime).toStrictEqual({
      avg: 3600,
      count: 1,
      p50: 3600,
      p90: 3600,
    })
    expect(node.props.initialHeatmap).toStrictEqual({
      entries: [
        {
          conflictCount: 1,
          distinctRejectedIssueCount: 1,
          isLeaf: false,
          path: 'src/api',
          segment: 'api',
        },
      ],
      prefix: 'src',
      totalDistinctIssues: 1,
    })
    expect(node.props.initialUrl).toContain('workspace=alpha')
    expect(renderToStaticMarkup(node)).toContain('Where the fleet queues up')
    expect(run.transport).toHaveBeenCalledTimes(0)
  })

  test('retains core metrics when optional heatmap queries fail and safely reports core failures', async () => {
    const database = featureDatabase()
    database.sqlite.exec('DROP TABLE claim_conflicts')
    const url = new URL('https://front.example/metrics?heatmapMode=contention')
    const node = await runWithDatabase(database, url, (scope) => renderMetrics(scope, url)).result
    expect(node.props.initialHeatmap).toBeNull()
    expect(node.props.heatmapError).toContain('Failed to load')
    database.sqlite.exec('DROP TABLE task_types')
    await expect(runWithDatabase(database, url, (scope) => renderMetrics(scope, url)).result).rejects.toMatchObject({
      _tag: 'ApiError',
      message: 'An unexpected error occurred.',
      status: 500,
    })
  })

  test('decodes the existing concrete sprint, metrics and heatmap DTO contracts', () => {
    const invalidSprintStatus = pipe(
      decodeSprints({ items: [{ id: 's1', status: 'archived' }] }),
      Result.flip,
      Result.getOrUndefined,
    )
    expect(invalidSprintStatus?.message).toContain('["items"][0]["status"]')
    const invalidBugTrackedFlag = pipe(decodeMetrics({ bugTypeTracked: 'false' }), Result.flip, Result.getOrUndefined)
    expect(invalidBugTrackedFlag?.message).toContain('["bugTypeTracked"]')
    const invalidDistinctIssueTotal = pipe(
      decodeHeatmap({ prefix: '', totalDistinctIssues: '1', entries: [] }),
      Result.flip,
      Result.getOrUndefined,
    )
    expect(invalidDistinctIssueTotal?.message).toContain('["totalDistinctIssues"]')
  })

  test('keeps the six-week weekly default and date normalization', () => {
    const now = new Date('2026-10-04T12:00:00Z')
    expect(defaultRange(now)).toStrictEqual({
      granularity: 'week',
      since: '2026-08-24',
      until: '2026-10-04',
    })
    expect(rangeFromUrl(new URL('https://front.example/metrics?since=not-a-date&until=2026-10-04'), now).since).toBe(
      '2026-08-24',
    )
    expect(rangeFromUrl(new URL('https://front.example/metrics?since=2026-10-05&until=2026-10-01'), now).since).toBe(
      '2026-10-01',
    )
  })
})
