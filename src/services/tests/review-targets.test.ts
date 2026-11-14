import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { ForbiddenError, NotFoundError, ValidationError } from '#commands/errors'
import { setAttachmentReviewStatus } from '#commands/files'
import { updateIssue } from '#commands/issues'
import type { ServiceCtx } from '#commands/types'

import { createTestDatabase } from '../../web/test/database'
import { findAttachment, listIssueReviewTargets } from '../files'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
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
  it('defaults existing metadata to null and persists every review state, then removes selection', async () => {
    const f = fixture()
    expect(await Effect.runPromise(findAttachment(f.db, 'w', 'a'))).toMatchObject({ reviewStatus: null })
    for (const status of ['fixing', 'in_review', 'changes_requested', 'done', null]) {
      expect(await f.set('a', status)).toEqual({ ok: true })
      expect(await Effect.runPromise(findAttachment(f.db, 'w', 'a'))).toMatchObject({ reviewStatus: status })
    }
    expect(await Effect.runPromise(listIssueReviewTargets(f.db, 'w', ['i']))).toEqual(new Map())
  })

  it('includes selected file and URL targets only and prioritizes in-review before creation/id order', async () => {
    const f = fixture()
    await f.set('a', 'fixing')
    await f.set('b', 'in_review')
    expect(await Effect.runPromise(listIssueReviewTargets(f.db, 'w', ['i', 'other', 'missing']))).toEqual(
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
    await f.set('b', 'done')
    expect(
      (await Effect.runPromise(listIssueReviewTargets(f.db, 'w', ['i']))).get('i')?.map((target) => target.id),
    ).toEqual(['a', 'b'])
  })

  it.each([
    ['wiki', 'i'],
    ['page', 'i'],
    ['a', 'sibling'],
    ['orphan', 'missing'],
    ['other', 'other'],
    ['hidden', 'hidden'],
  ])('rejects ineligible or unowned target %s on %s without changing selection', async (attachmentId, issueId) => {
    const f = fixture()
    await expect(f.set(attachmentId, 'fixing', issueId)).rejects.toBeInstanceOf(NotFoundError)
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM attachments WHERE review_status IS NOT NULL').get()).toEqual({
      n: 0,
    })
  })

  it('rejects archived project mutations even for workspace admins', async () => {
    const f = fixture()
    f.ctx.role = 'owner'
    f.sqlite.exec("UPDATE projects SET archived_at=2 WHERE id='p'")
    await expect(f.set('a', 'fixing')).rejects.toBeInstanceOf(NotFoundError)
    expect(await Effect.runPromise(findAttachment(f.db, 'w', 'a'))).toMatchObject({ reviewStatus: null })
  })

  it('rechecks current grants and forbids project viewers', async () => {
    const f = fixture()
    f.sqlite.exec("UPDATE group_project_grants SET role='viewer'")
    await expect(f.set('a', 'fixing')).rejects.toBeInstanceOf(ForbiddenError)
    f.sqlite.exec('DELETE FROM group_project_grants')
    await expect(f.set('a', 'fixing')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejects malformed review states and enforces storage eligibility', async () => {
    const f = fixture()
    await expect(f.set('a', 'review')).rejects.toBeInstanceOf(ValidationError)
    expect(() => f.sqlite.exec("UPDATE attachments SET review_status='fixing' WHERE id='wiki'")).toThrow()
    expect(() => f.sqlite.exec("UPDATE attachments SET review_status='fixing' WHERE id='page'")).toThrow()
    expect(() => f.sqlite.exec("UPDATE attachments SET review_status='review' WHERE id='a'")).toThrow()
  })

  it.each(['done', 'cancelled'] as const)(
    'synchronizes selected targets when their owning issue becomes %s',
    async (status) => {
      const f = fixture()
      await f.set('a', 'in_review')
      await f.set('b', 'changes_requested')
      f.sqlite.exec(`
      INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at,review_status) VALUES
        ('sibling-target','w','file','w/sibling','sibling.pdf','application/pdf',1,'issue','sibling','u',1,'fixing');
      UPDATE attachments SET review_status='fixing' WHERE id='other';
    `)
      const attachmentCount = f.sqlite.prepare('SELECT COUNT(*) AS n FROM attachments').get()
      await updateIssue(f.ctx, 'i', { status })
      const expected = status === 'done' ? 'done' : null
      expect(await Effect.runPromise(findAttachment(f.db, 'w', 'a'))).toMatchObject({ reviewStatus: expected })
      expect(await Effect.runPromise(findAttachment(f.db, 'w', 'b'))).toMatchObject({ reviewStatus: expected })
      expect(await Effect.runPromise(findAttachment(f.db, 'w', 'wiki'))).toMatchObject({ reviewStatus: null })
      expect(await Effect.runPromise(findAttachment(f.db, 'w', 'sibling-target'))).toMatchObject({
        reviewStatus: 'fixing',
      })
      expect(await Effect.runPromise(findAttachment(f.db, 'other', 'other'))).toMatchObject({ reviewStatus: 'fixing' })
      expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM attachments').get()).toEqual(attachmentCount)
      await updateIssue(f.ctx, 'i', { status: 'todo' })
      expect(await Effect.runPromise(findAttachment(f.db, 'w', 'a'))).toMatchObject({ reviewStatus: expected })
    },
  )

  it('closes review targets for custom done categories but leaves open status updates alone', async () => {
    const f = fixture()
    const statusId = crypto.randomUUID()
    f.sqlite
      .prepare(
        "INSERT INTO task_statuses (id,workspace_id,key,name,category,position,is_default) VALUES (?,'w','shipped','Shipped','done',0,0)",
      )
      .run(statusId)
    await f.set('a', 'in_review')
    await updateIssue(f.ctx, 'i', { status: 'in_progress' })
    expect(await Effect.runPromise(findAttachment(f.db, 'w', 'a'))).toMatchObject({ reviewStatus: 'in_review' })
    await updateIssue(f.ctx, 'i', { statusId })
    expect(await Effect.runPromise(findAttachment(f.db, 'w', 'a'))).toMatchObject({ reviewStatus: 'done' })
  })

  it('keeps batched lookup below the D1 parameter ceiling and deduplicates issue ids', async () => {
    const f = fixture()
    await f.set('a', 'fixing')
    const bindings: number[] = []
    const bounded = new Proxy(f.db, {
      get(target, key, receiver) {
        if (key !== 'prepare') return Reflect.get(target, key, receiver)
        return (query: string) => {
          const statement = target.prepare(query)
          return new Proxy(statement, {
            get(prepared, method, preparedReceiver) {
              if (method !== 'bind') return Reflect.get(prepared, method, preparedReceiver)
              return (...values: unknown[]) => {
                bindings.push(values.length)
                if (values.length > 100) throw new Error('D1 parameter budget exceeded')
                return prepared.bind(...values)
              }
            },
          })
        }
      },
    })
    const ids = ['i', ...Array.from({ length: 205 }, (_, index) => `missing-${index}`), 'i']
    expect((await Effect.runPromise(listIssueReviewTargets(bounded, 'w', ids))).get('i')).toHaveLength(1)
    expect(bindings).toEqual([100, 100, 9])
    expect(await Effect.runPromise(listIssueReviewTargets(bounded, 'w', []))).toEqual(new Map())
    expect(bindings).toEqual([100, 100, 9])
  })
})
