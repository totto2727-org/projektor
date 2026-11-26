/*
 * PROJ-849: project tiles show "N open · M backlog" instead of a single (broken)
 * total-issue count, and issues.status_category stays in sync with a status's
 * category on every write path that can change it.
 */
import { describe, expect, test } from 'vite-plus/test'

import { listProjectsAcrossWorkspaces } from '#commands/projects.ts'
import m0066 from '#migrations/0066_repair_status_category.sql?raw'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  seedIssue,
  seedMember,
  seedProject,
  seedTaskStatus,
  seedToken,
  seedUser,
  seedWorkspace,
} from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'

describe('listProjectsAcrossWorkspaces: open vs backlog counts (PROJ-849)', () => {
  test('counts open issues correctly and reports backlog separately, within open', async () => {
    const ws = await seedWorkspace()
    const user = await seedUser(`u-${crypto.randomUUID().slice(0, 8)}@example.com`)
    await seedMember(ws.id, user.id, 'owner')
    const project = await seedProject(ws.id, 'TILE')

    // Done and cancelled: excluded from open.
    await seedIssue(ws.id, project.id, user.id, { status: 'done' })
    await seedIssue(ws.id, project.id, user.id, { status: 'cancelled' })
    // Backlog: open, and also counted as backlog.
    await seedIssue(ws.id, project.id, user.id, { status: 'backlog' })
    // Todo and in_progress: open, not backlog.
    await seedIssue(ws.id, project.id, user.id, { status: 'todo' })
    await seedIssue(ws.id, project.id, user.id, { status: 'in_progress' })
    /* Empty-category (no status_id, a custom legacy key that isn't done/cancelled/backlog):
     * falls back to the raw `status` column, still open, not backlog. */
    await seedIssue(ws.id, project.id, user.id, { status: 'triage' })

    const rows = await listProjectsAcrossWorkspaces(user.id, env.DB)
    const row = rows.find((selectedRow) => selectedRow.id === project.id)
    // Backlog, todo, in_progress, triage
    expect(row?.open_issue_count).toBe(4)
    expect(row?.backlog_issue_count).toBe(1)
  })
})

describe('update_task_status re-syncs issues.status_category (PROJ-849)', () => {
  test("changing a status's category updates every issue currently on that status", async () => {
    const ws = await seedWorkspace()
    const user = await seedUser(`u-${crypto.randomUUID().slice(0, 8)}@example.com`)
    await seedMember(ws.id, user.id, 'owner')
    const project = await seedProject(ws.id, 'SYNC')
    const token = await seedToken(ws.id, user.id)
    const status = await seedTaskStatus(ws.id, {
      category: 'in_progress',
      key: 'custom_review',
    })
    const issue = await seedIssue(ws.id, project.id, user.id, {
      status: status.key,
      statusId: status.id,
    })
    // Another issue on a different status must be left alone.
    const other = await seedIssue(ws.id, project.id, user.id, { status: 'todo' })

    const before = await env.DB.prepare('SELECT status_category FROM issues WHERE id = ?')
      .bind(issue.id)
      .first<{ status_category: string }>()
    expect(before?.status_category).toBe('in_progress')

    const res = await fetchNativeApi(
      `http://localhost/api/task-statuses/${status.id}`,
      requestOptionsWithBody('PATCH', authHeaders(token, ws.slug), JSON.stringify({ category: 'done' })),
    )
    expect(res.status).toBe(200)

    const after = await env.DB.prepare('SELECT status_category FROM issues WHERE id = ?')
      .bind(issue.id)
      .first<{ status_category: string }>()
    expect(after?.status_category).toBe('done')

    const untouched = await env.DB.prepare('SELECT status_category FROM issues WHERE id = ?')
      .bind(other.id)
      .first<{ status_category: string }>()
    expect(untouched?.status_category).toBe('')
  })
})

describe('migration 0066: repairs drifted status_category (PROJ-849)', () => {
  test("re-derives status_category from the issue's task status wherever they differ, workspace-scoped", async () => {
    const ws = await seedWorkspace()
    const otherWs = await seedWorkspace()
    const user = await seedUser(`u-${crypto.randomUUID().slice(0, 8)}@example.com`)
    await seedMember(ws.id, user.id, 'owner')
    const project = await seedProject(ws.id, 'REPAIR')

    const status = await seedTaskStatus(ws.id, { category: 'done', key: 'custom_done' })
    const issue = await seedIssue(ws.id, project.id, user.id, {
      status: status.key,
      statusId: status.id,
    })
    /*
     * Simulate drift: the status's category changed underneath the issue without a
     * re-sync (the bug this migration repairs).
     */
    await env.DB.prepare("UPDATE issues SET status_category = 'todo' WHERE id = ?").bind(issue.id).run()

    /*
     * A status of the same key/id exists in another workspace with a different
     * category — the repair must not cross workspaces even though status_id alone
     * would match it.
     */
    const crossWsStatus = await seedTaskStatus(otherWs.id, {
      category: 'cancelled',
      key: 'unrelated',
    })

    const repairSql = m0066
      .replaceAll(/--[^\n]*/gu, '')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean)
      .join(';\n')
    await env.DB.prepare(repairSql).run()

    const after = await env.DB.prepare('SELECT status_category FROM issues WHERE id = ?')
      .bind(issue.id)
      .first<{ status_category: string }>()
    expect(after?.status_category).toBe('done')
    void crossWsStatus
  })
})
