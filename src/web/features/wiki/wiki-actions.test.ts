import { Effect, Schema } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { loadMigrations } from '#db/test/helpers'

import { makeRequestServices, RequestServices } from '../../request'
import { createTestResources } from '../../server/test/resources'
import { createTestDatabase } from '../../test/database'
import {
  createWikiPage,
  deleteWikiAttachment,
  discardWikiDraft,
  duplicateWikiPage,
  getWikiDraft,
  getWikiPage,
  getWikiRevisionDiff,
  moveWikiPage,
  restoreTrashedWikiPage,
  restoreWikiRevision,
  saveWikiDraft,
  saveWikiPage,
  trashWikiPage,
  verifyWikiPage,
} from './actions'

type Definition = {
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
        const operation = () => undefined
        definitions.set(operation, definition)
        return operation
      },
    },
  },
}))
const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
async function fixture(
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
  for (const migration of loadMigrations()) {
    for (const statement of migration.replace(/--[^\n]*/g, '').split(';')) {
      if (/\bwiki_fts(?:_new)?\b/i.test(statement)) database.sqlite.exec(statement)
    }
  }
  database.sqlite.exec(`
    INSERT INTO workspaces (id,name,slug,created_at) VALUES ('workspace','Team','team',1),('foreign-workspace','Foreign','foreign',1);
    INSERT INTO users (id,email,name,created_at) VALUES ('user','alice@example.test','Alice',1),('other-user','other@example.test','Other',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('workspace','user','member',1);
    INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000002','workspace','Source','SRC','source',1,1);
    INSERT INTO wiki_pages (id,workspace_id,slug,title,content,created_by_id,updated_by_id,created_at,updated_at) VALUES
      ('00000000-0000-4000-8000-000000000001','workspace','guide','Guide','Body','user','user',1,1),('foreign-page','foreign-workspace','guide','Foreign Guide','Secret','user','user',1,1);
    INSERT INTO wiki_revisions (id,page_id,content,author_id,created_at) VALUES ('revision','00000000-0000-4000-8000-000000000001','Body','user',1),('foreign-revision','foreign-page','Secret','user',1);
  `)
  if (options.pageProject)
    database.sqlite
      .prepare("UPDATE wiki_pages SET project_id = ? WHERE id = '00000000-0000-4000-8000-000000000001'")
      .run(options.pageProject)
  if (options.archived)
    database.sqlite.exec("UPDATE projects SET archived_at = 2 WHERE id = '00000000-0000-4000-8000-000000000002'")
  if (options.role)
    database.sqlite.prepare("UPDATE workspace_members SET role = ? WHERE user_id = 'user'").run(options.role)
  if (options.granted || (options.pageProject && !options.archived && !options.inaccessible))
    database.sqlite.exec(`
      INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('group','workspace','Readers',1);
      INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('group','user','user',1);
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('group','00000000-0000-4000-8000-000000000002','member');
    `)
  const resources = createTestResources()
  const invalidate = vi.fn()
  const request = new Request('https://app.test/_effront/function', {
    method: 'POST',
    headers: { Origin: options.origin ?? 'https://app.test' },
  })
  const native = await Effect.runPromise(
    makeRequestServices(request, {
      DB: database.db,
      KV: resources.kv,
      R2: resources.r2,
      OAUTH_KV: resources.oauthKv,
      ENVIRONMENT: 'development',
      DEV_USER_EMAIL: 'alice@example.test',
      CF_ACCESS_TEAM_DOMAIN: '',
      CF_ACCESS_AUDIENCE: '',
    }),
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
  function run(operation: unknown, input: unknown) {
    const definition = definitions.get(operation)
    if (!definition) throw new Error('Missing operation definition')
    return Effect.runPromise(
      Schema.decodeUnknownEffect(definition.input)(input).pipe(
        Effect.flatMap((value) => definition.handler(value as never)),
        Effect.provideService(RequestServices, services),
      ),
    )
  }
  return { run, invalidate, sqlite: database.sqlite, resources }
}
describe('Wiki semantic ServerFn contracts', () => {
  it.each(['owner', 'admin', 'member'] as const)(
    'reads archived project pages, revisions and personal drafts from a workspace-only selector for %s',
    async (role) => {
      const test = await fixture({
        pageProject: '00000000-0000-4000-8000-000000000002',
        archived: true,
        role,
        granted: role === 'member',
      })
      expect(await test.run(getWikiPage, { workspaceSlug: 'team', slug: 'guide' })).toMatchObject({
        ok: true,
        value: { id: '00000000-0000-4000-8000-000000000001', project_id: '00000000-0000-4000-8000-000000000002' },
      })
      expect(
        await test.run(getWikiRevisionDiff, {
          workspaceSlug: 'team',
          slug: 'guide',
          revisionId: 'revision',
        }),
      ).toMatchObject({ ok: true, value: { diff: expect.any(String) } })
      expect(await test.run(getWikiDraft, { workspaceSlug: 'team', slug: 'guide' })).toEqual({
        ok: true,
        value: null,
      })
      expect(test.sqlite.prepare('SELECT COUNT(*) AS count FROM wiki_pages').get()).toEqual({ count: 2 })
      expect(test.invalidate).not.toHaveBeenCalled()
    },
  )
  it("does not grant an archived project's page or revision to an ungranted member", async () => {
    const test = await fixture({ pageProject: '00000000-0000-4000-8000-000000000002', archived: true })
    for (const operation of [getWikiPage, getWikiDraft, getWikiRevisionDiff]) {
      expect(await test.run(operation, { workspaceSlug: 'team', slug: 'guide', revisionId: 'revision' })).toMatchObject(
        { ok: false, status: 404 },
      )
    }
  })
  it('rejects cross-origin writes before any backend request and invalidates failed mutation scope', async () => {
    const test = await fixture({ origin: 'https://attacker.test' })
    expect(
      await test.run(saveWikiPage, {
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'Draft',
        content: 'Body',
        baseRevisionId: 'revision',
      }),
    ).toEqual({ ok: false, status: 403, message: expect.any(String) })
    expect(
      test.sqlite
        .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
        .get(),
    ).toEqual({
      title: 'Guide',
      content: 'Body',
    })
    expect(test.invalidate).toHaveBeenCalledTimes(1)
  })
  it('rejects an unauthorized workspace before constructing a backend mutation', async () => {
    const test = await fixture()
    expect(
      await test.run(saveWikiPage, {
        workspaceSlug: 'other',
        slug: 'guide',
        title: 'Draft',
        content: 'Body',
      }),
    ).toEqual({ ok: false, status: 403, message: expect.any(String) })
    expect(
      test.sqlite
        .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
        .get(),
    ).toEqual({
      title: 'Guide',
      content: 'Body',
    })
  })
  it('keeps 409 conflict revision/diff details and does not clear a personal draft after failed save', async () => {
    const test = await fixture()
    test.sqlite.exec(`
      INSERT INTO wiki_revisions (id,page_id,content,author_id,created_at) VALUES ('latest','00000000-0000-4000-8000-000000000001','Body','user',2);
      UPDATE wiki_pages SET content = 'Concurrent edit' WHERE id = '00000000-0000-4000-8000-000000000001';
      INSERT INTO wiki_drafts (id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at) VALUES ('mine','workspace','user','00000000-0000-4000-8000-000000000001','My title','Mine','revision',2);
    `)
    expect(
      await test.run(saveWikiPage, {
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'My title',
        content: 'Mine',
        baseRevisionId: 'revision',
      }),
    ).toEqual({
      ok: false,
      status: 409,
      message: 'Wiki page has been modified since baseRevisionId; rebase and retry',
      details: { currentRevisionId: 'latest', diff: '--- base\n+++ current\n@@ -1,1 +1,1 @@\n-Body\n+Concurrent edit' },
    })
    expect(
      test.sqlite.prepare("SELECT content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'").get(),
    ).toEqual({
      content: 'Concurrent edit',
    })
    expect(test.sqlite.prepare("SELECT content FROM wiki_drafts WHERE id = 'mine'").get()).toEqual({ content: 'Mine' })
    expect(test.invalidate).toHaveBeenCalledTimes(1)
  })
  it('reads a draft without invalidating and resolves the explicit authorized workspace', async () => {
    const test = await fixture()
    expect(await test.run(getWikiDraft, { workspaceSlug: 'team', slug: 'guide' })).toEqual({
      ok: true,
      value: null,
    })
    expect(test.invalidate).not.toHaveBeenCalled()
  })
  it('duplicates server-authorized content and preserves the source entity project', async () => {
    const test = await fixture({ pageProject: '00000000-0000-4000-8000-000000000002' })
    expect(await test.run(duplicateWikiPage, { workspaceSlug: 'team', slug: 'guide' })).toEqual({
      ok: true,
      value: { id: expect.any(String), slug: expect.stringMatching(/^guide-copy-/) },
    })
    expect(
      test.sqlite
        .prepare("SELECT title, content, project_id, parent_id FROM wiki_pages WHERE slug LIKE 'guide-copy-%'")
        .get(),
    ).toEqual({
      title: 'Guide (copy)',
      content: 'Body',
      project_id: '00000000-0000-4000-8000-000000000002',
      parent_id: null,
    })
    expect(test.invalidate).toHaveBeenCalledTimes(1)
  })
  it("reads the actual page DTO/revision pointer and only the current user's draft directly", async () => {
    const test = await fixture()
    expect(await test.run(getWikiPage, { workspaceSlug: 'team', slug: 'guide' })).toMatchObject({
      ok: true,
      value: { id: '00000000-0000-4000-8000-000000000001', content: 'Body', revisionId: 'revision', freshness: null },
    })
    test.sqlite.exec(
      `INSERT INTO wiki_drafts (id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at) VALUES ('mine','workspace','user','00000000-0000-4000-8000-000000000001','Mine','Personal','revision',2),('theirs','workspace','other-user','00000000-0000-4000-8000-000000000001','Secret','Private','revision',3)`,
    )
    expect(await test.run(getWikiDraft, { workspaceSlug: 'team', slug: 'guide' })).toEqual({
      ok: true,
      value: { title: 'Mine', content: 'Personal', baseRevisionId: 'revision', updatedAt: 2 },
    })
    expect(test.invalidate).not.toHaveBeenCalled()
  })
  it('re-authorizes the actual entity project rather than trusting a page selector', async () => {
    const test = await fixture({ pageProject: '00000000-0000-4000-8000-000000000002', inaccessible: true })
    for (const operation of [getWikiPage, getWikiDraft, duplicateWikiPage])
      expect(await test.run(operation, { workspaceSlug: 'team', slug: 'guide' })).toMatchObject({
        ok: false,
        status: 404,
      })
    expect(
      test.sqlite
        .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
        .get(),
    ).toEqual({
      title: 'Guide',
      content: 'Body',
    })
  })
  it('binds revision diffs and restore reads to the authorized page and workspace', async () => {
    const test = await fixture()
    test.sqlite.exec("UPDATE wiki_pages SET content = 'Current' WHERE id = '00000000-0000-4000-8000-000000000001'")
    expect(
      await test.run(getWikiRevisionDiff, {
        workspaceSlug: 'team',
        slug: 'guide',
        revisionId: 'revision',
      }),
    ).toEqual({
      ok: true,
      value: { diff: '--- base\n+++ current\n@@ -1,1 +1,1 @@\n-Body\n+Current' },
    })
    for (const operation of [getWikiRevisionDiff, restoreWikiRevision])
      expect(
        await test.run(operation, {
          workspaceSlug: 'team',
          slug: 'guide',
          revisionId: 'foreign-revision',
          baseRevisionId: 'revision',
        }),
      ).toMatchObject({ ok: false, status: 404 })
    expect(
      test.sqlite.prepare("SELECT content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'").get(),
    ).toEqual({
      content: 'Current',
    })
    expect(
      await test.run(restoreWikiRevision, {
        workspaceSlug: 'team',
        slug: 'guide',
        revisionId: 'revision',
        baseRevisionId: 'revision',
      }),
    ).toEqual({ ok: true, value: { ok: true } })
    expect(
      test.sqlite.prepare("SELECT content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'").get(),
    ).toEqual({ content: 'Body' })
    expect(
      test.sqlite
        .prepare(
          "SELECT summary FROM wiki_revisions WHERE page_id = '00000000-0000-4000-8000-000000000001' ORDER BY rowid DESC LIMIT 1",
        )
        .get(),
    ).toEqual({
      summary: 'Restored from revision dated 1970-01-01T00:00:01.000Z',
    })
  })
  it.each([
    [createWikiPage, { title: 'New', slug: 'new-page' }],
    [duplicateWikiPage, { slug: 'guide' }],
    [saveWikiPage, { slug: 'guide', title: 'New', content: 'New', baseRevisionId: 'revision' }],
    [saveWikiDraft, { slug: 'guide', title: 'Draft', content: 'Draft' }],
    [discardWikiDraft, { slug: 'guide' }],
    [moveWikiPage, { slug: 'guide', parentId: null }],
    [verifyWikiPage, { slug: 'guide' }],
    [trashWikiPage, { slug: 'guide' }],
    [restoreTrashedWikiPage, { pageId: '00000000-0000-4000-8000-000000000001' }],
    [restoreWikiRevision, { slug: 'guide', revisionId: 'revision', baseRevisionId: 'revision' }],
    [deleteWikiAttachment, { attachmentId: 'attachment' }],
  ])('checks same-origin before the explicit command and invalidates failures %#', async (operation, input) => {
    const test = await fixture({ origin: 'https://attacker.test' })
    expect(await test.run(operation, { workspaceSlug: 'team', ...input })).toMatchObject({ ok: false, status: 403 })
    expect(
      test.sqlite
        .prepare(
          "SELECT title, content, deleted_at, version FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'",
        )
        .get(),
    ).toEqual({ title: 'Guide', content: 'Body', deleted_at: null, version: 0 })
    expect(test.invalidate).toHaveBeenCalledTimes(1)
  })
  it.each(['public', 'pk'] as const)('does not grant browser mutation capabilities to %s principals', async (auth) => {
    const test = await fixture({ auth })
    expect(
      await test.run(saveWikiPage, { workspaceSlug: 'team', slug: 'guide', title: 'New', content: 'New' }),
    ).toMatchObject({ ok: false, status: 403 })
    expect(
      test.sqlite.prepare("SELECT content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'").get(),
    ).toEqual({ content: 'Body' })
  })
  it('publishes canonical content through real commands and clears only the current user draft', async () => {
    const test = await fixture()
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Wiki must not use HTTP'))
    expect(
      await test.run(saveWikiDraft, {
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'Draft',
        content: 'Mine',
        baseRevisionId: 'revision',
      }),
    ).toMatchObject({
      ok: true,
      value: { ok: true, pageId: '00000000-0000-4000-8000-000000000001', updatedAt: expect.any(Number) },
    })
    test.sqlite.exec(
      "INSERT INTO wiki_drafts (id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at) VALUES ('theirs','workspace','other-user','00000000-0000-4000-8000-000000000001','Secret','Private','revision',3)",
    )
    expect(
      await test.run(saveWikiPage, {
        workspaceSlug: 'team',
        slug: 'guide',
        title: 'Published',
        content: '## Canonical\n\n**Body**',
        baseRevisionId: 'revision',
      }),
    ).toEqual({ ok: true, value: { ok: true } })
    expect(await test.run(getWikiPage, { workspaceSlug: 'team', slug: 'guide' })).toMatchObject({
      ok: true,
      value: { title: 'Published', content: '## Canonical\n\n**Body**', revisionId: expect.any(String) },
    })
    expect(test.sqlite.prepare('SELECT user_id, content FROM wiki_drafts').all()).toEqual([
      { user_id: 'other-user', content: 'Private' },
    ])
    expect(fetch).not.toHaveBeenCalled()
    expect(test.invalidate).toHaveBeenCalledTimes(2)
  })
  it('moves, verifies, cascades trash and restores real wiki records', async () => {
    const test = await fixture({ role: 'owner' })
    expect(
      await test.run(createWikiPage, {
        workspaceSlug: 'team',
        title: 'Child',
        slug: 'child',
        parentId: '00000000-0000-4000-8000-000000000001',
        content: 'Child body',
      }),
    ).toMatchObject({ ok: true, value: { id: expect.any(String), slug: 'child' } })
    expect(await test.run(moveWikiPage, { workspaceSlug: 'team', slug: 'child', parentId: null })).toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(test.sqlite.prepare("SELECT parent_id FROM wiki_pages WHERE slug = 'child'").get()).toEqual({
      parent_id: null,
    })
    expect(
      await test.run(moveWikiPage, {
        workspaceSlug: 'team',
        slug: 'child',
        parentId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(await test.run(verifyWikiPage, { workspaceSlug: 'team', slug: 'guide' })).toMatchObject({
      ok: true,
      value: { ok: true, verifiedBy: 'alice@example.test', verifiedAt: expect.any(Number) },
    })
    expect(
      test.sqlite.prepare("SELECT content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'").get(),
    ).toEqual({
      content: expect.stringContaining('verified_by: alice@example.test'),
    })
    expect(await test.run(trashWikiPage, { workspaceSlug: 'team', slug: 'guide' })).toMatchObject({
      ok: true,
      value: { ok: true, deletedCount: 2 },
    })
    expect(await test.run(getWikiPage, { workspaceSlug: 'team', slug: 'guide' })).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(
      await test.run(restoreTrashedWikiPage, { workspaceSlug: 'team', pageId: '00000000-0000-4000-8000-000000000001' }),
    ).toMatchObject({
      ok: true,
      value: { ok: true, id: '00000000-0000-4000-8000-000000000001', slug: 'guide', restoredCount: 2 },
    })
  })
  it('enforces actual mutation project permissions and workspace selectors', async () => {
    const hidden = await fixture({ pageProject: '00000000-0000-4000-8000-000000000002', inaccessible: true })
    expect(
      await hidden.run(saveWikiPage, { workspaceSlug: 'team', slug: 'guide', title: 'Hidden', content: 'Hidden' }),
    ).toMatchObject({ ok: false, status: 404 })
    expect(
      await hidden.run(createWikiPage, {
        workspaceSlug: 'team',
        projectId: '00000000-0000-4000-8000-000000000002',
        slug: 'new-page',
        title: 'New',
      }),
    ).toMatchObject({ ok: false, status: 404 })
    const viewer = await fixture({ role: 'viewer' })
    expect(
      await viewer.run(saveWikiPage, { workspaceSlug: 'team', slug: 'guide', title: 'New', content: 'New' }),
    ).toMatchObject({ ok: false, status: 403 })
  })
  it('deletes visible attachment metadata and native R2 objects while hiding foreign and ungranted owners', async () => {
    const test = await fixture()
    test.sqlite.exec(
      "INSERT INTO attachments (id,workspace_id,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at) VALUES ('mine','workspace','objects/mine','mine.txt','text/plain',4,'wiki_page','00000000-0000-4000-8000-000000000001','user',1),('foreign','foreign-workspace','objects/foreign','foreign.txt','text/plain',4,'wiki_page','foreign-page','user',1)",
    )
    const remove = vi.spyOn(test.resources.r2, 'delete')
    expect(await test.run(deleteWikiAttachment, { workspaceSlug: 'team', attachmentId: 'foreign' })).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(remove).not.toHaveBeenCalled()
    expect(await test.run(deleteWikiAttachment, { workspaceSlug: 'team', attachmentId: 'mine' })).toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(remove).toHaveBeenCalledWith('objects/mine')
    expect(test.sqlite.prepare('SELECT id FROM attachments').all()).toEqual([{ id: 'foreign' }])
    const hidden = await fixture({ pageProject: '00000000-0000-4000-8000-000000000002', inaccessible: true })
    hidden.sqlite.exec(
      "INSERT INTO attachments (id,workspace_id,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at) VALUES ('hidden','workspace','objects/hidden','hidden.txt','text/plain',4,'wiki_page','00000000-0000-4000-8000-000000000001','user',1)",
    )
    expect(await hidden.run(deleteWikiAttachment, { workspaceSlug: 'team', attachmentId: 'hidden' })).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(hidden.sqlite.prepare('SELECT id FROM attachments').all()).toEqual([{ id: 'hidden' }])
  })
  it('rejects mutually-exclusive template/content before reaching the request handler', async () => {
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
      test.sqlite
        .prepare("SELECT title, content FROM wiki_pages WHERE id = '00000000-0000-4000-8000-000000000001'")
        .get(),
    ).toEqual({
      title: 'Guide',
      content: 'Body',
    })
  })
})
