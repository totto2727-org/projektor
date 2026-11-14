import { makeWorkerBridge } from 'alchemy/Cloudflare/Bridge'
import { WorkerEntrypoint } from 'cloudflare:workers'
import migrations from 'virtual:fixture-migrations'
import entrypoint from 'virtual:production-core-entrypoint'

import type { CoreEnvironment } from '../../src/core/environment'

// Use the configured production module's default export, just like Alchemy's bundler.
const NativeCore = makeWorkerBridge(WorkerEntrypoint, {
  entrypoint,
  stack: { name: 'projektor-e2e', stage: 'test' },
})

let initializing: Promise<{ migrations: number }> | undefined

/** Acceptance-only entrypoint. Production Core never imports or applies migrations. */
export default class FixtureCore extends NativeCore {
  declare readonly env: CoreEnvironment
  async initializeFixture(): Promise<{ migrations: number }> {
    initializing ??= this.applyFixtureMigrations().catch((error: unknown) => {
      initializing = undefined
      throw error
    })
    return initializing
  }

  /** Re-enter migration application without resetting the database or its ledger. */
  async reinitializeFixture(): Promise<{ migrations: number }> {
    await this.initializeFixture()
    return this.applyFixtureMigrations()
  }

  private async applyFixtureMigrations(): Promise<{ migrations: number }> {
    const db = this.env.DB
    await db
      .prepare('CREATE TABLE IF NOT EXISTS __projektor_fixture_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)')
      .run()
    const applied = await db
      .prepare('SELECT name, hash FROM __projektor_fixture_migrations')
      .all<{ name: string; hash: string }>()
    const history = new Map(applied.results.map((row) => [row.name, row.hash]))
    const known = new Set(migrations.map((migration) => migration.name))
    for (const name of history.keys()) {
      if (!known.has(name)) throw new Error(`Unknown fixture migration history: ${name}`)
    }
    for (const migration of migrations) {
      const previous = history.get(migration.name)
      if (previous !== undefined) {
        if (previous !== migration.hash) throw new Error(`Changed fixture migration history: ${migration.name}`)
        continue
      }
      // D1 batches commit each migration and its ledger row together or roll both back.
      await db.batch([
        ...migration.queries.map((query) => db.prepare(query)),
        db
          .prepare('INSERT INTO __projektor_fixture_migrations (name, hash) VALUES (?, ?)')
          .bind(migration.name, migration.hash),
      ])
    }
    return { migrations: migrations.length }
  }
}
