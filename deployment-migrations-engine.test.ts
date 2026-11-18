import { NodeServices } from '@effect/platform-node'
import { Action, AlchemyContext, apply, inMemoryState, Plan, Resource, Stack } from 'alchemy'
import { provideFreshArtifactStore } from 'alchemy/Artifacts'
import { layerNonInteractive } from 'alchemy/Interaction'
import * as Provider from 'alchemy/Provider'
import { evalStack } from 'alchemy/Stack'
import { run } from 'alchemy/Test/Core'
import { Effect } from 'effect'
import { expect, it } from 'vite-plus/test'

import { applyMigrations, prepareMigrations, type MigrationFile, type MigrationStore } from './deployment-migrations'

const Worker = Resource<Resource<'Fixture.Worker', { environment: string }, { name: string }>>('Fixture.Worker')

it('runs the migration Actions only on apply and blocks every dependent update after an uncertain write', async () => {
  const legacy = '0067_agent_session_credential.sql'
  const files = [
    { name: legacy, sql: 'SELECT 1;', hash: 'legacy' },
    { name: '0070_fixture.sql', sql: 'SELECT 1;', hash: 'fixture' },
  ] satisfies MigrationFile[]
  const events: string[] = []
  const attempts: { name: string; hash: string }[] = []
  const store: MigrationStore = {
    ledger: Effect.sync(() => {
      events.push('ledger')
      return [{ id: 1, name: legacy, applied_at: 'fixture' }]
    }),
    attempts: Effect.sync(() => attempts.slice()),
    checkpoint: Effect.sync(() => {
      events.push('checkpoint')
      return 'test-bookmark'
    }),
    begin: ({ name, hash }) =>
      Effect.sync(() => {
        events.push('begin')
        attempts.push({ name, hash })
      }),
    apply: () =>
      Effect.sync(() => {
        events.push('write')
      }).pipe(Effect.andThen(Effect.fail(new Error('response lost')))),
  }
  const Prepare = Action('Fixture.Prepare', ({ files }: { files: readonly MigrationFile[] }) =>
    prepareMigrations(files, store),
  )
  const Migrate = Action(
    'Fixture.Migrate',
    ({
      files,
      checkpoint,
    }: {
      files: readonly MigrationFile[]
      checkpoint: Effect.Success<ReturnType<typeof prepareMigrations>>
    }) => applyMigrations(files, checkpoint, store).pipe(Effect.as({ environment: 'production' })),
  )
  const providers = Provider.succeed(Worker, {
    reconcile: ({ id }) =>
      Effect.sync(() => {
        events.push(id)
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
        const environment = withMigration
          ? (yield* Migrate({ files, checkpoint: yield* Prepare({ files }) })).environment
          : 'baseline'
        for (const id of ['Core', 'Api', 'Frontend']) yield* Worker(id, { environment })
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

  await deploy(false)
  expect([...events].sort()).toEqual(['Api', 'Core', 'Frontend'])
  events.length = 0
  await expect(deploy(true)).rejects.toThrow()
  expect(events).toEqual(['ledger', 'checkpoint', 'ledger', 'begin', 'write'])
  events.length = 0
  await expect(deploy(true)).rejects.toThrow()
  expect(events).toEqual(['ledger'])
})
