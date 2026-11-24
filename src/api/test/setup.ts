import { beforeAll, beforeEach } from 'vite-plus/test'

import { configureCore, env } from './fixture-api.ts'
import { MIGRATIONS } from './migrations.ts'
import { resetRateLimits } from './rate-limit-reset.ts'

/*
 * Strip line comments before splitting on ; — Drizzle breakpoints and any
 * semicolons inside comments (e.g. "ON CONFLICT; old windows are") would
 * otherwise produce spurious fragments. prepare().run() is used per statement
 * because Miniflare's exec() doesn't handle multi-statement SQL.
 */
const splitStatements = function splitStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

// Migrations run through the test-only Core fixture entrypoint. The actual public
// API Worker has no persistent storage bindings.
beforeAll(async () => {
  for (const sql of MIGRATIONS) {
    for (const stmt of splitStatements(sql)) {
      await env.DB.prepare(stmt).run()
    }
  }
})

// @cloudflare/vitest-pool-workers ≥0.13 isolates storage per *file*, not per
// *Test* (the old `isolatedStorage` per-test rollback was removed). The transient
// rate-limit counter therefore accumulates across tests in a file and trips the
// low test limits (AUTH_LIMIT=3). Reset it before each test so every test starts
// from a clean window — restoring the per-test freshness the old isolation gave.
beforeEach(async () => {
  await resetRateLimits()
  await configureCore()
})
