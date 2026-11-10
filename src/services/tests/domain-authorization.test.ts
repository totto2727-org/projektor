import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { addComment, deleteComment, updateComment } from '#commands/comments'
import { getFeedbackSource } from '#commands/feedback-sources'
import { listLinksForIssue } from '#commands/issue-links'
import { getIssue } from '#commands/issues'
import { updateTaskStatus } from '#commands/task-statuses'
import { updateTaskType } from '#commands/task-types'
import type { ServiceCtx } from '#commands/types'
import { markWikiNotificationsRead } from '#commands/wiki-watchers'

import { createTestDatabase } from '../../web/test/database'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
    INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','User',1),('other','other@example.test','Other',1);
    INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w','Workspace','workspace',1),('other','Other','other',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w','u','member',1);
    INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES
      ('p','w','Visible','VIS',1,1),('hidden','w','Hidden','HID',1,1);
    INSERT INTO issues (id,workspace_id,project_id,number,title,status,priority,created_by_id,created_at,updated_at) VALUES
      ('i','w','p',1,'Visible issue','backlog','medium','u',1,1),
      ('secret','w','hidden',1,'Secret title','backlog','medium','u',1,1);
    INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g','w','Group',1);
    INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g','u','u',1);
    INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g','p','member');
  `)
  const binds: number[] = []
  const db = new Proxy(database.db, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (query: string) => {
          const statement = target.prepare(query)
          return new Proxy(statement, {
            get(prepared, key, preparedReceiver) {
              if (key === 'bind') {
                return (...values: unknown[]) => {
                  binds.push(values.length)
                  if (values.length > 100) throw new Error('D1 bind budget exceeded')
                  return prepared.bind(...values)
                }
              }
              const value = Reflect.get(prepared, key, preparedReceiver)
              return typeof value === 'function' ? value.bind(prepared) : value
            },
          })
        }
      }
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          database.sqlite.exec('BEGIN')
          try {
            const results = []
            for (const statement of statements) results.push(await statement.all())
            database.sqlite.exec('COMMIT')
            return results
          } catch (error) {
            database.sqlite.exec('ROLLBACK')
            throw error
          }
        }
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const ctx: ServiceCtx = {
    db,
    kv: { get: vi.fn(async () => null), put: vi.fn(), delete: vi.fn() } as unknown as KVNamespace,
    r2: {} as R2Bucket,
    workspaceId: 'w',
    userId: 'u',
    role: 'member',
  }
  return { ...database, ctx, binds }
}

describe('current effective grants at shared command boundaries', () => {
  it('rejects every comment write after downgrade, including the existing author', async () => {
    const f = fixture()
    const { id } = await addComment(f.ctx, { issueId: 'i', body: 'Original' })
    f.sqlite.exec("UPDATE group_project_grants SET role = 'viewer'")
    await expect(addComment(f.ctx, { issueId: 'i', body: 'New' })).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(updateComment(f.ctx, { issueId: 'i', commentId: id, body: 'Changed' })).rejects.toMatchObject({
      kind: 'forbidden',
    })
    await expect(deleteComment(f.ctx, { issueId: 'i', commentId: id })).rejects.toMatchObject({ kind: 'forbidden' })
    expect(f.sqlite.prepare('SELECT body FROM issue_comments WHERE id = ?').get(id)).toMatchObject({ body: 'Original' })
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM issue_comments').get()).toMatchObject({ n: 1 })
  })

  it('permits a workspace viewer with a project member grant, but never the public identity', async () => {
    const f = fixture()
    f.ctx.role = 'viewer'
    const { id } = await addComment(f.ctx, { issueId: 'i', body: 'Allowed' })
    await updateComment(f.ctx, { issueId: 'i', commentId: id, body: 'Updated' })
    f.ctx.auth = { kind: 'human', method: 'public' }
    await expect(deleteComment(f.ctx, { issueId: 'i', commentId: id })).rejects.toMatchObject({ kind: 'forbidden' })
    f.ctx.auth = { kind: 'human', method: 'access' }
    await deleteComment(f.ctx, { issueId: 'i', commentId: id })
    expect(f.sqlite.prepare('SELECT id FROM issue_comments').get()).toBeUndefined()
  })

  it('removes hidden linked metadata from both link and embedded issue reads after revocation', async () => {
    const f = fixture()
    f.sqlite.exec(`
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g','hidden','member');
      INSERT INTO issue_links (id,workspace_id,source_issue_id,target_issue_id,type,created_by_id,created_at)
        VALUES ('link','w','i','secret','blocks','u',1);
    `)
    expect(await listLinksForIssue(f.ctx, { issueId: 'i' })).toMatchObject([{ linkedIssueTitle: 'Secret title' }])
    f.sqlite.exec("DELETE FROM group_project_grants WHERE project_id = 'hidden'")
    expect(await listLinksForIssue(f.ctx, { issueId: 'i' })).toEqual([])
    expect(await getIssue(f.ctx, { id: 'i' })).toMatchObject({ links: [] })
    await expect(listLinksForIssue(f.ctx, { issueId: 'secret' })).rejects.toMatchObject({ kind: 'not_found' })
    f.ctx.role = 'admin'
    expect(await listLinksForIssue(f.ctx, { issueId: 'i' })).toHaveLength(1)
  })

  it('does not expose known feedback-source details to hidden-project or non-admin callers', async () => {
    const f = fixture()
    f.sqlite.exec(`INSERT INTO feedback_sources
      (id,workspace_id,project_id,name,token_hash,created_by,created_at)
      VALUES ('source','w','hidden','Secret source','hash','u',1)`)
    await expect(getFeedbackSource(f.ctx, { sourceId: 'source' })).rejects.toMatchObject({ kind: 'not_found' })
    f.sqlite.exec("INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g','hidden','member')")
    await expect(getFeedbackSource(f.ctx, { sourceId: 'source' })).rejects.toMatchObject({ kind: 'forbidden' })
    f.ctx.role = 'admin'
    expect(await getFeedbackSource(f.ctx, { sourceId: 'source' })).toMatchObject({ name: 'Secret source' })
    f.ctx.workspaceId = 'other'
    await expect(getFeedbackSource(f.ctx, { sourceId: 'source' })).rejects.toMatchObject({ kind: 'not_found' })
  })
})

describe('bounded and atomic shared mutations', () => {
  it.each([97, 98, 200])('marks %i owned notifications within the D1 bind budget', async (count) => {
    const f = fixture()
    const insert = f.sqlite.prepare(`INSERT INTO wiki_notifications
      (id,workspace_id,user_id,page_id,page_slug,page_title,action,summary,created_at)
      VALUES (?, ?, ?, 'page','page','Page','updated','Changed',1)`)
    const ids = Array.from({ length: count }, (_, i) => `n${i}`)
    for (const id of ids) insert.run(id, 'w', 'u')
    insert.run('foreign-user', 'w', 'other')
    insert.run('foreign-tenant', 'other', 'u')
    await markWikiNotificationsRead(f.ctx, { ids })
    expect(
      f.sqlite.prepare('SELECT COUNT(*) AS n FROM wiki_notifications WHERE read_at IS NOT NULL').get(),
    ).toMatchObject({ n: count })
    expect(Math.max(...f.binds)).toBeLessThanOrEqual(100)
    await markWikiNotificationsRead(f.ctx, { all: true })
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM wiki_notifications WHERE read_at IS NULL').get()).toMatchObject({
      n: 2,
    })
  })

  it.each(['type', 'status'] as const)(
    'keeps the old default %s for a missing target and rolls back a failed transition',
    async (kind) => {
      const f = fixture()
      f.ctx.role = 'owner'
      const table = kind === 'type' ? 'task_types' : 'task_statuses'
      const categoryColumn = kind === 'status' ? ',category' : ''
      const categoryValue = kind === 'status' ? ",'todo'" : ''
      f.sqlite.exec(`INSERT INTO ${table} (id,workspace_id,key,name,is_default${categoryColumn})
      VALUES ('old','w','old','Old',1${categoryValue}),('target','w','target','Target',0${categoryValue})`)
      const update = kind === 'type' ? updateTaskType : updateTaskStatus
      await expect(update(f.ctx, 'missing', { isDefault: true })).rejects.toMatchObject({ kind: 'not_found' })
      expect(f.sqlite.prepare(`SELECT id FROM ${table} WHERE is_default = 1`).all()).toEqual([{ id: 'old' }])
      f.sqlite.exec(`CREATE TRIGGER fail_default BEFORE UPDATE ON ${table} WHEN NEW.id = 'target'
      BEGIN SELECT RAISE(ABORT, 'injected failure'); END`)
      await expect(update(f.ctx, 'target', { isDefault: true })).rejects.toThrow('injected failure')
      expect(f.sqlite.prepare(`SELECT id FROM ${table} WHERE is_default = 1`).all()).toEqual([{ id: 'old' }])
      f.sqlite.exec('DROP TRIGGER fail_default')
      await update(f.ctx, 'target', { isDefault: true })
      expect(f.sqlite.prepare(`SELECT id FROM ${table} WHERE is_default = 1`).all()).toEqual([{ id: 'target' }])
    },
  )
})
