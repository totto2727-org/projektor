import type { SQLInputValue } from 'node:sqlite'

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { String, Predicate } from 'effect'

import { migratedDb } from '#db/test/helpers.ts'

/**
 * Real migrated SQLite schema behind the D1 query interface, for domain tests only.
 *
 * @returns {{ db: D1Database; sqlite: DatabaseSync; close: () => void }} The D1 adapter, the SQLite database, and the function to close the database.
 */
export const createTestDatabase = function createTestDatabase() {
  const sqlite = migratedDb()
  const prepare = function prepare(query: string, values: SQLInputValue[] = []): D1PreparedStatement {
    return {
      bind: (...parameters: unknown[]) => prepare(query, parameters as SQLInputValue[]),
      all: async () => ({ success: true, results: sqlite.prepare(query).all(...values), meta: {} }),
      raw: async () => {
        const statement = sqlite.prepare(query)
        statement.setReturnArrays(true)
        return statement.all(...values)
      },
      first: async (column?: string) => {
        const row = sqlite.prepare(query).get(...values)
        return Predicate.isNotNullish(column) && String.isNonEmpty(column) ? (row?.[column] ?? null) : (row ?? null)
      },
      run: async () => {
        const result = sqlite.prepare(query).run(...values)
        return { success: true, results: [], meta: { changes: Number(result.changes) } }
      },
    } as unknown as D1PreparedStatement
  }
  const db = {
    prepare,
    batch: async (statements: D1PreparedStatement[]) => Promise.all(statements.map((statement) => statement.all())),
  } as unknown as D1Database
  return { db, sqlite, close: () => sqlite.close() }
}
