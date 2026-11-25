import { Iterable, Effect, Schema } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { SQL_NULL } from '#db/sql-null.ts'
import { JSON_NULL } from '#tests/json-null.ts'
import { runTestEffect, runInOrder } from '#tests/run-effect.ts'
import { sqliteRowFields, sqliteRowsFields } from '#tests/sqlite-records.ts'
import { RequestServices } from '@/request.ts'

import {
  createWikiPage,
  deleteWikiAttachment,
  discardWikiDraft,
  duplicateWikiPage,
  getWikiDraft,
  getWikiDraftState,
  getWikiPage,
  getWikiRevisionDiff,
  moveWikiPage,
  restoreTrashedWikiPage,
  restoreWikiRevision,
  saveWikiDraft,
  saveWikiPage,
  trashWikiPage,
  verifyWikiPage,
} from './actions.ts'
import { createWikiActionEnvironment } from './test/action-environment.ts'
import type { WikiActionDatabase, WikiActionOptions } from './test/action-environment.ts'

const wikiPageInput = function wikiPageInput(
  workspaceSlug: string,
  slug: string,
): { slug: string; workspaceSlug: string } {
  return fieldsInOrder([
    ['workspaceSlug', workspaceSlug],
    ['slug', slug],
  ])
}

interface Definition {
  input: Schema.Decoder<unknown>
  handler: (input: never) => Effect.Effect<unknown, unknown, RequestServices>
}
const definitions = vi.hoisted(() => new Map<unknown, Definition>())
vi.mock(import('@effront/core/workers'), async () => {
  const { Effect: fixtureEffect } = await import('effect')
  return { getWorkersRequestContext: () => fixtureEffect.die('No Workers runtime in handler unit tests') }
})
vi.mock('../../effront', () => ({
  EFFRONT: {
    ServerFn: {
      make: (definition: Definition) => {
        const operation = (): undefined => undefined
        definitions.set(operation, definition)
        return operation
      },
    },
  },
}))
const readGuideContent = function readGuideContent(
  sqlite: WikiActionDatabase['sqlite'],
): ReturnType<typeof sqliteRowFields> {
  const row = sqlite.prepare("SELECT content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'").get()
  return sqliteRowFields(row)
}

const databases: WikiActionDatabase[] = []
const fixture = async function fixture(options: WikiActionOptions = {}) {
  const { database, invalidate, resources, services } = await createWikiActionEnvironment(databases, options)
  const run = function run(operation: unknown, input: unknown): Promise<unknown> {
    const definition = definitions.get(operation)
    if (!definition) {
      throw new Error('Missing operation definition')
    }
    return runTestEffect(
      Schema.decodeUnknownEffect(definition.input)(input).pipe(
        Effect.flatMap((value) => definition.handler(value as never)),
        Effect.provideService(RequestServices, services),
      ),
    )
  }
  return { run, invalidate, sqlite: database.sqlite, resources }
}
describe('wiki semantic ServerFn contracts', () => {
  afterEach(() => {
    Iterable.forEach(databases.splice(0), (database) => {
      database.close()
    })
  })

  test('requires browser draft preconditions and returns conflicts without altering a newer draft', async () => {
    expect.hasAssertions()
    const { run, sqlite } = await fixture()
    await expect(
      run(saveWikiDraft, { ...wikiPageInput('team', 'guide'), title: 'Missing token', content: 'No write' }),
    ).rejects.toThrow('["expectedDraftRevision"]')
    expect(sqliteRowFields(sqlite.prepare('SELECT count(*) AS count FROM wiki_drafts').get())).toStrictEqual({
      count: 0,
    })
    await expect(run(getWikiDraftState, wikiPageInput('team', 'guide'))).resolves.toStrictEqual({
      ok: true,
      value: { draft: JSON_NULL, revision: JSON_NULL },
    })
    await run(saveWikiDraft, {
      ...wikiPageInput('team', 'guide'),
      title: 'Newer',
      content: 'Keep B',
      expectedDraftRevision: JSON_NULL,
    })
    const head = sqlite.prepare('SELECT revision FROM wiki_draft_heads').get()?.revision
    await runInOrder([saveWikiDraft, discardWikiDraft, saveWikiPage], async (operation): Promise<void> => {
      await expect(
        run(operation, {
          ...wikiPageInput('team', 'guide'),
          title: 'Stale',
          content: 'Late A',
          baseRevisionId: 'revision',
          expectedDraftRevision: JSON_NULL,
        }),
      ).resolves.toMatchObject({ ok: false, status: 409 })
    })
    await expect(run(getWikiDraftState, wikiPageInput('team', 'guide'))).resolves.toMatchObject({
      ok: true,
      value: { revision: head, draft: { content: 'Keep B' } },
    })
    expect(
      sqliteRowFields(
        sqlite.prepare('SELECT content FROM wiki_pages WHERE slug = ? AND workspace_id = ?').get('guide', 'workspace'),
      ),
    ).toStrictEqual({ content: 'Body' })
  })

  test.each(['owner', 'admin', 'member'] as const)(
    'reads archived project pages, revisions and personal drafts from a workspace-only selector for %s',
    async (role) => {
      const testFixture = await fixture({
        pageProject: '00000000-0000-4000-8000-000000000002',
        archived: true,
        role,
        granted: role === 'member',
      })
      await expect(testFixture.run(getWikiPage, wikiPageInput('team', 'guide'))).resolves.toMatchObject({
        ok: true,
        value: { id: '00000000-0000-4000-8000-000000000001', project_id: '00000000-0000-4000-8000-000000000002' },
      })
      await expect(
        testFixture.run(getWikiRevisionDiff, { ...wikiPageInput('team', 'guide'), revisionId: 'revision' }),
      ).resolves.toMatchObject({ ok: true, value: { diff: expect.any(String) } })
      await expect(testFixture.run(getWikiDraft, wikiPageInput('team', 'guide'))).resolves.toStrictEqual({
        ok: true,
        value: JSON_NULL,
      })
      expect(
        sqliteRowFields(testFixture.sqlite.prepare('SELECT COUNT(*) AS count FROM wiki_pages').get()),
      ).toStrictEqual({
        count: 2,
      })
      expect(testFixture.invalidate).not.toHaveBeenCalled()
    },
  )

  test("does not grant an archived project's page or revision to an ungranted member", async () => {
    expect.hasAssertions()
    const testFixture = await fixture({ archived: true, pageProject: '00000000-0000-4000-8000-000000000002' })
    await runInOrder([getWikiPage, getWikiDraft, getWikiRevisionDiff], async (operation): Promise<void> => {
      await expect(
        testFixture.run(operation, { ...wikiPageInput('team', 'guide'), revisionId: 'revision' }),
      ).resolves.toMatchObject({ ok: false, status: 404 })
    })
  })

  test('rejects cross-origin writes before any backend request and invalidates failed mutation scope', async () => {
    const testFixture = await fixture({ origin: 'https://attacker.test' })
    await expect(
      testFixture.run(saveWikiPage, {
        expectedDraftRevision: JSON_NULL,
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'Draft',
        content: 'Body',
        baseRevisionId: 'revision',
      }),
    ).resolves.toStrictEqual({ message: expect.any(String), ok: false, status: 403 })
    expect(
      sqliteRowFields(
        testFixture.sqlite
          .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
          .get(),
      ),
    ).toStrictEqual({
      content: 'Body',
      title: 'Guide',
    })
    expect(testFixture.invalidate).toHaveBeenCalledOnce()
  })

  test('rejects an unauthorized workspace before constructing a backend mutation', async () => {
    const testFixture = await fixture()
    await expect(
      testFixture.run(saveWikiPage, {
        expectedDraftRevision: JSON_NULL,
        workspaceSlug: 'other',
        slug: 'guide',
        title: 'Draft',
        content: 'Body',
      }),
    ).resolves.toStrictEqual({ message: expect.any(String), ok: false, status: 403 })
    expect(
      sqliteRowFields(
        testFixture.sqlite
          .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
          .get(),
      ),
    ).toStrictEqual({
      content: 'Body',
      title: 'Guide',
    })
  })

  test('keeps 409 conflict revision/diff details and does not clear a personal draft after failed save', async () => {
    const testFixture = await fixture()
    testFixture.sqlite.exec(`
      INSERT INTO wiki_revisions (id,page_id,content,author_id,created_at) VALUES ('latest','00000000-0000-4000-8000-000000000001','Body','user',2);
      UPDATE wiki_pages SET content = 'Concurrent edit' WHERE id = '00000000-0000-4000-8000-000000000001';
      INSERT INTO wiki_drafts (id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at) VALUES ('mine','workspace','user','00000000-0000-4000-8000-000000000001','My title','Mine','revision',2);
    `)
    await expect(
      testFixture.run(saveWikiPage, {
        expectedDraftRevision: JSON_NULL,
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'My title',
        content: 'Mine',
        baseRevisionId: 'revision',
      }),
    ).resolves.toStrictEqual({
      details: { currentRevisionId: 'latest', diff: '--- base\n+++ current\n@@ -1,1 +1,1 @@\n-Body\n+Concurrent edit' },
      message: 'Wiki page has been modified since baseRevisionId; rebase and retry',
      ok: false,
      status: 409,
    })
    expect(readGuideContent(testFixture.sqlite)).toStrictEqual({
      content: 'Concurrent edit',
    })
    expect(
      sqliteRowFields(testFixture.sqlite.prepare("SELECT content FROM wiki_drafts WHERE id = 'mine'").get()),
    ).toStrictEqual({ content: 'Mine' })
    expect(testFixture.invalidate).toHaveBeenCalledOnce()
  })

  test('reads a draft without invalidating and resolves the explicit authorized workspace', async () => {
    const testFixture = await fixture()
    await expect(testFixture.run(getWikiDraft, wikiPageInput('team', 'guide'))).resolves.toStrictEqual({
      ok: true,
      value: JSON_NULL,
    })
    expect(testFixture.invalidate).not.toHaveBeenCalled()
  })

  test('duplicates server-authorized content and preserves the source entity project', async () => {
    const testFixture = await fixture({ pageProject: '00000000-0000-4000-8000-000000000002' })
    await expect(testFixture.run(duplicateWikiPage, wikiPageInput('team', 'guide'))).resolves.toStrictEqual({
      ok: true,
      value: { id: expect.any(String), slug: expect.stringMatching(/^guide-copy-/u) },
    })
    expect(
      sqliteRowFields(
        testFixture.sqlite
          .prepare("SELECT title, content, project_id, parent_id FROM wiki_pages WHERE slug LIKE 'guide-copy-%'")
          .get(),
      ),
    ).toStrictEqual({
      content: 'Body',
      parent_id: SQL_NULL,
      project_id: '00000000-0000-4000-8000-000000000002',
      title: 'Guide (copy)',
    })
    expect(testFixture.invalidate).toHaveBeenCalledOnce()
  })

  test("reads the actual page DTO/revision pointer and only the current user's draft directly", async () => {
    const testFixture = await fixture()
    await expect(testFixture.run(getWikiPage, wikiPageInput('team', 'guide'))).resolves.toMatchObject({
      ok: true,
      value: {
        content: 'Body',
        freshness: JSON_NULL,
        id: '00000000-0000-4000-8000-000000000001',
        revisionId: 'revision',
      },
    })
    testFixture.sqlite.exec(
      `INSERT INTO wiki_drafts (id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at) VALUES ('mine','workspace','user','00000000-0000-4000-8000-000000000001','Mine','Personal','revision',2),('theirs','workspace','other-user','00000000-0000-4000-8000-000000000001','Secret','Private','revision',3)`,
    )
    await expect(testFixture.run(getWikiDraft, wikiPageInput('team', 'guide'))).resolves.toStrictEqual({
      ok: true,
      value: { baseRevisionId: 'revision', content: 'Personal', title: 'Mine', updatedAt: 2 },
    })
    expect(testFixture.invalidate).not.toHaveBeenCalled()
  })

  test('re-authorizes the actual entity project rather than trusting a page selector', async () => {
    expect.hasAssertions()
    const testFixture = await fixture({ inaccessible: true, pageProject: '00000000-0000-4000-8000-000000000002' })
    await runInOrder([getWikiPage, getWikiDraft, duplicateWikiPage], async (operation): Promise<void> => {
      await expect(testFixture.run(operation, wikiPageInput('team', 'guide'))).resolves.toMatchObject({
        ok: false,
        status: 404,
      })
    })
    expect(
      sqliteRowFields(
        testFixture.sqlite
          .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
          .get(),
      ),
    ).toStrictEqual({
      content: 'Body',
      title: 'Guide',
    })
  })

  test('binds revision diffs and restore reads to the authorized page and workspace', async () => {
    expect.hasAssertions()
    const testFixture = await fixture()
    testFixture.sqlite.exec(
      "UPDATE wiki_pages SET content = 'Current' WHERE id = '00000000-0000-4000-8000-000000000001'",
    )
    await expect(
      testFixture.run(getWikiRevisionDiff, { ...wikiPageInput('team', 'guide'), revisionId: 'revision' }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { diff: '--- base\n+++ current\n@@ -1,1 +1,1 @@\n-Body\n+Current' },
    })
    await runInOrder([getWikiRevisionDiff, restoreWikiRevision], async (operation): Promise<void> => {
      await expect(
        testFixture.run(operation, {
          ...wikiPageInput('team', 'guide'),
          revisionId: 'foreign-revision',
          baseRevisionId: 'revision',
        }),
      ).resolves.toMatchObject({ ok: false, status: 404 })
    })
    expect(readGuideContent(testFixture.sqlite)).toStrictEqual({
      content: 'Current',
    })
    await expect(
      testFixture.run(restoreWikiRevision, {
        ...wikiPageInput('team', 'guide'),
        revisionId: 'revision',
        baseRevisionId: 'revision',
      }),
    ).resolves.toStrictEqual({ ok: true, value: { ok: true } })
    expect(readGuideContent(testFixture.sqlite)).toStrictEqual({ content: 'Body' })
    expect(
      sqliteRowFields(
        testFixture.sqlite
          .prepare(
            "SELECT summary FROM wiki_revisions WHERE page_id = '00000000-0000-4000-8000-000000000001' ORDER BY rowid DESC LIMIT 1",
          )
          .get(),
      ),
    ).toStrictEqual({
      summary: 'Restored from revision dated 1970-01-01T00:00:01.000Z',
    })
  })

  test.each([
    [createWikiPage, { title: 'New', slug: 'new-page' }],
    [duplicateWikiPage, { slug: 'guide' }],
    [
      saveWikiPage,
      { expectedDraftRevision: JSON_NULL, slug: 'guide', title: 'New', content: 'New', baseRevisionId: 'revision' },
    ],
    [saveWikiDraft, { expectedDraftRevision: JSON_NULL, slug: 'guide', title: 'Draft', content: 'Draft' }],
    [discardWikiDraft, { expectedDraftRevision: JSON_NULL, slug: 'guide' }],
    [moveWikiPage, { slug: 'guide', parentId: JSON_NULL }],
    [verifyWikiPage, { slug: 'guide' }],
    [trashWikiPage, { slug: 'guide' }],
    [restoreTrashedWikiPage, { pageId: '00000000-0000-4000-8000-000000000001' }],
    [restoreWikiRevision, { slug: 'guide', revisionId: 'revision', baseRevisionId: 'revision' }],
    [deleteWikiAttachment, { attachmentId: 'attachment' }],
  ])('checks same-origin before the explicit command and invalidates failures %#', async (operation, input) => {
    const testFixture = await fixture({ origin: 'https://attacker.test' })
    await expect(testFixture.run(operation, { workspaceSlug: 'team', ...input })).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    expect(
      sqliteRowFields(
        testFixture.sqlite
          .prepare(
            "SELECT title, content, deleted_at, version FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'",
          )
          .get(),
      ),
    ).toStrictEqual({ content: 'Body', deleted_at: SQL_NULL, title: 'Guide', version: 0 })
    expect(testFixture.invalidate).toHaveBeenCalledOnce()
  })

  test.each(['public', 'pk'] as const)(
    'does not grant browser mutation capabilities to %s principals',
    async (auth) => {
      const testFixture = await fixture({ auth })
      await expect(
        testFixture.run(saveWikiPage, {
          expectedDraftRevision: JSON_NULL,
          workspaceSlug: 'team',
          slug: 'guide',
          title: 'New',
          content: 'New',
        }),
      ).resolves.toMatchObject({ ok: false, status: 403 })
      expect(readGuideContent(testFixture.sqlite)).toStrictEqual({ content: 'Body' })
    },
  )

  test('publishes canonical content through real commands and clears only the current user draft', async () => {
    const testFixture = await fixture()
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Wiki must not use HTTP'))
    await expect(
      testFixture.run(saveWikiDraft, {
        expectedDraftRevision: JSON_NULL,
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'Draft',
        content: 'Mine',
        baseRevisionId: 'revision',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { ok: true, pageId: '00000000-0000-4000-8000-000000000001', updatedAt: expect.any(Number) },
    })
    testFixture.sqlite.exec(
      "INSERT INTO wiki_drafts (id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at) VALUES ('theirs','workspace','other-user','00000000-0000-4000-8000-000000000001','Secret','Private','revision',3)",
    )
    await expect(
      testFixture.run(saveWikiPage, {
        expectedDraftRevision: testFixture.sqlite.prepare('SELECT revision FROM wiki_draft_heads').get()?.revision,
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'Published',
        content: '## Canonical\n\n**Body**',
        baseRevisionId: 'revision',
      }),
    ).resolves.toEqual({ ok: true, value: { draftRevision: expect.any(String), ok: true } })
    await expect(testFixture.run(getWikiPage, wikiPageInput('team', 'guide'))).resolves.toMatchObject({
      ok: true,
      value: { content: '## Canonical\n\n**Body**', revisionId: expect.any(String), title: 'Published' },
    })
    expect(
      sqliteRowsFields(testFixture.sqlite.prepare('SELECT user_id, content FROM wiki_drafts').all()),
    ).toStrictEqual([{ content: 'Private', user_id: 'other-user' }])
    expect(fetch).not.toHaveBeenCalled()
    expect(testFixture.invalidate).toHaveBeenCalledTimes(2)
  })

  test('moves, verifies, cascades trash and restores real wiki records', async () => {
    const testFixture = await fixture({ role: 'owner' })
    await expect(
      testFixture.run(createWikiPage, {
        workspaceSlug: 'team',
        title: 'Child',
        slug: 'child',
        parentId: '00000000-0000-4000-8000-000000000001',
        content: 'Child body',
      }),
    ).resolves.toMatchObject({ ok: true, value: { id: expect.any(String), slug: 'child' } })
    await expect(
      testFixture.run(moveWikiPage, { ...wikiPageInput('team', 'child'), parentId: JSON_NULL }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { ok: true },
    })
    expect(
      sqliteRowFields(testFixture.sqlite.prepare("SELECT parent_id FROM wiki_pages WHERE slug = 'child'").get()),
    ).toStrictEqual({
      parent_id: SQL_NULL,
    })
    await expect(
      testFixture.run(moveWikiPage, {
        ...wikiPageInput('team', 'child'),
        parentId: '00000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { ok: true },
    })
    await expect(testFixture.run(verifyWikiPage, wikiPageInput('team', 'guide'))).resolves.toMatchObject({
      ok: true,
      value: { ok: true, verifiedAt: expect.any(Number), verifiedBy: 'alice@example.test' },
    })
    expect(readGuideContent(testFixture.sqlite)).toStrictEqual({
      content: expect.stringContaining('verified_by: alice@example.test'),
    })
    await expect(testFixture.run(trashWikiPage, wikiPageInput('team', 'guide'))).resolves.toMatchObject({
      ok: true,
      value: { deletedCount: 2, ok: true },
    })
    await expect(testFixture.run(getWikiPage, wikiPageInput('team', 'guide'))).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
    await expect(
      testFixture.run(restoreTrashedWikiPage, {
        workspaceSlug: 'team',
        pageId: '00000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { id: '00000000-0000-4000-8000-000000000001', ok: true, restoredCount: 2, slug: 'guide' },
    })
  })

  test('enforces actual mutation project permissions and workspace selectors', async () => {
    const hidden = await fixture({ inaccessible: true, pageProject: '00000000-0000-4000-8000-000000000002' })
    await expect(
      hidden.run(saveWikiPage, {
        expectedDraftRevision: JSON_NULL,
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'Hidden',
        content: 'Hidden',
      }),
    ).resolves.toMatchObject({ ok: false, status: 404 })
    await expect(
      hidden.run(createWikiPage, {
        workspaceSlug: 'team',
        projectId: '00000000-0000-4000-8000-000000000002',
        slug: 'new-page',
        title: 'New',
      }),
    ).resolves.toMatchObject({ ok: false, status: 404 })
    const viewer = await fixture({ role: 'viewer' })
    await expect(
      viewer.run(saveWikiPage, {
        expectedDraftRevision: JSON_NULL,
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'New',
        content: 'New',
      }),
    ).resolves.toMatchObject({ ok: false, status: 403 })
  })

  test('deletes visible attachment metadata and native R2 objects while hiding foreign and ungranted owners', async () => {
    const testFixture = await fixture()
    testFixture.sqlite.exec(
      "INSERT INTO attachments (id,workspace_id,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at) VALUES ('mine','workspace','objects/mine','mine.txt','text/plain',4,'wiki_page','00000000-0000-4000-8000-000000000001','user',1),('foreign','foreign-workspace','objects/foreign','foreign.txt','text/plain',4,'wiki_page','foreign-page','user',1)",
    )
    const remove = vi.spyOn(testFixture.resources.r2, 'delete')
    await expect(
      testFixture.run(deleteWikiAttachment, { workspaceSlug: 'team', attachmentId: 'foreign' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
    expect(remove).not.toHaveBeenCalled()
    await expect(
      testFixture.run(deleteWikiAttachment, { workspaceSlug: 'team', attachmentId: 'mine' }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { ok: true },
    })
    expect(remove).toHaveBeenCalledWith('objects/mine')
    expect(sqliteRowsFields(testFixture.sqlite.prepare('SELECT id FROM attachments').all())).toStrictEqual([
      { id: 'foreign' },
    ])
    const hidden = await fixture({ inaccessible: true, pageProject: '00000000-0000-4000-8000-000000000002' })
    hidden.sqlite.exec(
      "INSERT INTO attachments (id,workspace_id,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at) VALUES ('hidden','workspace','objects/hidden','hidden.txt','text/plain',4,'wiki_page','00000000-0000-4000-8000-000000000001','user',1)",
    )
    await expect(
      hidden.run(deleteWikiAttachment, { workspaceSlug: 'team', attachmentId: 'hidden' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
    expect(sqliteRowsFields(hidden.sqlite.prepare('SELECT id FROM attachments').all())).toStrictEqual([
      { id: 'hidden' },
    ])
  })

  test('rejects mutually-exclusive template/content before reaching the request handler', async () => {
    const testFixture = await fixture()
    await expect(
      testFixture.run(createWikiPage, {
        workspaceSlug: 'team',
        title: 'Guide',
        slug: 'guide',
        content: 'Body',
        templateSlug: 'template',
      }),
    ).rejects.toThrow('Choose template or content, not both.')
    expect(
      sqliteRowFields(
        testFixture.sqlite
          .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
          .get(),
      ),
    ).toStrictEqual({
      content: 'Body',
      title: 'Guide',
    })
  })
})
