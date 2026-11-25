import { Iterable, Effect, Schema } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { loadMigrations } from '#db/test/helpers.ts'
import { runTestEffect } from '#tests/run-effect.ts'
import { sqliteRowFields, sqliteRowsFields } from '#tests/sqlite-records.ts'
import { makeRequestServices, RequestServices } from '@/request.ts'
import { createTestResources, testEnvironment } from '@/server/test/resources.ts'
import { createTestDatabase } from '@/test/database.ts'

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

interface Definition {
  input: Schema.Decoder<unknown>
  handler: (input: never) => Effect.Effect<unknown, unknown, RequestServices>
}
const definitions = vi.hoisted(() => new Map<unknown, Definition>())
vi.mock('@effront/core/workers', async () => {
  const { Effect } = await import('effect')
  return { getWorkersRequestContext: () => Effect.die('No Workers runtime in handler unit tests') }
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
  sqlite: ReturnType<typeof createTestDatabase>['sqlite'],
): ReturnType<typeof sqliteRowFields> {
  const row = sqlite.prepare("SELECT content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'").get()
  return sqliteRowFields(row)
}

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  Iterable.forEach(databases.splice(0), (database) => {
    database.close()
  })
})
const fixture = async function fixture(
  options: {
    origin?: string
    pageProject?: string
    inaccessible?: boolean
    archived?: boolean
    role?: 'owner' | 'admin' | 'member' | 'viewer'
    granted?: boolean
    auth?: 'dev' | 'public' | 'pk'
  } = {},
) {
  const database = createTestDatabase()
  databases.push(database)
  // The shared relational fixture skips FTS-dependent migrations for portability.
  // Wiki commands exercise real FTS5 here using those exact maintained statements.
  Iterable.forEach(loadMigrations(), (migration) => {
    Iterable.forEach(migration.replaceAll(/--[^\n]*/g, '').split(';'), (statement) => {
      if (/\bwiki_fts(?:_new)?\b/i.test(statement)) {
        database.sqlite.exec(statement)
      }
    })
  })
  database.sqlite.exec(`
    INSERT INTO workspaces (id,name,slug,created_at) VALUES ('workspace','Team','team',1),('foreign-workspace','Foreign','foreign',1);
    INSERT INTO users (id,email,name,created_at) VALUES ('user','alice@example.test','Alice',1),('other-user','other@example.test','Other',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('workspace','user','member',1);
    INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000002','workspace','Source','SRC','source',1,1);
    INSERT INTO wiki_pages (id,workspace_id,slug,title,content,created_by_id,updated_by_id,created_at,updated_at) VALUES
      ('00000000-0000-4000-8000-000000000001','workspace','guide','Guide','Body','user','user',1,1),('foreign-page','foreign-workspace','guide','Foreign Guide','Secret','user','user',1,1);
    INSERT INTO wiki_revisions (id,page_id,content,author_id,created_at) VALUES ('revision','00000000-0000-4000-8000-000000000001','Body','user',1),('foreign-revision','foreign-page','Secret','user',1);
  `)
  if (isNonEmptyText(options.pageProject)) {
    database.sqlite
      .prepare("UPDATE wiki_pages SET project_id = ? WHERE id = '00000000-0000-4000-8000-000000000001'")
      .run(options.pageProject)
  }
  if (options.archived === true) {
    database.sqlite.exec("UPDATE projects SET archived_at = 2 WHERE id = '00000000-0000-4000-8000-000000000002'")
  }
  if (options.role) {
    database.sqlite.prepare("UPDATE workspace_members SET role = ? WHERE user_id = 'user'").run(options.role)
  }
  if (
    options.granted === true ||
    (isNonEmptyText(options.pageProject) && options.archived !== true && options.inaccessible !== true)
  ) {
    database.sqlite.exec(`
      INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('group','workspace','Readers',1);
      INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('group','user','user',1);
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('group','00000000-0000-4000-8000-000000000002','member');
    `)
  }
  const resources = createTestResources()
  const invalidate = vi.fn()
  const request = new Request('https://app.test/_effront/function', {
    method: 'POST',
    headers: { Origin: options.origin ?? 'https://app.test' },
  })
  const native = await runTestEffect(
    makeRequestServices(
      request,
      testEnvironment(database.db, 'alice@example.test', {
        KV: resources.kv,
        R2: resources.r2,
        OAUTH_KV: resources.oauthKv,
      }),
    ),
  )
  const services = {
    ...native,
    scope: (selection?: Parameters<typeof native.scope>[0]) =>
      native
        .scope(selection)
        .pipe(
          Effect.map((scope) =>
            options.auth && options.auth !== 'dev'
              ? { ...scope, auth: { kind: 'human' as const, method: options.auth } }
              : scope,
          ),
        ),
    invalidate: native.invalidate.pipe(Effect.andThen(Effect.sync(invalidate))),
  }
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
  test('requires browser draft preconditions and returns conflicts without altering a newer draft', async () => {
    const test = await fixture()
    await expect(
      test.run(saveWikiDraft, { workspaceSlug: 'team', slug: 'guide', title: 'Missing token', content: 'No write' }),
    ).rejects.toThrow()
    expect(sqliteRowFields(test.sqlite.prepare('SELECT count(*) AS count FROM wiki_drafts').get())).toStrictEqual({
      count: 0,
    })
    await expect(test.run(getWikiDraftState, { workspaceSlug: 'team', slug: 'guide' })).resolves.toStrictEqual({
      ok: true,
      value: { draft: null, revision: null },
    })
    await test.run(saveWikiDraft, {
      workspaceSlug: 'team',
      slug: 'guide',
      title: 'Newer',
      content: 'Keep B',
      expectedDraftRevision: null,
    })
    const head = test.sqlite.prepare('SELECT revision FROM wiki_draft_heads').get()?.revision
    for (const operation of [saveWikiDraft, discardWikiDraft, saveWikiPage]) {
      await expect(
        test.run(operation, {
          workspaceSlug: 'team',
          slug: 'guide',
          title: 'Stale',
          content: 'Late A',
          baseRevisionId: 'revision',
          expectedDraftRevision: null,
        }),
      ).resolves.toMatchObject({ ok: false, status: 409 })
    }
    await expect(test.run(getWikiDraftState, { workspaceSlug: 'team', slug: 'guide' })).resolves.toMatchObject({
      ok: true,
      value: { revision: head, draft: { content: 'Keep B' } },
    })
    expect(
      sqliteRowFields(
        test.sqlite
          .prepare('SELECT content FROM wiki_pages WHERE slug = ? AND workspace_id = ?')
          .get('guide', 'workspace'),
      ),
    ).toStrictEqual({ content: 'Body' })
  })

  test.each(['owner', 'admin', 'member'] as const)(
    'reads archived project pages, revisions and personal drafts from a workspace-only selector for %s',
    async (role) => {
      const test = await fixture({
        pageProject: '00000000-0000-4000-8000-000000000002',
        archived: true,
        role,
        granted: role === 'member',
      })
      await expect(test.run(getWikiPage, { workspaceSlug: 'team', slug: 'guide' })).resolves.toMatchObject({
        ok: true,
        value: { id: '00000000-0000-4000-8000-000000000001', project_id: '00000000-0000-4000-8000-000000000002' },
      })
      await expect(
        test.run(getWikiRevisionDiff, {
          workspaceSlug: 'team',
          slug: 'guide',
          revisionId: 'revision',
        }),
      ).resolves.toMatchObject({ ok: true, value: { diff: expect.any(String) } })
      await expect(test.run(getWikiDraft, { workspaceSlug: 'team', slug: 'guide' })).resolves.toStrictEqual({
        ok: true,
        value: null,
      })
      expect(sqliteRowFields(test.sqlite.prepare('SELECT COUNT(*) AS count FROM wiki_pages').get())).toStrictEqual({
        count: 2,
      })
      expect(test.invalidate).not.toHaveBeenCalled()
    },
  )

  test("does not grant an archived project's page or revision to an ungranted member", async () => {
    const test = await fixture({ archived: true, pageProject: '00000000-0000-4000-8000-000000000002' })
    for (const operation of [getWikiPage, getWikiDraft, getWikiRevisionDiff]) {
      await expect(
        test.run(operation, { workspaceSlug: 'team', slug: 'guide', revisionId: 'revision' }),
      ).resolves.toMatchObject({ ok: false, status: 404 })
    }
  })

  test('rejects cross-origin writes before any backend request and invalidates failed mutation scope', async () => {
    const test = await fixture({ origin: 'https://attacker.test' })
    await expect(
      test.run(saveWikiPage, {
        expectedDraftRevision: null,
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'Draft',
        content: 'Body',
        baseRevisionId: 'revision',
      }),
    ).resolves.toStrictEqual({ message: expect.any(String), ok: false, status: 403 })
    expect(
      sqliteRowFields(
        test.sqlite
          .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
          .get(),
      ),
    ).toStrictEqual({
      content: 'Body',
      title: 'Guide',
    })
    expect(test.invalidate).toHaveBeenCalledOnce()
  })

  test('rejects an unauthorized workspace before constructing a backend mutation', async () => {
    const test = await fixture()
    await expect(
      test.run(saveWikiPage, {
        expectedDraftRevision: null,
        workspaceSlug: 'other',
        slug: 'guide',
        title: 'Draft',
        content: 'Body',
      }),
    ).resolves.toStrictEqual({ message: expect.any(String), ok: false, status: 403 })
    expect(
      sqliteRowFields(
        test.sqlite
          .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
          .get(),
      ),
    ).toStrictEqual({
      content: 'Body',
      title: 'Guide',
    })
  })

  test('keeps 409 conflict revision/diff details and does not clear a personal draft after failed save', async () => {
    const test = await fixture()
    test.sqlite.exec(`
      INSERT INTO wiki_revisions (id,page_id,content,author_id,created_at) VALUES ('latest','00000000-0000-4000-8000-000000000001','Body','user',2);
      UPDATE wiki_pages SET content = 'Concurrent edit' WHERE id = '00000000-0000-4000-8000-000000000001';
      INSERT INTO wiki_drafts (id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at) VALUES ('mine','workspace','user','00000000-0000-4000-8000-000000000001','My title','Mine','revision',2);
    `)
    await expect(
      test.run(saveWikiPage, {
        expectedDraftRevision: null,
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
    expect(readGuideContent(test.sqlite)).toStrictEqual({
      content: 'Concurrent edit',
    })
    expect(
      sqliteRowFields(test.sqlite.prepare("SELECT content FROM wiki_drafts WHERE id = 'mine'").get()),
    ).toStrictEqual({ content: 'Mine' })
    expect(test.invalidate).toHaveBeenCalledOnce()
  })

  test('reads a draft without invalidating and resolves the explicit authorized workspace', async () => {
    const test = await fixture()
    await expect(test.run(getWikiDraft, { workspaceSlug: 'team', slug: 'guide' })).resolves.toStrictEqual({
      ok: true,
      value: null,
    })
    expect(test.invalidate).not.toHaveBeenCalled()
  })

  test('duplicates server-authorized content and preserves the source entity project', async () => {
    const test = await fixture({ pageProject: '00000000-0000-4000-8000-000000000002' })
    await expect(test.run(duplicateWikiPage, { workspaceSlug: 'team', slug: 'guide' })).resolves.toStrictEqual({
      ok: true,
      value: { id: expect.any(String), slug: expect.stringMatching(/^guide-copy-/u) },
    })
    expect(
      sqliteRowFields(
        test.sqlite
          .prepare("SELECT title, content, project_id, parent_id FROM wiki_pages WHERE slug LIKE 'guide-copy-%'")
          .get(),
      ),
    ).toStrictEqual({
      content: 'Body',
      parent_id: null,
      project_id: '00000000-0000-4000-8000-000000000002',
      title: 'Guide (copy)',
    })
    expect(test.invalidate).toHaveBeenCalledOnce()
  })

  test("reads the actual page DTO/revision pointer and only the current user's draft directly", async () => {
    const test = await fixture()
    await expect(test.run(getWikiPage, { workspaceSlug: 'team', slug: 'guide' })).resolves.toMatchObject({
      ok: true,
      value: { content: 'Body', freshness: null, id: '00000000-0000-4000-8000-000000000001', revisionId: 'revision' },
    })
    test.sqlite.exec(
      `INSERT INTO wiki_drafts (id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at) VALUES ('mine','workspace','user','00000000-0000-4000-8000-000000000001','Mine','Personal','revision',2),('theirs','workspace','other-user','00000000-0000-4000-8000-000000000001','Secret','Private','revision',3)`,
    )
    await expect(test.run(getWikiDraft, { workspaceSlug: 'team', slug: 'guide' })).resolves.toStrictEqual({
      ok: true,
      value: { baseRevisionId: 'revision', content: 'Personal', title: 'Mine', updatedAt: 2 },
    })
    expect(test.invalidate).not.toHaveBeenCalled()
  })

  test('re-authorizes the actual entity project rather than trusting a page selector', async () => {
    const test = await fixture({ inaccessible: true, pageProject: '00000000-0000-4000-8000-000000000002' })
    for (const operation of [getWikiPage, getWikiDraft, duplicateWikiPage]) {
      await expect(test.run(operation, { workspaceSlug: 'team', slug: 'guide' })).resolves.toMatchObject({
        ok: false,
        status: 404,
      })
    }
    expect(
      sqliteRowFields(
        test.sqlite
          .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
          .get(),
      ),
    ).toStrictEqual({
      content: 'Body',
      title: 'Guide',
    })
  })

  test('binds revision diffs and restore reads to the authorized page and workspace', async () => {
    const test = await fixture()
    test.sqlite.exec("UPDATE wiki_pages SET content = 'Current' WHERE id = '00000000-0000-4000-8000-000000000001'")
    await expect(
      test.run(getWikiRevisionDiff, {
        workspaceSlug: 'team',
        slug: 'guide',
        revisionId: 'revision',
      }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { diff: '--- base\n+++ current\n@@ -1,1 +1,1 @@\n-Body\n+Current' },
    })
    for (const operation of [getWikiRevisionDiff, restoreWikiRevision]) {
      await expect(
        test.run(operation, {
          workspaceSlug: 'team',
          slug: 'guide',
          revisionId: 'foreign-revision',
          baseRevisionId: 'revision',
        }),
      ).resolves.toMatchObject({ ok: false, status: 404 })
    }
    expect(readGuideContent(test.sqlite)).toStrictEqual({
      content: 'Current',
    })
    await expect(
      test.run(restoreWikiRevision, {
        workspaceSlug: 'team',
        slug: 'guide',
        revisionId: 'revision',
        baseRevisionId: 'revision',
      }),
    ).resolves.toStrictEqual({ ok: true, value: { ok: true } })
    expect(readGuideContent(test.sqlite)).toStrictEqual({ content: 'Body' })
    expect(
      sqliteRowFields(
        test.sqlite
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
      { expectedDraftRevision: null, slug: 'guide', title: 'New', content: 'New', baseRevisionId: 'revision' },
    ],
    [saveWikiDraft, { expectedDraftRevision: null, slug: 'guide', title: 'Draft', content: 'Draft' }],
    [discardWikiDraft, { expectedDraftRevision: null, slug: 'guide' }],
    [moveWikiPage, { slug: 'guide', parentId: null }],
    [verifyWikiPage, { slug: 'guide' }],
    [trashWikiPage, { slug: 'guide' }],
    [restoreTrashedWikiPage, { pageId: '00000000-0000-4000-8000-000000000001' }],
    [restoreWikiRevision, { slug: 'guide', revisionId: 'revision', baseRevisionId: 'revision' }],
    [deleteWikiAttachment, { attachmentId: 'attachment' }],
  ])('checks same-origin before the explicit command and invalidates failures %#', async (operation, input) => {
    const test = await fixture({ origin: 'https://attacker.test' })
    await expect(test.run(operation, { workspaceSlug: 'team', ...input })).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    expect(
      sqliteRowFields(
        test.sqlite
          .prepare(
            "SELECT title, content, deleted_at, version FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'",
          )
          .get(),
      ),
    ).toStrictEqual({ content: 'Body', deleted_at: null, title: 'Guide', version: 0 })
    expect(test.invalidate).toHaveBeenCalledOnce()
  })

  test.each(['public', 'pk'] as const)(
    'does not grant browser mutation capabilities to %s principals',
    async (auth) => {
      const test = await fixture({ auth })
      await expect(
        test.run(saveWikiPage, {
          expectedDraftRevision: null,
          workspaceSlug: 'team',
          slug: 'guide',
          title: 'New',
          content: 'New',
        }),
      ).resolves.toMatchObject({ ok: false, status: 403 })
      expect(readGuideContent(test.sqlite)).toStrictEqual({ content: 'Body' })
    },
  )

  test('publishes canonical content through real commands and clears only the current user draft', async () => {
    const test = await fixture()
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Wiki must not use HTTP'))
    await expect(
      test.run(saveWikiDraft, {
        expectedDraftRevision: null,
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
    test.sqlite.exec(
      "INSERT INTO wiki_drafts (id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at) VALUES ('theirs','workspace','other-user','00000000-0000-4000-8000-000000000001','Secret','Private','revision',3)",
    )
    await expect(
      test.run(saveWikiPage, {
        expectedDraftRevision: test.sqlite.prepare('SELECT revision FROM wiki_draft_heads').get()?.revision,
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'Published',
        content: '## Canonical\n\n**Body**',
        baseRevisionId: 'revision',
      }),
    ).resolves.toEqual({ ok: true, value: { draftRevision: expect.any(String), ok: true } })
    await expect(test.run(getWikiPage, { workspaceSlug: 'team', slug: 'guide' })).resolves.toMatchObject({
      ok: true,
      value: { content: '## Canonical\n\n**Body**', revisionId: expect.any(String), title: 'Published' },
    })
    expect(sqliteRowsFields(test.sqlite.prepare('SELECT user_id, content FROM wiki_drafts').all())).toStrictEqual([
      { content: 'Private', user_id: 'other-user' },
    ])
    expect(fetch).not.toHaveBeenCalled()
    expect(test.invalidate).toHaveBeenCalledTimes(2)
  })

  test('moves, verifies, cascades trash and restores real wiki records', async () => {
    const test = await fixture({ role: 'owner' })
    await expect(
      test.run(createWikiPage, {
        workspaceSlug: 'team',
        title: 'Child',
        slug: 'child',
        parentId: '00000000-0000-4000-8000-000000000001',
        content: 'Child body',
      }),
    ).resolves.toMatchObject({ ok: true, value: { id: expect.any(String), slug: 'child' } })
    await expect(
      test.run(moveWikiPage, { workspaceSlug: 'team', slug: 'child', parentId: null }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { ok: true },
    })
    expect(
      sqliteRowFields(test.sqlite.prepare("SELECT parent_id FROM wiki_pages WHERE slug = 'child'").get()),
    ).toStrictEqual({
      parent_id: null,
    })
    await expect(
      test.run(moveWikiPage, {
        workspaceSlug: 'team',
        slug: 'child',
        parentId: '00000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { ok: true },
    })
    await expect(test.run(verifyWikiPage, { workspaceSlug: 'team', slug: 'guide' })).resolves.toMatchObject({
      ok: true,
      value: { ok: true, verifiedAt: expect.any(Number), verifiedBy: 'alice@example.test' },
    })
    expect(readGuideContent(test.sqlite)).toStrictEqual({
      content: expect.stringContaining('verified_by: alice@example.test'),
    })
    await expect(test.run(trashWikiPage, { workspaceSlug: 'team', slug: 'guide' })).resolves.toMatchObject({
      ok: true,
      value: { deletedCount: 2, ok: true },
    })
    await expect(test.run(getWikiPage, { workspaceSlug: 'team', slug: 'guide' })).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
    await expect(
      test.run(restoreTrashedWikiPage, { workspaceSlug: 'team', pageId: '00000000-0000-4000-8000-000000000001' }),
    ).resolves.toMatchObject({
      ok: true,
      value: { id: '00000000-0000-4000-8000-000000000001', ok: true, restoredCount: 2, slug: 'guide' },
    })
  })

  test('enforces actual mutation project permissions and workspace selectors', async () => {
    const hidden = await fixture({ inaccessible: true, pageProject: '00000000-0000-4000-8000-000000000002' })
    await expect(
      hidden.run(saveWikiPage, {
        expectedDraftRevision: null,
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
        expectedDraftRevision: null,
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'New',
        content: 'New',
      }),
    ).resolves.toMatchObject({ ok: false, status: 403 })
  })

  test('deletes visible attachment metadata and native R2 objects while hiding foreign and ungranted owners', async () => {
    const test = await fixture()
    test.sqlite.exec(
      "INSERT INTO attachments (id,workspace_id,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at) VALUES ('mine','workspace','objects/mine','mine.txt','text/plain',4,'wiki_page','00000000-0000-4000-8000-000000000001','user',1),('foreign','foreign-workspace','objects/foreign','foreign.txt','text/plain',4,'wiki_page','foreign-page','user',1)",
    )
    const remove = vi.spyOn(test.resources.r2, 'delete')
    await expect(
      test.run(deleteWikiAttachment, { workspaceSlug: 'team', attachmentId: 'foreign' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
    expect(remove).not.toHaveBeenCalled()
    await expect(
      test.run(deleteWikiAttachment, { workspaceSlug: 'team', attachmentId: 'mine' }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { ok: true },
    })
    expect(remove).toHaveBeenCalledWith('objects/mine')
    expect(sqliteRowsFields(test.sqlite.prepare('SELECT id FROM attachments').all())).toStrictEqual([{ id: 'foreign' }])
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
    const test = await fixture()
    await expect(
      test.run(createWikiPage, {
        workspaceSlug: 'team',
        title: 'Guide',
        slug: 'guide',
        content: 'Body',
        templateSlug: 'template',
      }),
    ).rejects.toThrow()
    expect(
      sqliteRowFields(
        test.sqlite
          .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
          .get(),
      ),
    ).toStrictEqual({
      content: 'Body',
      title: 'Guide',
    })
  })
})
