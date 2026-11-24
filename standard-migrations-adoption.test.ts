import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { NodeServices } from '@effect/platform-node'
import { inlineSqlParams, MigrationError, runMigrations } from 'alchemy/SQL/Migrations/index'
import type { SqlExecutor } from 'alchemy/SQL/Migrations/index'
import { Effect } from 'effect'
import { expect, test } from 'vite-plus/test'

import { runTestEffect } from '#tests/run-effect.ts'

const directory = new URL('./migrations/', import.meta.url)
const pending = '0068_wiki_draft_heads.sql'
const alreadyApplied = '0069_attachment_review_status.sql'

test.each([
  { description: 'adopts Wrangler history and fills the 0068 gap', unknown: false },
  { description: 'rejects an unknown Wrangler filename without writing', unknown: true },
])('$description', async ({ unknown }) => {
  using db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);
  `)
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.sql') && name <= alreadyApplied)
    .sort()
  const insertApplied = db.prepare('INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)')
  const hashes = new Map<string, string>()
  for (const name of files) {
    const sql = readFileSync(new URL(name, directory), 'utf8')
    hashes.set(name, createHash('sha256').update(sql).digest('hex'))
    if (name === pending) {
      continue
    }
    db.exec(sql)
    insertApplied.run(name, '2026-11-19 00:00:00')
  }
  const unknownName = 'unrecognized_fixture_migration.sql'
  if (unknown) {
    insertApplied.run(unknownName, '2026-11-19 00:00:00')
  }
  db.exec(`
    INSERT INTO users(id, email, name, created_at) VALUES ('fixture', 'fixture@example.test', 'Fixture', 123);
    INSERT INTO workspaces(id, name, slug, created_at) VALUES ('workspace', 'Workspace', 'fixture-workspace', 123);
    INSERT INTO attachments(id, workspace_id, r2_key, filename, content_type, size, entity_type, entity_id, created_by_id, created_at, kind, review_status)
    VALUES ('attachment', 'workspace', 'fixture-key', 'notes.txt', 'text/plain', 7, 'issue', 'issue', 'fixture', 123, 'file', 'in_review');
  `)

  const originals = () => db.prepare('SELECT id, name, applied_at FROM d1_migrations ORDER BY id').all()
  const ledger = () => db.prepare('SELECT id, name, hash, applied_at FROM __alchemy_migrations ORDER BY id').all()
  const users = () => db.prepare('SELECT * FROM users ORDER BY id').all()
  const attachments = () => db.prepare('SELECT * FROM attachments ORDER BY id').all()
  const checkIntegrity = (): void => {
    expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  }
  const draftHeads = () =>
    db
      .prepare('PRAGMA table_info(wiki_draft_heads)')
      .all()
      .map(({ name }) => name)
  const initialHistory = originals()
  const initialUsers = users()
  const initialAttachments = attachments()
  expect(initialAttachments).toMatchObject([{ id: 'attachment', review_status: 'in_review' }])
  expect(initialHistory.at(-1)?.name).toBe(unknown ? unknownName : alreadyApplied)
  expect(initialHistory.map(({ name }) => name)).not.toContain(pending)
  expect(draftHeads()).toEqual([])

  const execute = <A>(sql: string, body: () => A): Effect.Effect<A, MigrationError, never> =>
    Effect.try({ catch: (cause) => new MigrationError({ message: `SQLite fixture failed: ${sql}`, cause }), try: body })
  const executor: SqlExecutor = {
    dialect: 'sqlite',
    query: (sql, params) => execute(sql, () => db.prepare(inlineSqlParams(sql, params ?? [], 'sqlite')).all()),
    batch: (statements) => {
      const sql = statements.map((statement) => `${statement}\n;`).join('\n')
      return execute(sql, () => db.exec(sql))
    },
  }
  const run = (stamped: { table?: string }) =>
    runTestEffect(
      runMigrations({
        input: { dir: fileURLToPath(directory) },
        stamped,
        withExecutor: (apply) => apply(executor),
      }).pipe(Effect.provide(NodeServices.layer)),
    )
  if (unknown) {
    await expect(run({})).rejects.toMatchObject({
      _tag: 'MigrationHistoryConflictError',
      table: 'd1_migrations',
      unmatched: [unknownName],
    })
    expect(draftHeads()).toEqual([])
    expect(db.prepare('PRAGMA table_info(__alchemy_migrations)').all()).toEqual([])
    expect(originals()).toEqual(initialHistory)
    expect(users()).toEqual(initialUsers)
    expect(attachments()).toEqual(initialAttachments)
    checkIntegrity()
    return
  }

  const first = await run({})
  expect(first.resolved.table).toBe('__alchemy_migrations')
  expect(originals()).toEqual(initialHistory)
  expect(users()).toEqual(initialUsers)
  expect(attachments()).toEqual(initialAttachments)
  checkIntegrity()
  expect(draftHeads()).toEqual(['workspace_id', 'user_id', 'page_id', 'revision'])
  const adopted = ledger()
  expect(adopted.map(({ name, hash, applied_at }) => ({ name, hash, applied_at }))).toEqual([
    ...initialHistory.map(({ name, applied_at }) => ({ name, hash: hashes.get(String(name)), applied_at })),
    { name: pending, hash: hashes.get(pending), applied_at: expect.any(String) },
  ])

  await expect(run({ table: first.resolved.table })).resolves.toEqual(first)
  expect(ledger()).toEqual(adopted)
  expect(originals()).toEqual(initialHistory)
  expect(users()).toEqual(initialUsers)
  expect(attachments()).toEqual(initialAttachments)
  checkIntegrity()
})
