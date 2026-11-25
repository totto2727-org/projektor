import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { String, Predicate, Iterable } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { SQL_NULL } from '#db/sql-null.ts'

import { loadMigrations, migratedDb } from './helpers.ts'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations')

describe('migrations', () => {
  test('apply cleanly in order against a fresh database', () => {
    expect(() => migratedDb()).not.toThrow()
  })

  test('discovers every root migration file in filename order', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort()
    expect(files.length).toBeGreaterThan(0)
    expect(loadMigrations()).toStrictEqual(files.map((file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8')))
  })

  test('creates the core tables', () => {
    const db = migratedDb()
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    const tables = rows.map((row) => row.name)
    expect(tables).toStrictEqual(
      expect.arrayContaining(['workspaces', 'users', 'workspace_members', 'projects', 'issues']),
    )
  })
})

describe('schema constraints', () => {
  test('rejects a NULL in a NOT NULL column', () => {
    const db = migratedDb()
    expect(() =>
      db
        .prepare('INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
        .run('w1', SQL_NULL, 'acme', 0),
    ).toThrow()
  })

  test('rejects a duplicate value in a UNIQUE column (workspaces.slug)', () => {
    const db = migratedDb()
    db.prepare('INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)').run('w1', 'Acme', 'acme', 0)
    expect(() =>
      db
        .prepare('INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
        .run('w2', 'Acme Two', 'acme', 0),
    ).toThrow()
  })

  test('rejects a duplicate value in a UNIQUE column (users.email)', () => {
    const db = migratedDb()
    db.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run('u1', 'a@example.com', 'A', 0)
    expect(() =>
      db
        .prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
        .run('u2', 'a@example.com', 'A2', 0),
    ).toThrow()
  })

  test('rejects a foreign key violation (workspace_members.workspace_id -> workspaces)', () => {
    const db = migratedDb()
    db.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run('u1', 'a@example.com', 'A', 0)
    expect(() =>
      db
        .prepare('INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
        .run('no-such-workspace', 'u1', 'member', 0),
    ).toThrow()
  })

  test('cascades workspace deletion to its members', () => {
    const db = migratedDb()
    db.prepare('INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)').run('w1', 'Acme', 'acme', 0)
    db.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run('u1', 'a@example.com', 'A', 0)
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
      'w1',
      'u1',
      'member',
      0,
    )

    db.prepare('DELETE FROM workspaces WHERE id = ?').run('w1')

    const rows = db.prepare('SELECT * FROM workspace_members WHERE workspace_id = ?').all('w1')
    expect(rows).toHaveLength(0)
  })

  test('rejects a duplicate issue number within the same project (composite UNIQUE index)', () => {
    const db = migratedDb()
    db.prepare('INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)').run('w1', 'Acme', 'acme', 0)
    db.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run('u1', 'a@example.com', 'A', 0)
    db.prepare(
      'INSERT INTO projects (id, workspace_id, name, key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('p1', 'w1', 'Acme Project', 'ACME', 0, 0)
    db.prepare(
      `INSERT INTO issues (id, workspace_id, project_id, number, title, created_by_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('i1', 'w1', 'p1', 1, 'First issue', 'u1', 0, 0)

    expect(() =>
      db
        .prepare(
          `INSERT INTO issues (id, workspace_id, project_id, number, title, created_by_id, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('i2', 'w1', 'p1', 1, 'Duplicate number', 'u1', 0, 0),
    ).toThrow()
  })

  /*
   * PROJ-376: the 0035 backfill must not violate its own unique index when two
   * pre-existing projects in the same workspace slugify to the same value —
   * this previously aborted the whole migration on real data (opus review finding).
   */
  test('0035_project_slug backfill dedupes colliding slugs instead of aborting', () => {
    const migrationFiles = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort()
    const preSlugFiles = migrationFiles.filter((f) => f < '0035')
    const slugFile = migrationFiles.find((f) => f.startsWith('0035'))
    if (Predicate.isNullish(slugFile) || String.isEmpty(slugFile)) {
      throw new Error('expected a 0035 migration file')
    }

    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')
    const splitStatements = (sql: string): string[] =>
      sql
        .replaceAll(/--[^\n]*/g, '')
        .split(';')
        .map((statement) => statement.trim())
        .filter((statement) => String.isNonEmpty(statement))
    Iterable.forEach(preSlugFiles, (file): void => {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      Iterable.forEach(splitStatements(sql), (stmt) => {
        if (/\bfts5\b/i.test(stmt) || /\bissues_fts\b/i.test(stmt)) {
          return
        }
        db.exec(stmt)
      })
    })

    db.prepare('INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)').run('w1', 'Acme', 'acme', 0)
    // Two projects that slugify to the same base value ("start-line").
    db.prepare(
      'INSERT INTO projects (id, workspace_id, name, key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('p1', 'w1', 'Start Line', 'SL', 0, 0)
    db.prepare(
      'INSERT INTO projects (id, workspace_id, name, key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('p2', 'w1', 'Start_Line', 'SL2', 1, 1)

    const slugSql = readFileSync(join(MIGRATIONS_DIR, slugFile), 'utf8')
    expect(() => {
      Iterable.forEach(splitStatements(slugSql), (stmt) => {
        db.exec(stmt)
      })
    }).not.toThrow()

    const rows = db.prepare('SELECT id, slug FROM projects ORDER BY id').all() as {
      id: string
      slug: string
    }[]
    const slugs = rows.map((row) => row.slug)
    expect(new Set(slugs).size).toBe(2)
    expect(slugs).toContain('start-line')
    expect(slugs).toContain('start-line-2')
  })
})
