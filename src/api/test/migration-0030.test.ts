import { String } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { currentEpochSeconds } from '#contracts/time.ts'
import m0030 from '#migrations/0030_backfill_review_timestamp.sql?raw'

import { env } from './fixture-api.ts'
import { seedIssue, seedProject, seedUser, seedWorkspace } from './helpers.ts'

/*
 * PROJ-328: 0030 backfills in_review_at (added by 0029) for issues that were already
 * sitting in a review status before 0029 landed — see the migration file for why it's
 * deliberately narrower than 0026's claimed_at/ready_at backfill.
 */

const splitStatements = function splitStatements(sql: string): string[] {
  return sql
    .replaceAll(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => String.isNonEmpty(statement))
}

const runMigration0030 = async function runMigration0030(): Promise<void> {
  for (const stmt of splitStatements(m0030)) {
    await env.DB.prepare(stmt).run()
  }
}

describe('0030 backfill in_review_at', () => {
  type TestData = Readonly<{
    projectId: string
    userId: string
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const ws = await seedWorkspace()
    const user = await seedUser(`u-${crypto.randomUUID().slice(0, 8)}@example.com`)
    const project = await seedProject(ws.id)
    const workspaceId = ws.id
    const projectId = project.id
    const userId = user.id
    return { projectId, userId, workspaceId }
  }

  test('backfills in_review_at from claimed_at for an issue currently in a review status', async () => {
    const { projectId, userId, workspaceId } = await seedTestData()
    const now = currentEpochSeconds()
    const issue = await seedIssue(workspaceId, projectId, userId, {
      status: 'in_review',
      title: 'In review',
    })
    await env.DB.prepare('UPDATE issues SET claimed_at = ? WHERE id = ?')
      .bind(now - 100, issue.id)
      .run()

    await runMigration0030()

    const row = await env.DB.prepare('SELECT in_review_at FROM issues WHERE id = ?')
      .bind(issue.id)
      .first<{ in_review_at: number | null }>()
    expect(row?.in_review_at).toBe(now - 100)
  })

  test('does not backfill a done issue that never carried a review status (no signal to guess from)', async () => {
    const { projectId, userId, workspaceId } = await seedTestData()
    const now = currentEpochSeconds()
    const issue = await seedIssue(workspaceId, projectId, userId, {
      status: 'done',
      title: 'Closed without review',
    })
    await env.DB.prepare('UPDATE issues SET claimed_at = ?, done_at = ? WHERE id = ?')
      .bind(now - 200, now, issue.id)
      .run()

    await runMigration0030()

    const row = await env.DB.prepare('SELECT in_review_at FROM issues WHERE id = ?')
      .bind(issue.id)
      .first<{ in_review_at: number | null }>()
    expect(row?.in_review_at).toBeNull()
  })

  test('does not overwrite an already-stamped in_review_at', async () => {
    const { projectId, userId, workspaceId } = await seedTestData()
    const now = currentEpochSeconds()
    const issue = await seedIssue(workspaceId, projectId, userId, {
      status: 'in_review',
      title: 'Already stamped',
    })
    await env.DB.prepare('UPDATE issues SET claimed_at = ?, in_review_at = ? WHERE id = ?')
      .bind(now - 300, now - 50, issue.id)
      .run()

    await runMigration0030()

    const row = await env.DB.prepare('SELECT in_review_at FROM issues WHERE id = ?')
      .bind(issue.id)
      .first<{ in_review_at: number | null }>()
    expect(row?.in_review_at).toBe(now - 50)
  })

  test('is idempotent — re-running changes nothing', async () => {
    const { projectId, userId, workspaceId } = await seedTestData()
    const now = currentEpochSeconds()
    const issue = await seedIssue(workspaceId, projectId, userId, {
      status: 'in_review',
      title: 'In review',
    })
    await env.DB.prepare('UPDATE issues SET claimed_at = ? WHERE id = ?')
      .bind(now - 100, issue.id)
      .run()

    await runMigration0030()
    await runMigration0030()

    const row = await env.DB.prepare('SELECT in_review_at FROM issues WHERE id = ?')
      .bind(issue.id)
      .first<{ in_review_at: number | null }>()
    expect(row?.in_review_at).toBe(now - 100)
  })
})
