import { describe, expect, it } from 'vite-plus/test'

import { bulkConvertToIssue, convertFeedbackToIssue } from '#commands/feedback'
import type { ServiceCtx } from '#commands/types'

import { env } from './fixture-api'
import { seedProjectFixture } from './helpers'

async function fixture(concurrentBatches = 1) {
  const f = await seedProjectFixture({ role: 'owner' })
  const sourceId = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO feedback_sources
    (id,token_hash,workspace_id,project_id,name,created_by,created_at) VALUES (?,?,?,?,?,?,1)`)
    .bind(sourceId, crypto.randomUUID(), f.workspaceId, f.projectId, 'Source', f.userId)
    .run()
  let arrivals = 0
  let release = () => {}
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const db = new Proxy(env.DB, {
    get(target, key) {
      if (key === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          if (++arrivals >= concurrentBatches) release()
          await barrier
          return target.batch(statements)
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const ctx: ServiceCtx = { db, kv: env.KV, r2: env.R2, workspaceId: f.workspaceId, userId: f.userId, role: 'owner' }
  const seed = async () => {
    const id = crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO feedback (id,source_id,workspace_id,project_id,body,created_at)
      VALUES (?,?,?,?,'Feedback',1)`)
      .bind(id, sourceId, f.workspaceId, f.projectId)
      .run()
    return id
  }
  return { ...f, ctx, seed, sourceId }
}

describe('native D1 atomic feedback conversion', () => {
  it('rejects a concurrent loser without an orphan issue, FTS row or activity', async () => {
    const f = await fixture(2)
    const id = await f.seed()
    const results = await Promise.allSettled([
      convertFeedbackToIssue(f.ctx, { feedbackId: id }),
      convertFeedbackToIssue(f.ctx, { feedbackId: id }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { kind: 'conflict' } })
    const issues = await env.DB.prepare('SELECT id,number FROM issues WHERE project_id=?')
      .bind(f.projectId)
      .all<{ id: string; number: number }>()
    expect(issues.results).toHaveLength(1)
    const issue = issues.results[0]!
    expect(issue.number).toBe(1)
    expect(
      await env.DB.prepare('SELECT linked_issue_id FROM feedback WHERE id=?').bind(id).first('linked_issue_id'),
    ).toBe(issue.id)
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM issues_fts WHERE workspace_id=?').bind(f.workspaceId).first('n'),
    ).toBe(1)
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE workspace_id=? AND entity_type='issue'")
        .bind(f.workspaceId)
        .first('n'),
    ).toBe(1)
  })

  it('rolls back an issue and FTS when feedback linking fails, then retries with number one', async () => {
    const f = await fixture()
    const id = await f.seed()
    const trigger = `fail_feedback_${id.replaceAll('-', '')}`
    await env.DB.prepare(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF linked_issue_id ON feedback
      WHEN OLD.id='${id}' BEGIN SELECT RAISE(ABORT,'feedback link failure'); END`).run()
    try {
      await expect(convertFeedbackToIssue(f.ctx, { feedbackId: id })).rejects.toThrow('feedback link failure')
      expect(
        await env.DB.prepare('SELECT COUNT(*) AS n FROM issues WHERE project_id=?').bind(f.projectId).first('n'),
      ).toBe(0)
      expect(
        await env.DB.prepare('SELECT COUNT(*) AS n FROM issues_fts WHERE workspace_id=?')
          .bind(f.workspaceId)
          .first('n'),
      ).toBe(0)
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE workspace_id=? AND entity_type='issue'")
          .bind(f.workspaceId)
          .first('n'),
      ).toBe(0)
    } finally {
      await env.DB.prepare(`DROP TRIGGER ${trigger}`).run()
    }
    await expect(convertFeedbackToIssue(f.ctx, { feedbackId: id })).resolves.toMatchObject({ number: 1 })
  })

  it('converts 500 feedback records in one bounded transaction using native json_each', async () => {
    const f = await fixture()
    const ids = Array.from({ length: 500 }, () => crypto.randomUUID())
    for (let offset = 0; offset < ids.length; offset += 50) {
      await env.DB.batch(
        ids.slice(offset, offset + 50).map((id) =>
          env.DB.prepare(`INSERT INTO feedback (id,source_id,workspace_id,project_id,body,created_at)
          VALUES (?,?,?,?,'Feedback',1)`).bind(id, f.sourceId, f.workspaceId, f.projectId),
        ),
      )
    }
    await expect(bulkConvertToIssue(f.ctx, { projectId: f.projectId, feedbackIds: ids })).resolves.toMatchObject({
      convertedCount: 500,
      number: 1,
    })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE project_id=? AND linked_issue_id IS NOT NULL')
        .bind(f.projectId)
        .first('n'),
    ).toBe(500)
  })
})
