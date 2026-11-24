import { Iterable, Predicate } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { addComment, deleteComment, updateComment } from '#commands/comments.ts'
import { getFeedbackSource } from '#commands/feedback-sources.ts'
import { listLinksForIssue } from '#commands/issue-links.ts'
import { getIssue } from '#commands/issues.ts'
import { listProjects } from '#commands/projects.ts'
import { updateTaskStatus } from '#commands/task-statuses.ts'
import { updateTaskType } from '#commands/task-types.ts'
import type { ServiceCtx } from '#commands/types.ts'
import { markWikiNotificationsRead } from '#commands/wiki-watchers.ts'
import { createTestDatabase } from '@/test/database.ts'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  Iterable.forEach(databases.splice(0), (database) => {
    database.close()
  })
})

const fixture = function fixture() {
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
                  if (values.length > 100) {
                    throw new Error('D1 bind budget exceeded')
                  }
                  return prepared.bind(...values)
                }
              }
              const value = Reflect.get(prepared, key, preparedReceiver)
              return Predicate.isFunction(value) ? value.bind(prepared) : value
            },
          })
        }
      }
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          database.sqlite.exec('BEGIN')
          try {
            const results = []
            for (const statement of statements) {
              results.push(await statement.all())
            }
            database.sqlite.exec('COMMIT')
            return results
          } catch (error) {
            database.sqlite.exec('ROLLBACK')
            throw error
          }
        }
      }
      const value = Reflect.get(target, property, receiver)
      return Predicate.isFunction(value) ? value.bind(target) : value
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
  test('normalizes MCP project archive booleans rather than treating string false as truthy', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec(`UPDATE projects SET archived_at = 1 WHERE id = 'hidden';
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g','hidden','member')`)
    await expect(listProjects(testFixture.ctx, { includeArchived: 'false' })).resolves.toHaveLength(1)
    await expect(listProjects(testFixture.ctx, { includeArchived: false })).resolves.toHaveLength(1)
    await expect(listProjects(testFixture.ctx, { includeArchived: 'true' })).resolves.toHaveLength(2)
    await expect(listProjects(testFixture.ctx, { includeArchived: 'garbage' })).rejects.toMatchObject({
      kind: 'validation',
    })
    await expect(listProjects(testFixture.ctx, null)).rejects.toMatchObject({ kind: 'validation' })
  })

  test('rejects every comment write after downgrade, including the existing author', async () => {
    const testFixture = fixture()
    const { id } = await addComment(testFixture.ctx, { issueId: 'i', body: 'Original' })
    testFixture.sqlite.exec("UPDATE group_project_grants SET role = 'viewer'")
    await expect(addComment(testFixture.ctx, { issueId: 'i', body: 'New' })).rejects.toMatchObject({
      kind: 'forbidden',
    })
    await expect(
      updateComment(testFixture.ctx, { issueId: 'i', commentId: id, body: 'Changed' }),
    ).rejects.toMatchObject({
      kind: 'forbidden',
    })
    await expect(deleteComment(testFixture.ctx, { issueId: 'i', commentId: id })).rejects.toMatchObject({
      kind: 'forbidden',
    })
    expect(testFixture.sqlite.prepare('SELECT body FROM issue_comments WHERE id = ?').get(id)).toMatchObject({
      body: 'Original',
    })
    expect(testFixture.sqlite.prepare('SELECT COUNT(*) AS n FROM issue_comments').get()).toMatchObject({ n: 1 })
  })

  test('permits a workspace viewer with a project member grant, but never the public identity', async () => {
    const testFixture = fixture()
    testFixture.ctx.role = 'viewer'
    const { id } = await addComment(testFixture.ctx, { issueId: 'i', body: 'Allowed' })
    await updateComment(testFixture.ctx, { issueId: 'i', commentId: id, body: 'Updated' })
    testFixture.ctx.auth = { kind: 'human', method: 'public' }
    await expect(deleteComment(testFixture.ctx, { issueId: 'i', commentId: id })).rejects.toMatchObject({
      kind: 'forbidden',
    })
    testFixture.ctx.auth = { kind: 'human', method: 'access' }
    await deleteComment(testFixture.ctx, { issueId: 'i', commentId: id })
    expect(testFixture.sqlite.prepare('SELECT id FROM issue_comments').get()).toBeUndefined()
  })

  test('removes hidden linked metadata from both link and embedded issue reads after revocation', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec(`
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g','hidden','member');
      INSERT INTO issue_links (id,workspace_id,source_issue_id,target_issue_id,type,created_by_id,created_at)
        VALUES ('link','w','i','secret','blocks','u',1);
    `)
    await expect(listLinksForIssue(testFixture.ctx, { issueId: 'i' })).resolves.toMatchObject([
      { linkedIssueTitle: 'Secret title' },
    ])
    testFixture.sqlite.exec("DELETE FROM group_project_grants WHERE project_id = 'hidden'")
    await expect(listLinksForIssue(testFixture.ctx, { issueId: 'i' })).resolves.toStrictEqual([])
    await expect(getIssue(testFixture.ctx, { id: 'i' })).resolves.toMatchObject({ links: [] })
    await expect(listLinksForIssue(testFixture.ctx, { issueId: 'secret' })).rejects.toMatchObject({ kind: 'not_found' })
    testFixture.ctx.role = 'admin'
    await expect(listLinksForIssue(testFixture.ctx, { issueId: 'i' })).resolves.toHaveLength(1)
  })

  test('does not expose known feedback-source details to hidden-project or non-admin callers', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec(`INSERT INTO feedback_sources
      (id,workspace_id,project_id,name,token_hash,created_by,created_at)
      VALUES ('source','w','hidden','Secret source','hash','u',1)`)
    await expect(getFeedbackSource(testFixture.ctx, { sourceId: 'source' })).rejects.toMatchObject({
      kind: 'not_found',
    })
    testFixture.sqlite.exec(
      "INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g','hidden','member')",
    )
    await expect(getFeedbackSource(testFixture.ctx, { sourceId: 'source' })).rejects.toMatchObject({
      kind: 'forbidden',
    })
    testFixture.ctx.role = 'admin'
    await expect(getFeedbackSource(testFixture.ctx, { sourceId: 'source' })).resolves.toMatchObject({
      name: 'Secret source',
    })
    testFixture.ctx.workspaceId = 'other'
    await expect(getFeedbackSource(testFixture.ctx, { sourceId: 'source' })).rejects.toMatchObject({
      kind: 'not_found',
    })
  })
})

describe('bounded and atomic shared mutations', () => {
  test.each([97, 98, 200])('marks %i owned notifications within the D1 bind budget', async (count) => {
    const testFixture = fixture()
    const insert = testFixture.sqlite.prepare(`INSERT INTO wiki_notifications
      (id,workspace_id,user_id,page_id,page_slug,page_title,action,summary,created_at)
      VALUES (?, ?, ?, 'page','page','Page','updated','Changed',1)`)
    const ids = Array.from({ length: count }, (_value, index) => `n${index}`)
    Iterable.forEach(ids, (id) => {
      insert.run(id, 'w', 'u')
    })
    insert.run('foreign-user', 'w', 'other')
    insert.run('foreign-tenant', 'other', 'u')
    await markWikiNotificationsRead(testFixture.ctx, { ids })
    expect(
      testFixture.sqlite.prepare('SELECT COUNT(*) AS n FROM wiki_notifications WHERE read_at IS NOT NULL').get(),
    ).toMatchObject({ n: count })
    expect(Math.max(...testFixture.binds)).toBeLessThanOrEqual(100)
    await markWikiNotificationsRead(testFixture.ctx, { all: true })
    expect(
      testFixture.sqlite.prepare('SELECT COUNT(*) AS n FROM wiki_notifications WHERE read_at IS NULL').get(),
    ).toMatchObject({
      n: 2,
    })
  })

  test.each(['type', 'status'] as const)(
    'keeps the old default %s for a missing target and rolls back a failed transition',
    async (kind) => {
      const testFixture = fixture()
      testFixture.ctx.role = 'owner'
      const table = kind === 'type' ? 'task_types' : 'task_statuses'
      const categoryColumn = kind === 'status' ? ',category' : ''
      const categoryValue = kind === 'status' ? ",'todo'" : ''
      testFixture.sqlite.exec(`INSERT INTO ${table} (id,workspace_id,key,name,is_default${categoryColumn})
      VALUES ('old','w','old','Old',1${categoryValue}),('target','w','target','Target',0${categoryValue})`)
      const update = kind === 'type' ? updateTaskType : updateTaskStatus
      await expect(update(testFixture.ctx, 'missing', { isDefault: true })).rejects.toMatchObject({ kind: 'not_found' })
      expect(testFixture.sqlite.prepare(`SELECT id FROM ${table} WHERE is_default = 1`).all()).toEqual([{ id: 'old' }])
      testFixture.sqlite.exec(`CREATE TRIGGER fail_default BEFORE UPDATE ON ${table} WHEN NEW.id = 'target'
      BEGIN SELECT RAISE(ABORT, 'injected failure'); END`)
      await expect(update(testFixture.ctx, 'target', { isDefault: true })).rejects.toThrow('injected failure')
      expect(testFixture.sqlite.prepare(`SELECT id FROM ${table} WHERE is_default = 1`).all()).toEqual([{ id: 'old' }])
      testFixture.sqlite.exec('DROP TRIGGER fail_default')
      await update(testFixture.ctx, 'target', { isDefault: true })
      expect(testFixture.sqlite.prepare(`SELECT id FROM ${table} WHERE is_default = 1`).all()).toEqual([
        { id: 'target' },
      ])
    },
  )
})
