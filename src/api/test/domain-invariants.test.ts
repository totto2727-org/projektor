import { describe, expect, test, vi } from 'vite-plus/test'

import { addComment, deleteComment, updateComment } from '#commands/comments.ts'
import { listLinksForIssue } from '#commands/issue-links.ts'
import { deleteIssue } from '#commands/issues.ts'
import { updateTaskStatus } from '#commands/task-statuses.ts'
import { updateTaskType } from '#commands/task-types.ts'
import type { ServiceCtx } from '#commands/types.ts'
import { markWikiNotificationsRead } from '#commands/wiki-watchers.ts'

import { env } from './fixture-api.ts'
import { seedFixture, seedGroupGrant, seedIssue, seedProject, seedTaskStatus, seedTaskType } from './helpers.ts'

const fixture = async function fixture() {
  const testFixture = await seedFixture({ role: 'member' })
  const project = await seedProject(testFixture.workspace.id)
  const issue = await seedIssue(testFixture.workspace.id, project.id, testFixture.user.id)
  const ctx: ServiceCtx = {
    db: env.DB,
    kv: env.KV,
    r2: env.R2,
    workspaceId: testFixture.workspace.id,
    userId: testFixture.user.id,
    role: 'member',
  }
  return { ...testFixture, project, issue, ctx }
}

describe('native D1 domain invariants', () => {
  test('chunks issue storage cleanup at 1000 keys and continues after failure', async () => {
    const testFixture = await fixture()
    testFixture.ctx.role = 'owner'
    for (let offset = 0; offset < 1001; offset += 100) {
      const statements = Array.from({ length: Math.min(100, 1001 - offset) }, (_value, index) => {
        const id = crypto.randomUUID()
        return env.DB.prepare(`INSERT INTO attachments
          (id,workspace_id,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at)
          VALUES (?, ?, ?, 'file','text/plain',1,'issue', ?, ?, 1)`).bind(
          id,
          testFixture.workspace.id,
          `${testFixture.workspace.id}/key-${offset + index}`,
          testFixture.issue.id,
          testFixture.user.id,
        )
      })
      await env.DB.batch(statements)
    }
    const remove = vi.fn(async (_keys: string[]) => {})
    remove.mockRejectedValueOnce(new Error('storage outage'))
    testFixture.ctx.r2 = { delete: remove } as unknown as R2Bucket
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await deleteIssue(testFixture.ctx, testFixture.issue.id)
      expect(remove.mock.calls.map(([keys]) => keys.length)).toStrictEqual([1000, 1])
      expect(log).toHaveBeenCalledWith(
        'deleteIssue: R2 cleanup failed',
        expect.objectContaining({ r2Keys: expect.any(Array) }),
      )
      await expect(
        env.DB.prepare('SELECT id FROM issues WHERE id = ?').bind(testFixture.issue.id).first(),
      ).resolves.toBeNull()
    } finally {
      log.mockRestore()
    }
  })

  test('uses effective grants for author comment mutations and observes a downgrade immediately', async () => {
    const testFixture = await fixture()
    await seedGroupGrant(testFixture.workspace.id, testFixture.user.id, testFixture.project.id, 'member')
    testFixture.ctx.role = 'viewer'
    const comment = await addComment(testFixture.ctx, { issueId: testFixture.issue.id, body: 'Original' })
    await env.DB.prepare('UPDATE group_project_grants SET role = ? WHERE project_id = ?')
      .bind('viewer', testFixture.project.id)
      .run()
    await expect(
      updateComment(testFixture.ctx, { issueId: testFixture.issue.id, commentId: comment.id, body: 'Changed' }),
    ).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(
      deleteComment(testFixture.ctx, { issueId: testFixture.issue.id, commentId: comment.id }),
    ).rejects.toMatchObject({
      kind: 'forbidden',
    })
    await expect(
      env.DB.prepare('SELECT body FROM issue_comments WHERE id = ?').bind(comment.id).first(),
    ).resolves.toMatchObject({ body: 'Original' })
  })

  test('omits related issue metadata after access to its project is revoked', async () => {
    const testFixture = await fixture()
    const hidden = await seedProject(testFixture.workspace.id, 'SECRET')
    const linked = await seedIssue(testFixture.workspace.id, hidden.id, testFixture.user.id, { title: 'Secret issue' })
    await seedGroupGrant(testFixture.workspace.id, testFixture.user.id, testFixture.project.id, 'member')
    await seedGroupGrant(testFixture.workspace.id, testFixture.user.id, hidden.id, 'member')
    await env.DB.prepare(`INSERT INTO issue_links (id,workspace_id,source_issue_id,target_issue_id,type,created_by_id,created_at)
      VALUES (?, ?, ?, ?, 'blocks', ?, 1)`)
      .bind(crypto.randomUUID(), testFixture.workspace.id, testFixture.issue.id, linked.id, testFixture.user.id)
      .run()
    await expect(listLinksForIssue(testFixture.ctx, { issueId: testFixture.issue.id })).resolves.toHaveLength(1)
    await env.DB.prepare('DELETE FROM group_project_grants WHERE project_id = ?').bind(hidden.id).run()
    await expect(listLinksForIssue(testFixture.ctx, { issueId: testFixture.issue.id })).resolves.toStrictEqual([])
  })

  test.each([98, 200])(
    'marks %i notifications without exceeding native D1 bind limits or touching another user',
    async (count) => {
      const testFixture = await fixture()
      const ids = Array.from({ length: count }, () => crypto.randomUUID())
      await env.DB.batch(
        ids.map((id) =>
          env.DB.prepare(`INSERT INTO wiki_notifications
      (id,workspace_id,user_id,page_id,page_slug,page_title,action,summary,created_at)
      VALUES (?, ?, ?, ?, 'page','Page','updated','Changed',1)`).bind(
            id,
            testFixture.workspace.id,
            testFixture.user.id,
            testFixture.issue.id,
          ),
        ),
      )
      await markWikiNotificationsRead(testFixture.ctx, { ids })
      await expect(
        env.DB.prepare('SELECT COUNT(*) AS n FROM wiki_notifications WHERE workspace_id = ? AND read_at IS NOT NULL')
          .bind(testFixture.workspace.id)
          .first(),
      ).resolves.toMatchObject({ n: count })
    },
  )

  test.each(['type', 'status'] as const)(
    'does not clear the default %s when the requested target is missing',
    async (kind) => {
      const testFixture = await fixture()
      testFixture.ctx.role = 'owner'
      const target =
        kind === 'type'
          ? await seedTaskType(testFixture.workspace.id, { isDefault: true })
          : await seedTaskStatus(testFixture.workspace.id, { isDefault: true })
      const update = kind === 'type' ? updateTaskType : updateTaskStatus
      await expect(update(testFixture.ctx, crypto.randomUUID(), { isDefault: true })).rejects.toMatchObject({
        kind: 'not_found',
      })
      const table = kind === 'type' ? 'task_types' : 'task_statuses'
      await expect(
        env.DB.prepare(`SELECT id FROM ${table} WHERE workspace_id = ? AND is_default = 1`)
          .bind(testFixture.workspace.id)
          .all(),
      ).resolves.toMatchObject({ results: [{ id: target.id }] })
    },
  )
})
