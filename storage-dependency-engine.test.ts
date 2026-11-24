import { NodeServices } from '@effect/platform-node'
import { AlchemyContext, apply, inMemoryState, Plan, Resource, Stack } from 'alchemy'
import { provideFreshArtifactStore } from 'alchemy/Artifacts'
import { layerNonInteractive } from 'alchemy/Interaction'
import * as Output from 'alchemy/Output'
import * as Provider from 'alchemy/Provider'
import { evalStack } from 'alchemy/Stack'
import { run } from 'alchemy/Test/Core'
import { Effect, Layer } from 'effect'
import { expect, test } from 'vite-plus/test'

const Database =
  Resource<
    Resource<
      'Fixture.Database',
      { migration: number },
      { databaseId: string; migrationsHashes: Record<string, string> }
    >
  >('Fixture.Database')
const Worker =
  Resource<Resource<'Fixture.Worker', { version: number; env: { ENVIRONMENT: string } }, { name: string }>>(
    'Fixture.Worker',
  )
const workers = ['Api', 'Core', 'Frontend']

test.each(['all Workers update', 'Core is unchanged', 'migration fails'] as const)(
  'gates Worker updates on database reconciliation when %s',
  async (scenario) => {
    const events: string[] = []
    const state = inMemoryState()
    const providers = Layer.merge(
      Provider.succeed(Database, {
        stables: ['databaseId'],
        reconcile: ({ news }) =>
          Effect.gen(function* () {
            events.push('database:start')
            yield* Effect.sleep('10 millis')
            if (news.migration === 2 && scenario === 'migration fails') {
              return yield* Effect.fail(new Error('Fixture migration failed'))
            }
            events.push('database:complete')
            return { databaseId: 'existing-database', migrationsHashes: { fixture: String(news.migration) } }
          }),
        delete: () => Effect.void,
      }),
      Provider.succeed(Worker, {
        reconcile: ({ id, news, olds, output }) =>
          Effect.sync(() => {
            expect(news.env.ENVIRONMENT).toBe('production')
            if (output && olds?.version === news.version && olds.env.ENVIRONMENT === news.env.ENVIRONMENT) {
              return output
            }
            events.push(id)
            return { name: id }
          }),
        delete: () => Effect.void,
      }),
    )
    const deploy = (version: number): Promise<void> => {
      const stack = Stack(
        'storage-dependency-test',
        { providers, state },
        Effect.gen(function* () {
          const database = yield* Database('Database', { migration: version })
          // Alchemy can resolve the stable databaseId before reconciliation ends.
          // The nonstable migrationsHashes output waits for the migration result.
          const env = { ENVIRONMENT: Output.map(database.migrationsHashes, () => 'production') }
          for (const id of workers) {
            yield* Worker(id, { version: id === 'Core' && scenario === 'Core is unchanged' ? 1 : version, env })
          }
          return {}
        }),
      )
      return run(
        evalStack(
          stack,
          (compiled) =>
            Effect.gen(function* () {
              const plan = yield* Plan.make(compiled)
              expect(events).toStrictEqual([])
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

    await deploy(1)
    expect(events.slice(0, 2)).toStrictEqual(['database:start', 'database:complete'])
    expect(events.slice(2).sort()).toStrictEqual(workers)
    events.length = 0

    if (scenario === 'migration fails') {
      await expect(deploy(2)).rejects.toThrow(/Fixture migration failed/u)
      expect(events).toStrictEqual(['database:start'])
    } else {
      await deploy(2)
      expect(events.slice(0, 2)).toStrictEqual(['database:start', 'database:complete'])
      expect(events.slice(2).sort()).toEqual(scenario === 'Core is unchanged' ? ['Api', 'Frontend'] : workers)
    }
  },
)
