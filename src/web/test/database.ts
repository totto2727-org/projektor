import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { SQLInputValue } from "node:sqlite";
import { migratedDb } from "#db/test/helpers";

/** Real migrated SQLite schema behind the D1 query interface, for domain tests only. */
export function createTestDatabase() {
	const sqlite = migratedDb();
	function prepare(query: string, values: SQLInputValue[] = []): D1PreparedStatement {
		return {
			bind: (...parameters: unknown[]) => prepare(query, parameters as SQLInputValue[]),
			all: async () => ({ success: true, results: sqlite.prepare(query).all(...values), meta: {} }),
			raw: async () => {
				const statement = sqlite.prepare(query);
				statement.setReturnArrays(true);
				return statement.all(...values);
			},
			first: async (column?: string) => {
				const row = sqlite.prepare(query).get(...values);
				return column ? (row?.[column] ?? null) : (row ?? null);
			},
			run: async () => {
				const result = sqlite.prepare(query).run(...values);
				return { success: true, results: [], meta: { changes: Number(result.changes) } };
			},
		} as unknown as D1PreparedStatement;
	}
	const db = {
		prepare,
		batch: async (statements: D1PreparedStatement[]) =>
			Promise.all(statements.map((statement) => statement.all())),
	} as unknown as D1Database;
	return { db, sqlite, close: () => sqlite.close() };
}
