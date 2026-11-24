import { Iterable } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { ForbiddenError, NotFoundError, ValidationError } from '#commands/errors.ts'
import { setAttachmentReviewStatus } from '#commands/files.ts'
import { updateIssue } from '#commands/issues.ts'
import type { ServiceCtx } from '#commands/types.ts'
import { findAttachment, listIssueReviewTargets } from '#services/files.ts'
import { runTestEffect } from '#tests/run-effect.ts'
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
    INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','User',1);
    INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w','Workspace','workspace',1),('other','Other','other',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w','u','member',1);
    INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES
      ('p','w','Visible','VIS',1,1),('hidden','w','Hidden','HID',1,1),('other','other','Other','OTH',1,1);
    INSERT INTO issues (id,workspace_id,project_id,number,title,status,priority,created_by_id,created_at,updated_at) VALUES
      ('i','w','p',1,'Issue','backlog','medium','u',1,1),('sibling','w','p',2,'Sibling','backlog','medium','u',1,1),
      ('hidden','w','hidden',1,'Hidden','backlog','medium','u',1,1),('other','other','other',1,'Other','backlog','medium','u',1,1);
    INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g','w','Group',1);
    INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g','u','u',1);
    INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g','p','member');
    INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,url,entity_type,entity_id,created_by_id,created_at) VALUES
      ('a','w','file','w/a','a.pdf','application/pdf',1,NULL,'issue','i','u',1),
      ('b','w','url','','Design','',0,'https://example.test','issue','i','u',1),
      ('wiki','w','wiki_ref','','Wiki','',0,NULL,'issue','i','u',1),
      ('page','w','file','w/page','page.pdf','application/pdf',1,NULL,'wiki_page','i','u',1),
      ('orphan','w','file','w/orphan','orphan.pdf','application/pdf',1,NULL,'issue','missing','u',1),
      ('hidden','w','file','w/hidden','hidden.pdf','application/pdf',1,NULL,'issue','hidden','u',1),
      ('other','other','file','other/a','other.pdf','application/pdf',1,NULL,'issue','other','u',1);
  `)
  const ctx: ServiceCtx = {
    db: database.db,
    kv: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as unknown as KVNamespace,
    r2: {} as R2Bucket,
    workspaceId: 'w',
    userId: 'u',
    role: 'member',
  }
  const set = (attachmentId: string, status: unknown, issueId = 'i') =>
    setAttachmentReviewStatus(ctx, { issueId, attachmentId, status })
  return { ...database, ctx, set }
}

describe('issue attachment review target storage and authorization', () => {
  test('defaults existing metadata to null and persists every review state, then removes selection', async () => {
    const testFixture = fixture()
    await expect(runTestEffect(findAttachment(testFixture.db, 'w', 'a'))).resolves.toMatchObject({ reviewStatus: null })
    for (const status of ['fixing', 'in_review', 'changes_requested', 'done', null]) {
      await expect(testFixture.set('a', status)).resolves.toEqual({ ok: true })
      await expect(runTestEffect(findAttachment(testFixture.db, 'w', 'a'))).resolves.toMatchObject({
        reviewStatus: status,
      })
    }
    await expect(runTestEffect(listIssueReviewTargets(testFixture.db, 'w', ['i']))).resolves.toEqual(new Map())
  })

  test('includes selected file and URL targets only and prioritizes in-review before creation/id order', async () => {
    const testFixture = fixture()
    await testFixture.set('a', 'fixing')
    await testFixture.set('b', 'in_review')
    await expect(
      runTestEffect(listIssueReviewTargets(testFixture.db, 'w', ['i', 'other', 'missing'])),
    ).resolves.toEqual(
      new Map([
        [
          'i',
          [
            { id: 'b', kind: 'url', filename: 'Design', url: 'https://example.test', status: 'in_review' },
            { id: 'a', kind: 'file', filename: 'a.pdf', url: null, status: 'fixing' },
          ],
        ],
      ]),
    )
    await testFixture.set('b', 'done')
    expect(
      (await runTestEffect(listIssueReviewTargets(testFixture.db, 'w', ['i']))).get('i')?.map((target) => target.id),
    ).toEqual(['a', 'b'])
  })

  test.each([
    ['wiki', 'i'],
    ['page', 'i'],
    ['a', 'sibling'],
    ['orphan', 'missing'],
    ['other', 'other'],
    ['hidden', 'hidden'],
  ])('rejects ineligible or unowned target %s on %s without changing selection', async (attachmentId, issueId) => {
    const testFixture = fixture()
    await expect(testFixture.set(attachmentId, 'fixing', issueId)).rejects.toBeInstanceOf(NotFoundError)
    expect(
      testFixture.sqlite.prepare('SELECT COUNT(*) AS n FROM attachments WHERE review_status IS NOT NULL').get(),
    ).toEqual({
      n: 0,
    })
  })

  test('rejects archived project mutations even for workspace admins', async () => {
    const testFixture = fixture()
    testFixture.ctx.role = 'owner'
    testFixture.sqlite.exec("UPDATE projects SET archived_at=2 WHERE id='p'")
    await expect(testFixture.set('a', 'fixing')).rejects.toBeInstanceOf(NotFoundError)
    await expect(runTestEffect(findAttachment(testFixture.db, 'w', 'a'))).resolves.toMatchObject({ reviewStatus: null })
  })

  test('rechecks current grants and forbids project viewers', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec("UPDATE group_project_grants SET role='viewer'")
    await expect(testFixture.set('a', 'fixing')).rejects.toBeInstanceOf(ForbiddenError)
    testFixture.sqlite.exec('DELETE FROM group_project_grants')
    await expect(testFixture.set('a', 'fixing')).rejects.toBeInstanceOf(NotFoundError)
  })

  test('rejects malformed review states and enforces storage eligibility', async () => {
    const testFixture = fixture()
    await expect(testFixture.set('a', 'review')).rejects.toBeInstanceOf(ValidationError)
    expect(() => testFixture.sqlite.exec("UPDATE attachments SET review_status='fixing' WHERE id='wiki'")).toThrow()
    expect(() => testFixture.sqlite.exec("UPDATE attachments SET review_status='fixing' WHERE id='page'")).toThrow()
    expect(() => testFixture.sqlite.exec("UPDATE attachments SET review_status='review' WHERE id='a'")).toThrow()
  })

  test.each(['done', 'cancelled'] as const)(
    'synchronizes selected targets when their owning issue becomes %s',
    async (status) => {
      const testFixture = fixture()
      await testFixture.set('a', 'in_review')
      await testFixture.set('b', 'changes_requested')
      testFixture.sqlite.exec(`
      INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at,review_status) VALUES
        ('sibling-target','w','file','w/sibling','sibling.pdf','application/pdf',1,'issue','sibling','u',1,'fixing');
      UPDATE attachments SET review_status='fixing' WHERE id='other';
    `)
      const attachmentCount = testFixture.sqlite.prepare('SELECT COUNT(*) AS n FROM attachments').get()
      await updateIssue(testFixture.ctx, 'i', { status })
      const expected = status === 'done' ? 'done' : null
      await expect(runTestEffect(findAttachment(testFixture.db, 'w', 'a'))).resolves.toMatchObject({
        reviewStatus: expected,
      })
      await expect(runTestEffect(findAttachment(testFixture.db, 'w', 'b'))).resolves.toMatchObject({
        reviewStatus: expected,
      })
      await expect(runTestEffect(findAttachment(testFixture.db, 'w', 'wiki'))).resolves.toMatchObject({
        reviewStatus: null,
      })
      await expect(runTestEffect(findAttachment(testFixture.db, 'w', 'sibling-target'))).resolves.toMatchObject({
        reviewStatus: 'fixing',
      })
      await expect(runTestEffect(findAttachment(testFixture.db, 'other', 'other'))).resolves.toMatchObject({
        reviewStatus: 'fixing',
      })
      expect(testFixture.sqlite.prepare('SELECT COUNT(*) AS n FROM attachments').get()).toEqual(attachmentCount)
      await updateIssue(testFixture.ctx, 'i', { status: 'todo' })
      await expect(runTestEffect(findAttachment(testFixture.db, 'w', 'a'))).resolves.toMatchObject({
        reviewStatus: expected,
      })
    },
  )

  test('closes review targets for custom done categories but leaves open status updates alone', async () => {
    const testFixture = fixture()
    const statusId = crypto.randomUUID()
    testFixture.sqlite
      .prepare(
        "INSERT INTO task_statuses (id,workspace_id,key,name,category,position,is_default) VALUES (?,'w','shipped','Shipped','done',0,0)",
      )
      .run(statusId)
    await testFixture.set('a', 'in_review')
    await updateIssue(testFixture.ctx, 'i', { status: 'in_progress' })
    await expect(runTestEffect(findAttachment(testFixture.db, 'w', 'a'))).resolves.toMatchObject({
      reviewStatus: 'in_review',
    })
    await updateIssue(testFixture.ctx, 'i', { statusId })
    await expect(runTestEffect(findAttachment(testFixture.db, 'w', 'a'))).resolves.toMatchObject({
      reviewStatus: 'done',
    })
  })

  test('keeps batched lookup below the D1 parameter ceiling and deduplicates issue ids', async () => {
    const testFixture = fixture()
    await testFixture.set('a', 'fixing')
    const bindings: number[] = []
    const bounded = new Proxy(testFixture.db, {
      get(target, key, receiver) {
        if (key !== 'prepare') {
          return Reflect.get(target, key, receiver)
        }
        return (query: string) => {
          const statement = target.prepare(query)
          return new Proxy(statement, {
            get(prepared, method, preparedReceiver) {
              if (method !== 'bind') {
                return Reflect.get(prepared, method, preparedReceiver)
              }
              return (...values: unknown[]) => {
                bindings.push(values.length)
                if (values.length > 100) {
                  throw new Error('D1 parameter budget exceeded')
                }
                return prepared.bind(...values)
              }
            },
          })
        }
      },
    })
    const ids = ['i', ...Array.from({ length: 205 }, (_, index) => `missing-${index}`), 'i']
    expect((await runTestEffect(listIssueReviewTargets(bounded, 'w', ids))).get('i')).toHaveLength(1)
    expect(bindings).toStrictEqual([100, 100, 9])
    await expect(runTestEffect(listIssueReviewTargets(bounded, 'w', []))).resolves.toEqual(new Map())
    expect(bindings).toStrictEqual([100, 100, 9])
  })
})
