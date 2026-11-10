import { describe, expect, it, vi } from 'vite-plus/test'

import { addComment, deleteComment, updateComment } from '#commands/comments'
import { listLinksForIssue } from '#commands/issue-links'
import { deleteIssue } from '#commands/issues'
import { updateTaskStatus } from '#commands/task-statuses'
import { updateTaskType } from '#commands/task-types'
import type { ServiceCtx } from '#commands/types'
import { markWikiNotificationsRead } from '#commands/wiki-watchers'

import { env } from './fixture-api'
import { seedFixture, seedGroupGrant, seedIssue, seedProject, seedTaskStatus, seedTaskType } from './helpers'

async function fixture() {
  const f = await seedFixture({ role: 'member' })
  const project = await seedProject(f.workspace.id)
  const issue = await seedIssue(f.workspace.id, project.id, f.user.id)
  const ctx: ServiceCtx = {
    db: env.DB,
    kv: env.KV,
    r2: env.R2,
    workspaceId: f.workspace.id,
    userId: f.user.id,
    role: 'member',
  }
  return { ...f, project, issue, ctx }
}

describe('native D1 domain invariants', () => {
  it('chunks issue storage cleanup at 1000 keys and continues after failure', async () => {
    const f = await fixture()
    f.ctx.role = 'owner'
    for (let offset = 0; offset < 1001; offset += 100) {
      const statements = Array.from({ length: Math.min(100, 1001 - offset) }, (_, i) => {
        const id = crypto.randomUUID()
        return env.DB.prepare(`INSERT INTO attachments
          (id,workspace_id,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at)
          VALUES (?, ?, ?, 'file','text/plain',1,'issue', ?, ?, 1)`).bind(
          id,
          f.workspace.id,
          `${f.workspace.id}/key-${offset + i}`,
          f.issue.id,
          f.user.id,
        )
      })
      await env.DB.batch(statements)
    }
    const remove = vi.fn(async (_keys: string[]) => {})
    remove.mockRejectedValueOnce(new Error('storage outage'))
    f.ctx.r2 = { delete: remove } as unknown as R2Bucket
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await deleteIssue(f.ctx, f.issue.id)
      expect(remove.mock.calls.map(([keys]) => keys.length)).toEqual([1000, 1])
      expect(log).toHaveBeenCalledWith(
        'deleteIssue: R2 cleanup failed',
        expect.objectContaining({ r2Keys: expect.any(Array) }),
      )
      expect(await env.DB.prepare('SELECT id FROM issues WHERE id = ?').bind(f.issue.id).first()).toBeNull()
    } finally {
      log.mockRestore()
    }
  })
  it('uses effective grants for author comment mutations and observes a downgrade immediately', async () => {
    const f = await fixture()
    await seedGroupGrant(f.workspace.id, f.user.id, f.project.id, 'member')
    f.ctx.role = 'viewer'
    const comment = await addComment(f.ctx, { issueId: f.issue.id, body: 'Original' })
    await env.DB.prepare('UPDATE group_project_grants SET role = ? WHERE project_id = ?')
      .bind('viewer', f.project.id)
      .run()
    await expect(
      updateComment(f.ctx, { issueId: f.issue.id, commentId: comment.id, body: 'Changed' }),
    ).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(deleteComment(f.ctx, { issueId: f.issue.id, commentId: comment.id })).rejects.toMatchObject({
      kind: 'forbidden',
    })
    expect(await env.DB.prepare('SELECT body FROM issue_comments WHERE id = ?').bind(comment.id).first()).toMatchObject(
      { body: 'Original' },
    )
  })

  it('omits related issue metadata after access to its project is revoked', async () => {
    const f = await fixture()
    const hidden = await seedProject(f.workspace.id, 'SECRET')
    const linked = await seedIssue(f.workspace.id, hidden.id, f.user.id, { title: 'Secret issue' })
    await seedGroupGrant(f.workspace.id, f.user.id, f.project.id, 'member')
    await seedGroupGrant(f.workspace.id, f.user.id, hidden.id, 'member')
    await env.DB.prepare(`INSERT INTO issue_links (id,workspace_id,source_issue_id,target_issue_id,type,created_by_id,created_at)
      VALUES (?, ?, ?, ?, 'blocks', ?, 1)`)
      .bind(crypto.randomUUID(), f.workspace.id, f.issue.id, linked.id, f.user.id)
      .run()
    expect(await listLinksForIssue(f.ctx, { issueId: f.issue.id })).toHaveLength(1)
    await env.DB.prepare('DELETE FROM group_project_grants WHERE project_id = ?').bind(hidden.id).run()
    expect(await listLinksForIssue(f.ctx, { issueId: f.issue.id })).toEqual([])
  })

  it.each([98, 200])(
    'marks %i notifications without exceeding native D1 bind limits or touching another user',
    async (count) => {
      const f = await fixture()
      const ids = Array.from({ length: count }, () => crypto.randomUUID())
      await env.DB.batch(
        ids.map((id) =>
          env.DB.prepare(`INSERT INTO wiki_notifications
      (id,workspace_id,user_id,page_id,page_slug,page_title,action,summary,created_at)
      VALUES (?, ?, ?, ?, 'page','Page','updated','Changed',1)`).bind(id, f.workspace.id, f.user.id, f.issue.id),
        ),
      )
      await markWikiNotificationsRead(f.ctx, { ids })
      expect(
        await env.DB.prepare(
          'SELECT COUNT(*) AS n FROM wiki_notifications WHERE workspace_id = ? AND read_at IS NOT NULL',
        )
          .bind(f.workspace.id)
          .first(),
      ).toMatchObject({ n: count })
    },
  )

  it.each(['type', 'status'] as const)(
    'does not clear the default %s when the requested target is missing',
    async (kind) => {
      const f = await fixture()
      f.ctx.role = 'owner'
      const target =
        kind === 'type'
          ? await seedTaskType(f.workspace.id, { isDefault: true })
          : await seedTaskStatus(f.workspace.id, { isDefault: true })
      const update = kind === 'type' ? updateTaskType : updateTaskStatus
      await expect(update(f.ctx, crypto.randomUUID(), { isDefault: true })).rejects.toMatchObject({ kind: 'not_found' })
      const table = kind === 'type' ? 'task_types' : 'task_statuses'
      expect(
        await env.DB.prepare(`SELECT id FROM ${table} WHERE workspace_id = ? AND is_default = 1`)
          .bind(f.workspace.id)
          .all(),
      ).toMatchObject({ results: [{ id: target.id }] })
    },
  )
})
