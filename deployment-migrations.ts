import * as d1 from '@distilled.cloud/cloudflare/d1'
import * as Retry from '@distilled.cloud/cloudflare/Retry'
import { Action } from 'alchemy/Action'
import { CloudflareEnvironment } from 'alchemy/Cloudflare'
import { inlineSqlParams, readFlatRecords, type MigrationRecord } from 'alchemy/SQL/Migrations/index'
import { Effect, Schema } from 'effect'

import { deployment } from './worker-graph'

const LedgerSchema = Schema.Array(Schema.Struct({ name: Schema.String }))

/** The native runner converts Wrangler's ledger. Keep the existing table and rows instead. */
export function pendingMigrations(files: readonly MigrationRecord[], ledger: typeof LedgerSchema.Type) {
  const names = files.map((file) => file.name)
  const applied = ledger.map((row) => row.name)
  if (
    !names.includes('0067_agent_session_credential.sql') ||
    names.some((name) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) ||
    new Set(names).size !== names.length ||
    new Set(applied).size !== applied.length ||
    applied.some((name) => !names.includes(name))
  ) {
    throw new Error('Migration files and existing d1_migrations history are inconsistent.')
  }
  const pending = files.filter((file) => !applied.includes(file.name)).toSorted((a, b) => a.name.localeCompare(b.name))
  if (pending.some((file) => file.name.slice(0, 4) <= '0067')) {
    throw new Error('Legacy migrations through 0067 require an offline reviewed upgrade.')
  }
  const latest = applied.toSorted().at(-1)
  // 0069 was incident-applied before independent 0068. No other gap is approved.
  if (
    pending.some(
      (file) =>
        latest &&
        file.name < latest &&
        !(file.name === '0068_wiki_draft_heads.sql' && latest === '0069_attachment_review_status.sql'),
    )
  ) {
    throw new Error('Pending migrations precede applied history. An explicitly reviewed upgrade is required.')
  }
  return pending
}

export type MigrationQuery = (
  request: Pick<d1.QueryDatabaseRequest, 'sql' | 'params'>,
) => Effect.Effect<d1.QueryDatabaseResponse, unknown>

export const applyMigrations = (files: readonly MigrationRecord[], query: MigrationQuery) =>
  Effect.gen(function* () {
    const execute = (request: Parameters<MigrationQuery>[0]) =>
      query(request).pipe(
        Retry.none,
        Effect.flatMap((reply) =>
          reply.result.length && reply.result.every((result) => result.success === true)
            ? Effect.succeed(reply)
            : Effect.fail(new Error('D1 did not confirm every migration statement.')),
        ),
      )
    const ledger = yield* execute({ sql: 'SELECT name FROM d1_migrations ORDER BY id' }).pipe(
      Effect.flatMap((reply) => Schema.decodeUnknownEffect(LedgerSchema)(reply.result[0]?.results)),
    )
    const pending = pendingMigrations(files, ledger)
    if (!pending.length) return
    yield* execute({
      sql: 'CREATE TABLE IF NOT EXISTS __projektor_migration_attempts(name TEXT PRIMARY KEY, hash TEXT NOT NULL)',
    })
    for (const migration of pending) {
      // Confirm this separate request before sending SQL. A partial write or lost
      // response leaves the primary key occupied, stopping blind replay on redeploy.
      yield* execute({
        sql: 'INSERT INTO __projektor_migration_attempts(name, hash) VALUES (?, ?)',
        params: [migration.name, migration.hash],
      }).pipe(
        Effect.mapError(
          (cause) =>
            new Error(
              `Cannot start migration ${migration.name}. Inspect D1 for an unconfirmed earlier attempt before retrying.`,
              { cause },
            ),
        ),
      )
      yield* execute({
        sql: `${migration.sql}\n;\n${inlineSqlParams('INSERT INTO d1_migrations(name) VALUES (?)', [migration.name], 'sqlite')};`,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new Error(
              `Migration ${migration.name} failed. Inspect D1 before retrying; do not delete its attempt marker blindly.`,
              { cause },
            ),
        ),
      )
    }
  })

const Migrate = Action(
  'projektor/ApplyDatabaseMigrations',
  (input: { accountId: string; databaseId: string; files: readonly MigrationRecord[] }) =>
    Effect.gen(function* () {
      const query = yield* d1.queryDatabase
      yield* applyMigrations(input.files, (request) =>
        query({ accountId: input.accountId, databaseId: input.databaseId, ...request }),
      )
      return { environment: 'production' as const }
    }),
)

/** Only apply executes SQL. Plan and Worker runtime capture remain read-only. */
export const productionMigrations = Effect.gen(function* () {
  const files = yield* readFlatRecords('./migrations').pipe(Effect.orDie)
  const environment = yield* CloudflareEnvironment
  const { accountId } = yield* environment
  return yield* Migrate('DatabaseMigrations', { accountId, databaseId: deployment.storage.database.id, files })
})
