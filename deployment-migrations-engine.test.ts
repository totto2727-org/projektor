import { DatabaseSync } from 'node:sqlite'

import { NodeServices } from '@effect/platform-node'
import { Action, AlchemyContext, apply, inMemoryState, Plan, Resource, Stack } from 'alchemy'
import { provideFreshArtifactStore } from 'alchemy/Artifacts'
import { layerNonInteractive } from 'alchemy/Interaction'
import * as Provider from 'alchemy/Provider'
import type { MigrationRecord } from 'alchemy/SQL/Migrations/index'
import { evalStack } from 'alchemy/Stack'
import { run } from 'alchemy/Test/Core'
import { Effect } from 'effect'
import { expect, it } from 'vite-plus/test'

import { applyMigrations, type MigrationQuery } from './deployment-migrations'

const Worker = Resource<Resource<'Fixture.Worker', { environment: string }, { name: string }>>('Fixture.Worker')
const legacy = '0067_agent_session_credential.sql'
const migration = '0070_fixture.sql'
const body = 'CREATE TABLE fixture_write(id INTEGER PRIMARY KEY)'
const workerIds = ['Core', 'Api', 'Frontend']

it.each(['success', 'partial write'])('gates all Worker updates on migration apply: %s', async (outcome) => {
  using database = new DatabaseSync(':memory:')
  database.exec(`
    CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO d1_migrations(name, applied_at) VALUES ('${legacy}', 'baseline');
  `)
  const ledger = () => database.prepare('SELECT id, name, applied_at FROM d1_migrations ORDER BY id').all()
  const baseline = ledger()
  const statements = outcome === 'success' ? [body] : [body, 'INSERT INTO absent_fixture_table VALUES (1)']
  const record = (name: string, statements: string[]): MigrationRecord => ({
    name,
    hash: name,
    createdAtMillis: undefined,
    sql: statements.join(';\n'),
    statements,
  })
  const files = [record(legacy, ['SELECT 1']), record(migration, statements)]

  const events: { type: 'sql' | 'worker'; value: string }[] = []
  const query: MigrationQuery = ({ sql, params }) =>
    Effect.try(() => {
      if (!sql) throw new Error('Missing fixture SQL')
      events.push({ type: 'sql', value: sql })
      if (sql.startsWith('SELECT')) return { result: [{ success: true, results: database.prepare(sql).all() }] }
      if (params) {
        const bindings = params.map((value) => {
          if (typeof value !== 'string') throw new Error('Fixture requires string parameters')
          return value
        })
        database.prepare(sql).run(...bindings)
      } else {
        // SQLite exec does not open a transaction, so the first write remains on failure.
        database.exec(sql)
      }
      return { result: [{ success: true }] }
    })
  const Migrate = Action('Fixture.Migrate', ({ files }: { files: readonly MigrationRecord[] }) =>
    applyMigrations(files, query).pipe(Effect.as({ environment: 'production' })),
  )
  const providers = Provider.succeed(Worker, {
    reconcile: ({ id }) =>
      Effect.sync(() => {
        events.push({ type: 'worker', value: id })
        return { name: id }
      }),
    delete: () => Effect.void,
  })
  const state = inMemoryState()
  const deploy = (withMigration: boolean) => {
    const stack = Stack(
      'migration-engine-test',
      { providers, state },
      Effect.gen(function* () {
        const environment = withMigration ? (yield* Migrate({ files })).environment : 'baseline'
        for (const id of workerIds) yield* Worker(id, { environment })
        return {}
      }),
    )
    return run(
      evalStack(
        stack,
        (compiled) =>
          Effect.gen(function* () {
            const plan = yield* Plan.make(compiled)
            expect(events).toEqual([])
            yield* apply(plan)
          }),
        { stage: 'fixture' },
      ).pipe(
        Effect.provideService(AlchemyContext, { dotAlchemy: '.alchemy', dev: false, adopt: false }),
        provideFreshArtifactStore,
        Effect.provide(state),
        Effect.provide(layerNonInteractive()),
        Effect.provide(NodeServices.layer),
      ),
      { providers, state, dev: false },
    )
  }

  const workerEvents = () =>
    events
      .filter(({ type }) => type === 'worker')
      .map(({ value }) => value)
      .sort()
  const bodyRequests = () => events.filter(({ type, value }) => type === 'sql' && value.includes(body))
  await deploy(false)
  expect(workerEvents()).toEqual(workerIds.toSorted())
  events.length = 0

  if (outcome === 'success') {
    await deploy(true)
    expect(bodyRequests()).toHaveLength(1)
    expect(workerEvents()).toEqual(workerIds.toSorted())
    expect(events.findLastIndex(({ type }) => type === 'sql')).toBeLessThan(
      events.findIndex(({ type }) => type === 'worker'),
    )
    expect(ledger()).toEqual([...baseline, { id: 2, name: migration, applied_at: expect.any(String) }])
  } else {
    await expect(deploy(true)).rejects.toThrow(/Migration 0070_fixture.sql failed/)
    expect(bodyRequests()).toHaveLength(1)
    expect(workerEvents()).toEqual([])
    expect(database.prepare('SELECT id FROM fixture_write').all()).toEqual([])
    expect(ledger()).toEqual(baseline)

    events.length = 0
    await expect(deploy(true)).rejects.toThrow(/Cannot start migration 0070_fixture.sql/)
    expect(bodyRequests()).toEqual([])
    expect(workerEvents()).toEqual([])
    expect(ledger()).toEqual(baseline)
  }
})
