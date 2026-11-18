import { DatabaseSync } from 'node:sqlite'

import { NodeServices } from '@effect/platform-node'
import { readFlatRecords, type MigrationRecord } from 'alchemy/SQL/Migrations/index'
import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { applyMigrations, pendingMigrations, type MigrationQuery } from './deployment-migrations'

const files = await Effect.runPromise(readFlatRecords('./migrations').pipe(Effect.provide(NodeServices.layer)))
const file = (name: string, sql: string): MigrationRecord => ({
  name,
  sql,
  hash: sql,
  statements: [sql],
  createdAtMillis: undefined,
})

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(
    'PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  )
  for (const migration of files.filter((migration) => migration.name.slice(0, 4) <= '0067')) {
    db.exec(migration.sql)
    db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(migration.name)
  }
  db.exec(`INSERT INTO users(id,email,name,created_at) VALUES ('u','migration@example.test','User',1);
    INSERT INTO workspaces(id,name,slug,created_at) VALUES ('w','Workspace','workspace',1);
    INSERT INTO attachments(id,workspace_id,kind,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at)
    VALUES ('a','w','file','w/a','a.txt','text/plain',4,'issue','i','u',1)`)
  const history = () => db.prepare('SELECT id,name,applied_at FROM d1_migrations ORDER BY id').all()
  const queries: string[] = []
  let loseResponse = false
  const query: MigrationQuery = ({ sql, params }) =>
    Effect.try(() => {
      if (!sql) throw new Error('Missing SQL')
      queries.push(sql)
      if (sql.startsWith('SELECT ')) return { result: [{ success: true, results: db.prepare(sql).all() }] }
      if (params) db.prepare(sql).run(...Schema.decodeUnknownSync(Schema.Array(Schema.String))(params))
      else db.exec(sql)
      if (loseResponse && sql.includes('INSERT INTO d1_migrations')) {
        loseResponse = false
        throw new Error('response lost after committed SQL')
      }
      return { result: [{ success: true, results: [] }] }
    })
  const migrate = (migrations = files) => Effect.runPromise(applyMigrations(migrations, query))
  const writes = () => queries.filter((sql) => sql.includes('INSERT INTO d1_migrations')).length
  return {
    db,
    query,
    queries,
    history,
    migrate,
    writes,
    loseNextResponse: () => {
      loseResponse = true
    },
    close: () => db.close(),
  }
}

describe('single-Action production migrations using Alchemy SQL records and the D1 query contract', () => {
  it('applies actual 0068/0069 once and preserves populated data and every existing ledger row', async () => {
    const f = fixture()
    try {
      const before = f.history()
      const attachment = f.db.prepare('SELECT * FROM attachments').get()
      await f.migrate()
      expect(f.writes()).toBe(2)
      expect(f.history().slice(0, before.length)).toEqual(before)
      expect(
        f
          .history()
          .slice(before.length)
          .map((row) => row.name),
      ).toEqual(['0068_wiki_draft_heads.sql', '0069_attachment_review_status.sql'])
      expect(f.db.prepare('SELECT * FROM attachments').get()).toEqual({ ...attachment, review_status: null })
      expect(f.db.prepare('SELECT * FROM wiki_draft_heads').all()).toEqual([])
      expect(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='__alchemy_migrations'").all()).toEqual([])
      const queryCount = f.queries.length
      await f.migrate()
      expect(f.queries.slice(queryCount)).toEqual(['SELECT name FROM d1_migrations ORDER BY id'])
      expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(f.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    } finally {
      f.close()
    }
  })

  it('fills the known independent 0068 gap without replaying incident-applied 0069', async () => {
    const f = fixture()
    try {
      const migration = files.find((migration) => migration.name.startsWith('0069_'))!
      f.db.exec(migration.sql)
      f.db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(migration.name)
      const before = f.history()
      await f.migrate()
      expect(f.writes()).toBe(1)
      expect(f.history().slice(0, before.length)).toEqual(before)
      expect(f.history().at(-1)?.name).toBe('0068_wiki_draft_heads.sql')
    } finally {
      f.close()
    }
  })

  it('blocks incomplete legacy history, unknown rows, duplicate names and unreviewed gaps before writes', async () => {
    const f = fixture()
    try {
      expect(() => pendingMigrations([], [])).toThrow(/inconsistent/)
      expect(() => pendingMigrations([...files, files[0]!], [])).toThrow(/inconsistent/)
      const invalid = [
        f
          .history()
          .filter((row) => !String(row.name).startsWith('0060_'))
          .map((row) => ({ name: String(row.name) })),
        [...f.history().map((row) => ({ name: String(row.name) })), { name: 'missing.sql' }],
      ]
      for (const ledger of invalid) expect(() => pendingMigrations(files, ledger)).toThrow()
      f.db
        .prepare('DELETE FROM d1_migrations WHERE name=?')
        .run(files.find((migration) => migration.name.startsWith('0060_'))!.name)
      await expect(f.migrate()).rejects.toThrow(/offline reviewed upgrade/)
      expect(f.queries).toEqual(['SELECT name FROM d1_migrations ORDER BY id'])
    } finally {
      f.close()
    }
    const g = fixture()
    try {
      await g.migrate()
      const later = file('0070_later.sql', 'CREATE TABLE later(id);')
      await g.migrate([...files, later])
      await expect(g.migrate([...files, file('0069_z_skipped.sql', 'SELECT 1;'), later])).rejects.toThrow(
        /precede applied history/,
      )
      expect(g.writes()).toBe(3)
    } finally {
      g.close()
    }
  })

  it('does not resend a failed or partially applied migration and never advances to the next file', async () => {
    for (const sql of [
      'SELECT * FROM missing_table;',
      'CREATE TABLE partial_write(id); SELECT * FROM missing_table;',
    ]) {
      const f = fixture()
      try {
        await f.migrate()
        const before = f.history()
        const failed = file('0070_failure.sql', sql)
        const never = file('0071_never.sql', 'CREATE TABLE never_applied(id);')
        await expect(f.migrate([...files, failed, never])).rejects.toThrow(/0070_failure.sql failed/)
        expect(f.history()).toEqual(before)
        expect(f.writes()).toBe(3)
        await expect(f.migrate([...files, failed, never])).rejects.toThrow(/unconfirmed earlier attempt/)
        expect(f.writes()).toBe(3)
        expect(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='never_applied'").all()).toEqual([])
        expect(
          f.db.prepare('SELECT name,hash FROM __projektor_migration_attempts WHERE name=?').get(failed.name),
        ).toEqual({ name: failed.name, hash: failed.hash })
      } finally {
        f.close()
      }
    }
  })

  it('skips a completed migration after a lost response and resumes only genuinely pending files', async () => {
    const f = fixture()
    try {
      f.loseNextResponse()
      await expect(f.migrate()).rejects.toThrow(/0068_wiki_draft_heads.sql failed/)
      expect(f.history().at(-1)?.name).toBe('0068_wiki_draft_heads.sql')
      await f.migrate()
      expect(f.writes()).toBe(2)
      expect(f.history().at(-1)?.name).toBe('0069_attachment_review_status.sql')
    } finally {
      f.close()
    }
  })

  it('rejects empty, unsuccessful and malformed ledger replies before sending any mutation', async () => {
    for (const reply of [
      { result: [] },
      { result: [{ success: false, results: [] }] },
      { result: [{ success: true, results: [{ unexpected: 'row' }] }] },
    ]) {
      let calls = 0
      await expect(
        Effect.runPromise(
          applyMigrations(files, () =>
            Effect.sync(() => {
              calls++
              return reply
            }),
          ),
        ),
      ).rejects.toThrow()
      expect(calls).toBe(1)
    }
  })

  it('does not send migration SQL if the separate marker request is unconfirmed', async () => {
    const f = fixture()
    try {
      await expect(
        Effect.runPromise(
          applyMigrations(files, (request) =>
            request.sql?.startsWith('INSERT INTO __projektor_migration_attempts')
              ? Effect.succeed({ result: [{ success: false }] })
              : f.query(request),
          ),
        ),
      ).rejects.toThrow(/Cannot start migration/)
      expect(f.writes()).toBe(0)
      expect(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='wiki_draft_heads'").all()).toEqual([])
    } finally {
      f.close()
    }
  })

  it('keeps the ledger insert outside a trailing SQL comment and supports statement breakpoints', async () => {
    const f = fixture()
    try {
      await f.migrate()
      const migration = file(
        '0070_comments.sql',
        'CREATE TABLE comment_boundary(id) -- trailing comment\n;\n--> statement-breakpoint\nINSERT INTO comment_boundary VALUES (1); -- second comment',
      )
      await f.migrate([...files, migration])
      expect(f.history().at(-1)?.name).toBe(migration.name)
      expect(f.db.prepare('SELECT * FROM comment_boundary').all()).toEqual([{ id: 1 }])
    } finally {
      f.close()
    }
  })
})
