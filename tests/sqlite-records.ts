import { Predicate } from 'effect'

type SqliteRecord = Record<string, unknown>

const copySqliteRecord = function copySqliteRecord(row: SqliteRecord): SqliteRecord {
  return { ...row }
}

export const sqliteRowFields = function sqliteRowFields(row: SqliteRecord | undefined): SqliteRecord | undefined {
  return Predicate.isNullish(row) ? undefined : copySqliteRecord(row)
}

export const sqliteRowsFields = function sqliteRowsFields(rows: Readonly<SqliteRecord[]>): SqliteRecord[] {
  return rows.map((row) => copySqliteRecord(row))
}
