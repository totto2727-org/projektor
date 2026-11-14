import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { bulkConvertToIssue, convertFeedbackToIssue } from '#commands/feedback'
import { createIssue } from '#commands/issues'
import type { ServiceCtx } from '#commands/types'

import { createTestDatabase } from '../../web/test/database'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture(concurrentBatches = 1) {
  const database = createTestDatabase()
  databases.push(database)
  // The migrated node fixture omits FTS5. This mirror verifies row consistency, not FTS matching.
  database.sqlite.exec(`CREATE TABLE issues_fts (issue_id TEXT,workspace_id TEXT,title TEXT,body TEXT);
    INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','User',1);
    INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w','Workspace','workspace',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w','u','owner',1);
    INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES ('p','w','Project','PROJ',1,1);
    INSERT INTO feedback_sources (id,token_hash,workspace_id,project_id,name,created_by,created_at)
      VALUES ('s','hash','w','p','Source','u',1);`)
  let arrivals = 0
  let release = () => {}
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  let tail: Promise<unknown> = Promise.resolve()
  const binds: number[] = []
  const db = new Proxy(database.db, {
    get(target, key) {
      if (key === 'prepare')
        return (query: string) => {
          const statement = target.prepare(query)
          return new Proxy(statement, {
            get(prepared, property) {
              if (property === 'bind')
                return (...values: unknown[]) => {
                  binds.push(values.length)
                  if (values.length > 100) throw new Error('D1 bind budget exceeded')
                  return prepared.bind(...values)
                }
              return Reflect.get(prepared, property)
            },
          })
        }
      if (key !== 'batch') return Reflect.get(target, key)
      return async (statements: D1PreparedStatement[]) => {
        if (++arrivals >= concurrentBatches) release()
        await barrier
        // D1 serializes atomic batches. Both callers must reach the write boundary before either runs.
        const pending = tail.then(async () => {
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
        })
        tail = pending.catch(() => {})
        return pending
      }
    },
  })
  const fetch = vi.fn(async () => new Response())
  const ctx: ServiceCtx = {
    db,
    kv: { get: vi.fn(async () => null), put: vi.fn(), delete: vi.fn() } as unknown as KVNamespace,
    r2: {} as R2Bucket,
    workspaceId: 'w',
    userId: 'u',
    role: 'owner',
    workspaceHub: { idFromName: vi.fn(), get: () => ({ fetch }) } as unknown as DurableObjectNamespace,
  }
  const seed = (id: string) =>
    database.sqlite
      .prepare(`INSERT INTO feedback
    (id,source_id,workspace_id,project_id,body,created_at) VALUES (?,'s','w','p','Feedback body',1)`)
      .run(id)
  const count = (table: string) => database.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n
  return { ...database, ctx, seed, count, fetch, binds }
}

describe('feedback conversion transaction', () => {
  it('permits exactly one concurrent single conversion without orphan issues, mirrors, activity or events', async () => {
    const f = fixture(2)
    f.seed('f')
    const results = await Promise.allSettled([
      convertFeedbackToIssue(f.ctx, { feedbackId: 'f' }),
      convertFeedbackToIssue(f.ctx, { feedbackId: 'f' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { kind: 'conflict' } })
    for (const table of ['issues', 'issues_fts', 'activity']) expect(f.count(table), table).toBe(1)
    expect(f.fetch).toHaveBeenCalledTimes(1)
    const issue = f.sqlite.prepare('SELECT id,number FROM issues').get()
    expect(issue?.number).toBe(1)
    expect(f.sqlite.prepare('SELECT linked_issue_id,status FROM feedback').get()).toMatchObject({
      linked_issue_id: issue?.id,
      status: 'actioned',
    })
  })

  it('does not partially convert an overlapping bulk selection when another conversion wins', async () => {
    const f = fixture(2)
    for (const id of ['a', 'b', 'c']) f.seed(id)
    const results = await Promise.allSettled([
      bulkConvertToIssue(f.ctx, { projectId: 'p', feedbackIds: ['a', 'b'] }),
      bulkConvertToIssue(f.ctx, { projectId: 'p', feedbackIds: ['b', 'c'] }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { kind: 'conflict' } })
    expect(f.count('issues')).toBe(1)
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM feedback WHERE linked_issue_id IS NOT NULL').get()?.n).toBe(2)
    expect(f.count('issues_fts')).toBe(1)
    expect(f.count('activity')).toBe(1)
  })

  it('rolls back issue number, FTS and activity when linking fails, then retries cleanly', async () => {
    const f = fixture()
    f.seed('f')
    f.sqlite.exec(`CREATE TRIGGER fail_link BEFORE UPDATE OF linked_issue_id ON feedback
      BEGIN SELECT RAISE(ABORT,'link failure'); END;`)
    await expect(convertFeedbackToIssue(f.ctx, { feedbackId: 'f' })).rejects.toThrow('link failure')
    for (const table of ['issues', 'issues_fts', 'activity']) expect(f.count(table), table).toBe(0)
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.sqlite.prepare('SELECT linked_issue_id,status FROM feedback').get()).toMatchObject({
      linked_issue_id: null,
      status: 'new',
    })
    f.sqlite.exec('DROP TRIGGER fail_link')
    await expect(convertFeedbackToIssue(f.ctx, { feedbackId: 'f' })).resolves.toMatchObject({ number: 1 })
  })

  it('converts the 500-ID maximum without crossing the D1 bind cap', async () => {
    const f = fixture()
    const ids = Array.from({ length: 500 }, (_, i) => `f${i}`)
    for (const id of ids) f.seed(id)
    await expect(bulkConvertToIssue(f.ctx, { projectId: 'p', feedbackIds: ids })).resolves.toMatchObject({
      convertedCount: 500,
      number: 1,
    })
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM feedback WHERE linked_issue_id IS NOT NULL').get()?.n).toBe(500)
    expect(Math.max(...f.binds)).toBeLessThanOrEqual(100)
  })

  it('preserves ordinary issue creation and sequential number allocation', async () => {
    const f = fixture()
    await expect(createIssue(f.ctx, { projectId: 'p', title: 'Normal' })).resolves.toMatchObject({ number: 1 })
    await expect(createIssue(f.ctx, { projectId: 'p', title: 'Normal two' })).resolves.toMatchObject({ number: 2 })
    expect(f.count('issues_fts')).toBe(2)
    expect(f.count('activity')).toBe(2)
  })
})
