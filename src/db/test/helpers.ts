import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { String, Iterable } from 'effect'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations')

/*
 * Mirrors src/api/test/migrations.ts's statement splitting: DatabaseSync.exec()
 * runs one statement at a time, and comments/semicolons in Drizzle's SQL output would
 * otherwise produce spurious empty fragments.
 */
const splitStatements = function splitStatements(sql: string): string[] {
  return sql
    .replaceAll(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => String.isNonEmpty(statement))
}

export const loadMigrations = function loadMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .toSorted()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
}

/**
 * A fresh in-memory SQLite DB with every migration applied in order, FK enforcement on.
 *
 * @returns {DatabaseSync} The open SQLite database. The caller closes it.
 */
export const migratedDb = function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  Iterable.forEach(loadMigrations(), (sql): void => {
    Iterable.forEach(splitStatements(sql), (stmt) => {
      /*
       * Node:sqlite's bundled build doesn't consistently ship the fts5 module
       * across Node patch versions; production D1/Cloudflare sqlite does.
       * Skip fts5-dependent statements here rather than gate tests on it.
       */
      if (/\bfts5\b/i.test(stmt) || /\b(issues|wiki)_fts\b/i.test(stmt)) {
        return
      }
      db.exec(stmt)
    })
  })
  return db
}
