import { Predicate } from 'effect'
import { assert, describe, expect, test } from 'vite-plus/test'

import { bulkConvertToIssue, convertFeedbackToIssue } from '#commands/feedback.ts'
import type { ServiceCtx } from '#commands/types.ts'

import { env } from './fixture-api.ts'
import { seedProjectFixture } from './helpers.ts'

const fixture = async function fixture(concurrentBatches = 1) {
  const testFixture = await seedProjectFixture({ role: 'owner' })
  const sourceId = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO feedback_sources
    (id,token_hash,workspace_id,project_id,name,created_by,created_at) VALUES (?,?,?,?,?,?,1)`)
    .bind(sourceId, crypto.randomUUID(), testFixture.workspaceId, testFixture.projectId, 'Source', testFixture.userId)
    .run()
  let arrivals = 0
  let release = (): void => {}
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const db = new Proxy(env.DB, {
    get(target, key) {
      if (key === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          if (++arrivals >= concurrentBatches) {
            release()
          }
          await barrier
          return target.batch(statements)
        }
      }
      const value = Reflect.get(target, key)
      return Predicate.isFunction(value) ? value.bind(target) : value
    },
  })
  const ctx: ServiceCtx = {
    db,
    kv: env.KV,
    r2: env.R2,
    workspaceId: testFixture.workspaceId,
    userId: testFixture.userId,
    role: 'owner',
  }
  const seed = async () => {
    const id = crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO feedback (id,source_id,workspace_id,project_id,body,created_at)
      VALUES (?,?,?,?,'Feedback',1)`)
      .bind(id, sourceId, testFixture.workspaceId, testFixture.projectId)
      .run()
    return id
  }
  return { ...testFixture, ctx, seed, sourceId }
}

describe('native D1 atomic feedback conversion', () => {
  test('rejects a concurrent loser without an orphan issue, FTS row or activity', async () => {
    const testFixture = await fixture(2)
    const id = await testFixture.seed()
    const results = await Promise.allSettled([
      convertFeedbackToIssue(testFixture.ctx, { feedbackId: id }),
      convertFeedbackToIssue(testFixture.ctx, { feedbackId: id }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { kind: 'conflict' } })
    const issues = await env.DB.prepare('SELECT id,number FROM issues WHERE project_id=?')
      .bind(testFixture.projectId)
      .all<{ id: string; number: number }>()
    expect(issues.results).toHaveLength(1)
    const [issue] = issues.results
    assert.exists(issue)
    expect(issue.number).toBe(1)
    await expect(
      env.DB.prepare('SELECT linked_issue_id FROM feedback WHERE id=?').bind(id).first('linked_issue_id'),
    ).resolves.toBe(issue.id)
    await expect(
      env.DB.prepare('SELECT COUNT(*) AS n FROM issues_fts WHERE workspace_id=?')
        .bind(testFixture.workspaceId)
        .first('n'),
    ).resolves.toBe(1)
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE workspace_id=? AND entity_type='issue'")
        .bind(testFixture.workspaceId)
        .first('n'),
    ).resolves.toBe(1)
  })

  test('rolls back an issue and FTS when feedback linking fails, then retries with number one', async () => {
    const testFixture = await fixture()
    const id = await testFixture.seed()
    const trigger = `fail_feedback_${id.replaceAll('-', '')}`
    await env.DB.prepare(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF linked_issue_id ON feedback
      WHEN OLD.id='${id}' BEGIN SELECT RAISE(ABORT,'feedback link failure'); END`).run()
    try {
      await expect(convertFeedbackToIssue(testFixture.ctx, { feedbackId: id })).rejects.toThrow('feedback link failure')
      await expect(
        env.DB.prepare('SELECT COUNT(*) AS n FROM issues WHERE project_id=?').bind(testFixture.projectId).first('n'),
      ).resolves.toBe(0)
      await expect(
        env.DB.prepare('SELECT COUNT(*) AS n FROM issues_fts WHERE workspace_id=?')
          .bind(testFixture.workspaceId)
          .first('n'),
      ).resolves.toBe(0)
      await expect(
        env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE workspace_id=? AND entity_type='issue'")
          .bind(testFixture.workspaceId)
          .first('n'),
      ).resolves.toBe(0)
    } finally {
      await env.DB.prepare(`DROP TRIGGER ${trigger}`).run()
    }
    await expect(convertFeedbackToIssue(testFixture.ctx, { feedbackId: id })).resolves.toMatchObject({ number: 1 })
  })

  test('converts 500 feedback records in one bounded transaction using native json_each', async () => {
    const testFixture = await fixture()
    const ids = Array.from({ length: 500 }, () => crypto.randomUUID())
    for (let offset = 0; offset < ids.length; offset += 50) {
      await env.DB.batch(
        ids.slice(offset, offset + 50).map((id) =>
          env.DB.prepare(`INSERT INTO feedback (id,source_id,workspace_id,project_id,body,created_at)
          VALUES (?,?,?,?,'Feedback',1)`).bind(
            id,
            testFixture.sourceId,
            testFixture.workspaceId,
            testFixture.projectId,
          ),
        ),
      )
    }
    await expect(
      bulkConvertToIssue(testFixture.ctx, { projectId: testFixture.projectId, feedbackIds: ids }),
    ).resolves.toMatchObject({
      convertedCount: 500,
      number: 1,
    })
    await expect(
      env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE project_id=? AND linked_issue_id IS NOT NULL')
        .bind(testFixture.projectId)
        .first('n'),
    ).resolves.toBe(500)
  })
})
