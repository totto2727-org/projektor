import * as d1 from '@distilled.cloud/cloudflare/d1'
import * as Retry from '@distilled.cloud/cloudflare/Retry'
import { Action } from 'alchemy/Action'
import { CloudflareEnvironment } from 'alchemy/Cloudflare'
import { readFlatRecords } from 'alchemy/SQL/Migrations/index'
import { Effect, Schema } from 'effect'

import { deployment } from './worker-graph'

const LedgerSchema = Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String, applied_at: Schema.String }))
type Ledger = typeof LedgerSchema.Type
export interface MigrationFile {
  readonly name: string
  readonly sql: string
  readonly hash: string
}
const AttemptsSchema = Schema.Array(Schema.Struct({ name: Schema.String, hash: Schema.String }))
export interface MigrationStore<R = never> {
  readonly attempts: Effect.Effect<typeof AttemptsSchema.Type, unknown, R>
  readonly begin: (migration: MigrationFile) => Effect.Effect<void, unknown, R>
  readonly ledger: Effect.Effect<Ledger, unknown, R>
  readonly checkpoint: Effect.Effect<string, unknown, R>
  readonly apply: (migration: MigrationFile) => Effect.Effect<void, unknown, R>
}
interface MigrationInput {
  readonly accountId: string
  readonly databaseId: string
  readonly files: readonly MigrationFile[]
}
interface Checkpoint {
  readonly createdAt: number
  readonly ledger: Ledger
  readonly bookmark: string | null
}

/** Keep Wrangler's existing ledger. Alchemy's native D1 runner would convert it. */
export function pendingMigrations(files: readonly MigrationFile[], ledger: Ledger) {
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
  // Populated legacy upgrades can fail on slug collisions before an appended repair
  // could run. They require an offline approved mapping, never an automatic replay.
  if (pending.some((file) => file.name.slice(0, 4) <= '0067')) {
    throw new Error('Legacy migrations through 0067 must already be applied. An offline reviewed upgrade is required.')
  }
  const latest = applied.toSorted().at(-1)
  // 0069 was applied during the incident before independent 0068. This is the
  // only reviewed gap. Do not generalize it to arbitrary reordered migrations.
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

function verifyAttempts(files: readonly MigrationFile[], ledger: Ledger, attempts: typeof AttemptsSchema.Type) {
  for (const attempt of attempts) {
    if (!ledger.some((row) => row.name === attempt.name)) {
      throw new Error(
        `Unconfirmed migration attempt ${attempt.name}. Inspect D1 and the saved checkpoint before retrying.`,
      )
    }
    if (files.find((file) => file.name === attempt.name)?.hash !== attempt.hash) {
      throw new Error(`Previously attempted migration ${attempt.name} has changed. Stop and inspect.`)
    }
  }
}

export const prepareMigrations = <R>(files: readonly MigrationFile[], store: MigrationStore<R>) =>
  Effect.gen(function* () {
    const ledger = yield* store.ledger
    verifyAttempts(files, ledger, yield* store.attempts)
    const pending = pendingMigrations(files, ledger)
    const bookmark = pending.length ? yield* store.checkpoint : null
    if (pending.length && !bookmark)
      return yield* Effect.fail(new Error('A D1 Time Travel recovery checkpoint is required.'))
    return { ledger, bookmark, createdAt: Date.now() } satisfies Checkpoint
  })

export const applyMigrations = <R>(files: readonly MigrationFile[], checkpoint: Checkpoint, store: MigrationStore<R>) =>
  Effect.gen(function* () {
    let ledger = yield* store.ledger
    verifyAttempts(files, ledger, yield* store.attempts)
    if (JSON.stringify(ledger) !== JSON.stringify(checkpoint.ledger)) {
      return yield* Effect.fail(new Error('Migration history changed after the recovery checkpoint. Stop and inspect.'))
    }
    const pending = pendingMigrations(files, ledger)
    if (pending.length && Date.now() - checkpoint.createdAt > 24 * 60 * 60 * 1000) {
      return yield* Effect.fail(
        new Error('The migration checkpoint is older than 24 hours. Obtain a fresh reviewed checkpoint.'),
      )
    }
    if (pending.length && !checkpoint.bookmark) {
      return yield* Effect.fail(new Error('A persisted pre-migration recovery checkpoint is required.'))
    }
    for (const migration of pending) {
      // Persist intent before SQL. A later deploy must not replay a write whose
      // response was lost, even when Alchemy retries an unfinished Action.
      yield* store.begin(migration)
      yield* store.apply(migration).pipe(
        Effect.mapError(
          (cause) =>
            new Error(`Migration ${migration.name} failed. Inspect D1 and the saved checkpoint before retrying.`, {
              cause,
            }),
        ),
      )
      const next = yield* store.ledger
      if (
        next.length !== ledger.length + 1 ||
        next.at(-1)?.name !== migration.name ||
        JSON.stringify(next.slice(0, ledger.length)) !== JSON.stringify(ledger)
      ) {
        return yield* Effect.fail(
          new Error(`Migration ${migration.name} history verification failed. Stop and inspect.`),
        )
      }
      ledger = next
    }
  })

function cloudStore({
  accountId,
  databaseId,
}: MigrationInput): MigrationStore<Effect.Services<ReturnType<typeof d1.queryDatabase>>> {
  const target = { accountId, databaseId }
  const confirmed = (reply: d1.QueryDatabaseResponse) =>
    reply.result.length && reply.result.every((result) => result.success === true)
      ? Effect.void
      : Effect.fail(new Error('D1 did not confirm every migration statement.'))
  return {
    attempts: d1
      .queryDatabase({
        ...target,
        sql: "SELECT name FROM sqlite_schema WHERE type='table' AND name='__projektor_migration_attempts'",
      })
      .pipe(
        Effect.flatMap((reply) =>
          Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ name: Schema.String })))(reply.result[0]?.results),
        ),
        Effect.flatMap((tables) =>
          tables.length
            ? d1
                .queryDatabase({
                  ...target,
                  sql: 'SELECT name, hash FROM __projektor_migration_attempts ORDER BY name',
                })
                .pipe(Effect.flatMap((reply) => Schema.decodeUnknownEffect(AttemptsSchema)(reply.result[0]?.results)))
            : Effect.succeed([]),
        ),
      ),
    begin: (migration) =>
      Effect.gen(function* () {
        yield* d1
          .queryDatabase({
            ...target,
            sql: 'CREATE TABLE IF NOT EXISTS __projektor_migration_attempts(name TEXT PRIMARY KEY, hash TEXT NOT NULL)',
          })
          .pipe(Retry.none, Effect.flatMap(confirmed))
        yield* d1
          .queryDatabase({
            ...target,
            sql: 'INSERT INTO __projektor_migration_attempts(name, hash) VALUES (?, ?)',
            params: [migration.name, migration.hash],
          })
          .pipe(Retry.none, Effect.flatMap(confirmed))
      }),
    ledger: d1
      .queryDatabase({ ...target, sql: 'SELECT id, name, applied_at FROM d1_migrations ORDER BY id' })
      .pipe(Effect.flatMap((reply) => Schema.decodeUnknownEffect(LedgerSchema)(reply.result[0]?.results))),
    checkpoint: d1
      .getBookmarkDatabaseTimeTravel(target)
      .pipe(
        Effect.flatMap((reply) =>
          reply.bookmark ? Effect.succeed(reply.bookmark) : Effect.fail(new Error('D1 returned no recovery bookmark.')),
        ),
      ),
    // Match the official Alchemy D1 executor's single multi-statement request.
    // HTTP transport does not prove rollback atomicity. Never retry an ambiguous write.
    apply: (migration) =>
      d1
        .queryDatabase({
          ...target,
          sql: `${migration.sql}\n;\nINSERT INTO d1_migrations(name) VALUES ('${migration.name}');`,
        })
        .pipe(Retry.none, Effect.flatMap(confirmed)),
  }
}

// Separate Actions persist the recovery checkpoint in encrypted Alchemy state
// before any SQL write, including when the subsequent migration Action fails.
const Prepare = Action('projektor/PrepareDatabaseMigrations', (input: MigrationInput) =>
  prepareMigrations(input.files, cloudStore(input)),
)
const Apply = Action('projektor/ApplyDatabaseMigrations', (input: MigrationInput & { checkpoint: Checkpoint }) =>
  applyMigrations(input.files, input.checkpoint, cloudStore(input)).pipe(
    Effect.as({ environment: 'production' as const }),
  ),
)

/** Registration is read-only. Only Alchemy apply executes the Action bodies. */
export const productionMigrations = Effect.gen(function* () {
  const files = yield* readFlatRecords('./migrations').pipe(Effect.orDie)
  const environment = yield* CloudflareEnvironment
  const { accountId } = yield* environment
  const input = { accountId, databaseId: deployment.storage.database.id, files }
  const checkpoint = yield* Prepare('DatabaseMigrationCheckpoint', input)
  return yield* Apply('DatabaseMigrations', { ...input, checkpoint })
})
