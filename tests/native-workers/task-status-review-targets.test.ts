import { describe, expect, test } from 'vite-plus/test'

import { env } from '#api/test/fixture-api.ts'
import { authHeaders, seedIssue, seedProjectFixture, seedTaskStatus } from '#api/test/helpers.ts'
import { fetchNativeApi } from '#api/test/native-fetch.ts'

const fixture = async function fixture() {
  const owner = await seedProjectFixture({ role: 'owner' })
  const status = await seedTaskStatus(owner.workspaceId, { category: 'in_progress', key: 'custom_review' })
  const otherStatus = await seedTaskStatus(owner.workspaceId, { category: 'todo', isDefault: true, key: 'unrelated' })
  const issue = await seedIssue(owner.workspaceId, owner.projectId, owner.userId, { statusId: status.id })
  const unrelated = await seedIssue(owner.workspaceId, owner.projectId, owner.userId, { statusId: otherStatus.id })
  const foreign = await seedProjectFixture({ role: 'owner' })
  const foreignIssue = await seedIssue(foreign.workspaceId, foreign.projectId, foreign.userId)
  const selected = crypto.randomUUID()
  const done = crypto.randomUUID()
  const ordinary = crypto.randomUUID()
  const wiki = crypto.randomUUID()
  const unrelatedAttachment = crypto.randomUUID()
  const foreignAttachment = crypto.randomUUID()
  for (const row of [
    { id: selected, owner, issue, kind: 'file', review: 'in_review' },
    { id: done, owner, issue, kind: 'url', review: 'done' },
    { id: ordinary, owner, issue, kind: 'url', review: null },
    { id: wiki, owner, issue, kind: 'wiki_ref', review: null },
    { id: unrelatedAttachment, owner, issue: unrelated, kind: 'url', review: 'fixing' },
    { id: foreignAttachment, owner: foreign, issue: foreignIssue, kind: 'url', review: 'changes_requested' },
  ]) {
    await env.DB.prepare(`INSERT INTO attachments
      (id,workspace_id,kind,r2_key,filename,content_type,size,url,entity_type,entity_id,created_by_id,created_at,review_status)
      VALUES (?,?,?,'retained-key','Retained attachment','text/plain',1,'https://example.test','issue',?,?,1,?)`)
      .bind(row.id, row.owner.workspaceId, row.kind, row.issue.id, row.owner.userId, row.review)
      .run()
  }
  const ids = [selected, done, ordinary, wiki, unrelatedAttachment, foreignAttachment]
  const attachments = (): Promise<D1Result<{ id: string; review_status: string | null; r2_key: string }>> =>
    env.DB.prepare(
      `SELECT id,review_status,r2_key FROM attachments WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    )
      .bind(...ids)
      .all<{ id: string; review_status: string | null; r2_key: string }>()
  const patch = (body: unknown): Promise<Response> =>
    fetchNativeApi(`http://localhost/api/task-statuses/${status.id}`, {
      method: 'PATCH',
      headers: authHeaders(owner.token, owner.slug),
      body: JSON.stringify(body),
    })
  return { owner, status, otherStatus, issue, selected, done, attachments, patch }
}

describe('native custom status category review-target resync', () => {
  test.each([
    ['done', false],
    ['done', true],
    ['cancelled', false],
    ['cancelled', true],
  ] as const)(
    'atomically handles %s category with isDefault=%s without removing attachments',
    async (category, isDefault) => {
      const testFixture = await fixture()
      const before = await testFixture.attachments()
      const response = await testFixture.patch({ category, isDefault })
      expect(response.status, await response.text()).toBe(200)
      await expect(
        env.DB.prepare('SELECT status_category FROM issues WHERE id=?').bind(testFixture.issue.id).first(),
      ).resolves.toStrictEqual({
        status_category: category,
      })
      const result = await testFixture.attachments()
      expect(result.results).toStrictEqual(
        before.results.map((row) =>
          row.id === testFixture.selected || row.id === testFixture.done
            ? { ...row, review_status: category === 'done' ? 'done' : null }
            : row,
        ),
      )
      // Later independent review selections survive a no-op category save and reopening.
      await env.DB.prepare("UPDATE attachments SET review_status='fixing' WHERE id=?").bind(testFixture.selected).run()
      const resolvedValue = await testFixture.patch({ category })
      expect(resolvedValue.status).toBe(200)
      expect((await testFixture.patch({ category: 'todo' })).status).toBe(200)
      await expect(
        env.DB.prepare('SELECT review_status FROM attachments WHERE id=?').bind(testFixture.selected).first(),
      ).resolves.toStrictEqual({ review_status: 'fixing' })
    },
  )

  test('rolls back status, default selection and issue resync if the target write fails', async () => {
    const testFixture = await fixture()
    const before = await testFixture.attachments()
    const trigger = `reject_review_${crypto.randomUUID().replaceAll('-', '')}`
    // Test-only storage failure injection exercises the actual native D1 transaction.
    await env.DB.prepare(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF review_status ON attachments
      WHEN OLD.id = '${testFixture.selected}' BEGIN SELECT RAISE(ABORT, 'injected review write failure'); END`).run()
    try {
      expect((await testFixture.patch({ category: 'done', isDefault: true })).status).toBe(500)
      await expect(
        env.DB.prepare('SELECT category,is_default FROM task_statuses WHERE id=?').bind(testFixture.status.id).first(),
      ).resolves.toStrictEqual({ category: 'in_progress', is_default: 0 })
      await expect(
        env.DB.prepare('SELECT is_default FROM task_statuses WHERE id=?').bind(testFixture.otherStatus.id).first(),
      ).resolves.toStrictEqual({ is_default: 1 })
      await expect(
        env.DB.prepare('SELECT status_category FROM issues WHERE id=?').bind(testFixture.issue.id).first(),
      ).resolves.toStrictEqual({
        status_category: 'in_progress',
      })
      expect((await testFixture.attachments()).results).toStrictEqual(before.results)
    } finally {
      await env.DB.prepare(`DROP TRIGGER ${trigger}`).run()
    }
  })
})
