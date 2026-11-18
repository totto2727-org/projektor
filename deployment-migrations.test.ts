import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import {
  applyMigrations,
  type MigrationFile,
  type MigrationStore,
  pendingMigrations,
  prepareMigrations,
} from './deployment-migrations'

const files: MigrationFile[] = readdirSync(new URL('./migrations/', import.meta.url))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => {
    const sql = readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8')
    return { name, sql, hash: createHash('sha256').update(sql).digest('hex') }
  })

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(
    'PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  )
  for (const file of files.filter((file) => file.name.slice(0, 4) <= '0067')) {
    db.exec(file.sql)
    db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(file.name)
  }
  db.exec(`INSERT INTO users(id,email,name,created_at) VALUES ('u','migration@example.test','User',1);
    INSERT INTO workspaces(id,name,slug,created_at) VALUES ('w','Workspace','workspace',1);
    INSERT INTO attachments(id,workspace_id,kind,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at)
    VALUES ('a','w','file','w/a','a.txt','text/plain',4,'issue','i','u',1)`)
  const read = () =>
    db
      .prepare('SELECT id,name,applied_at FROM d1_migrations ORDER BY id')
      .all()
      .map((row) => ({ id: Number(row.id), name: String(row.name), applied_at: String(row.applied_at) }))
  let writes = 0
  const store: MigrationStore = {
    attempts: Effect.sync(() => {
      const exists = db.prepare("SELECT name FROM sqlite_schema WHERE name='__projektor_migration_attempts'").get()
      return exists
        ? db
            .prepare('SELECT name,hash FROM __projektor_migration_attempts ORDER BY name')
            .all()
            .map((row) => ({ name: String(row.name), hash: String(row.hash) }))
        : []
    }),
    begin: (file) =>
      Effect.try(() => {
        db.exec('CREATE TABLE IF NOT EXISTS __projektor_migration_attempts(name TEXT PRIMARY KEY, hash TEXT NOT NULL)')
        db.prepare('INSERT INTO __projektor_migration_attempts(name,hash) VALUES (?,?)').run(file.name, file.hash)
      }),
    ledger: Effect.sync(read),
    checkpoint: Effect.succeed('local-test-checkpoint'),
    apply: (file) =>
      Effect.try(() => {
        writes++
        db.exec(`${file.sql}\n;\nINSERT INTO d1_migrations(name) VALUES ('${file.name}');`)
      }),
  }
  return { db, store, read, writes: () => writes, close: () => db.close() }
}

async function migrate(store: MigrationStore, migrations = files) {
  const checkpoint = await Effect.runPromise(prepareMigrations(migrations, store))
  await Effect.runPromise(applyMigrations(migrations, checkpoint, store))
  return checkpoint
}

describe('production deployment migrations using the existing D1 ledger', () => {
  it('applies actual 0068/0069 SQL once to a populated 0067 database without converting history', async () => {
    const f = fixture()
    try {
      const history = f.read()
      const attachment = f.db.prepare('SELECT * FROM attachments').get()
      await migrate(f.store)
      expect(f.writes()).toBe(2)
      expect(f.read().slice(0, history.length)).toEqual(history)
      expect(
        f
          .read()
          .slice(history.length)
          .map((row) => row.name),
      ).toEqual(['0068_wiki_draft_heads.sql', '0069_attachment_review_status.sql'])
      expect(f.db.prepare('SELECT * FROM attachments').get()).toEqual({ ...attachment, review_status: null })
      expect(f.db.prepare('SELECT * FROM wiki_draft_heads').all()).toEqual([])
      expect(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='__alchemy_migrations'").all()).toEqual([])
      await migrate({ ...f.store, checkpoint: Effect.die('An up-to-date database must not create a checkpoint') })
      expect(f.writes()).toBe(2)
      expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(f.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    } finally {
      f.close()
    }
  })

  it('fills the real production 0068 gap without replaying already applied 0069', async () => {
    const f = fixture()
    try {
      const migration = files.find((file) => file.name.startsWith('0069_'))!
      await Effect.runPromise(f.store.apply(migration))
      const before = f.read()
      await migrate(f.store)
      expect(f.writes()).toBe(2)
      expect(f.read().slice(0, before.length)).toEqual(before)
      expect(f.read().at(-1)?.name).toBe('0068_wiki_draft_heads.sql')
    } finally {
      f.close()
    }
  })

  it('blocks an incomplete populated legacy upgrade before obtaining a checkpoint or writing', async () => {
    const f = fixture()
    try {
      f.db
        .prepare('DELETE FROM d1_migrations WHERE name=?')
        .run(files.find((file) => file.name.startsWith('0060_'))!.name)
      await expect(migrate({ ...f.store, checkpoint: Effect.die('Must not reach checkpoint') })).rejects.toThrow(
        /offline reviewed upgrade/,
      )
      expect(f.writes()).toBe(0)
    } finally {
      f.close()
    }
  })

  it('blocks writes when recovery is unavailable or the ledger changes after preparation', async () => {
    const f = fixture()
    try {
      await expect(
        migrate({ ...f.store, checkpoint: Effect.fail(new Error('Time Travel unavailable')) }),
      ).rejects.toThrow(/Time Travel unavailable/)
      await expect(migrate({ ...f.store, checkpoint: Effect.succeed('') })).rejects.toThrow(/checkpoint is required/)
      const checkpoint = await Effect.runPromise(prepareMigrations(files, f.store))
      await expect(
        Effect.runPromise(applyMigrations(files, { ...checkpoint, bookmark: null }, f.store)),
      ).rejects.toThrow(/persisted/)
      await expect(Effect.runPromise(applyMigrations(files, { ...checkpoint, createdAt: 0 }, f.store))).rejects.toThrow(
        /older than 24 hours/,
      )
      f.db.prepare('UPDATE d1_migrations SET applied_at=? WHERE id=1').run('changed')
      await expect(Effect.runPromise(applyMigrations(files, checkpoint, f.store))).rejects.toThrow(/history changed/)
      expect(f.writes()).toBe(0)
    } finally {
      f.close()
    }
  })

  it('stops on a SQL failure, does not record success or attempt a second migration', async () => {
    const f = fixture()
    try {
      await migrate(f.store)
      const history = f.read()
      const failed = { name: '0070_failure.sql', sql: 'SELECT * FROM missing_table;', hash: 'test' }
      const never = { name: '0071_not_attempted.sql', sql: 'CREATE TABLE not_attempted(id);', hash: 'test' }
      await expect(migrate(f.store, [...files, failed, never])).rejects.toThrow(/0070_failure.sql failed/)
      expect(f.writes()).toBe(3)
      expect(f.read()).toEqual(history)
      await expect(migrate(f.store, [...files, failed, never])).rejects.toThrow(/Unconfirmed migration attempt/)
      expect(f.writes()).toBe(3)
      expect(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='not_attempted'").all()).toEqual([])
    } finally {
      f.close()
    }
  })

  it('blocks a partial SQL write on later deployments instead of executing it again', async () => {
    const f = fixture()
    try {
      await migrate(f.store)
      const partial = {
        name: '0070_partial.sql',
        sql: 'CREATE TABLE partial_write(id); SELECT * FROM missing_table;',
        hash: 'test',
      }
      const migrations = [...files, partial]
      await expect(migrate(f.store, migrations)).rejects.toThrow(/0070_partial.sql failed/)
      expect(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='partial_write'").get()).toEqual({
        name: 'partial_write',
      })
      await expect(migrate(f.store, migrations)).rejects.toThrow(/Unconfirmed migration attempt/)
      expect(f.writes()).toBe(3)
      expect(f.read().some((row) => row.name === partial.name)).toBe(false)
    } finally {
      f.close()
    }
  })

  it('rejects unreviewed out-of-order gaps and changed previously attempted files', async () => {
    const f = fixture()
    try {
      await migrate(f.store)
      const later = { name: '0070_later.sql', sql: 'CREATE TABLE later(id);', hash: 'test' }
      const skipped = { name: '0069_z_skipped.sql', sql: 'CREATE TABLE skipped(id);', hash: 'test' }
      await migrate(f.store, [...files, later])
      await expect(migrate(f.store, [...files, skipped, later])).rejects.toThrow(/precede applied history/)
      const changed = files.map((file) => (file.name.startsWith('0068_') ? { ...file, hash: 'changed' } : file))
      await expect(migrate(f.store, [...changed, later])).rejects.toThrow(/has changed/)
      expect(f.writes()).toBe(3)
    } finally {
      f.close()
    }
  })

  it('rejects empty manifests, unexpected ledger entries and duplicate filenames', () => {
    const f = fixture()
    try {
      expect(() => pendingMigrations([], [])).toThrow(/inconsistent/)
      expect(() => pendingMigrations([...files, files[0]!], f.read())).toThrow(/inconsistent/)
      expect(() =>
        pendingMigrations(files, [...f.read(), { id: 999, name: 'missing.sql', applied_at: 'now' }]),
      ).toThrow(/inconsistent/)
    } finally {
      f.close()
    }
  })
})
