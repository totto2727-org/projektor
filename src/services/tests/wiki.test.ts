import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { eq, isNull, or } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { ServiceCtx } from '#commands/types.ts'
import * as apiWiki from '#commands/wiki.ts'
import { schema } from '#db'
import { migratedDb } from '#db/test/helpers.ts'
import { DataQueryError } from '#services/errors.ts'
import * as wiki from '#services/wiki.ts'
import { runTestEffect } from '#tests/run-effect.ts'

const readDatabase = function readDatabase(sqlite: DatabaseSync): D1Database {
  const prepare = function prepare(query: string, bindings: SQLInputValue[] = []) {
    return {
      bind: (...values: SQLInputValue[]) => prepare(query, values),
      all: async () => ({ results: sqlite.prepare(query).all(...bindings) }),
      raw: async () =>
        sqlite
          .prepare(query)
          .all(...bindings)
          .map((row) => Object.values(row)),
      first: async () => sqlite.prepare(query).get(...bindings) ?? null,
    }
  }
  return { prepare } as unknown as D1Database
}

const wikiReadFixture = function wikiReadFixture(): { sqlite: DatabaseSync; db: D1Database } {
  const sqlite = migratedDb()
  sqlite.exec(`
	 INSERT INTO workspaces(id,name,slug,created_at) VALUES ('wa','A','alpha',1),('wb','B','beta',1);
	 INSERT INTO users(id,email,name,created_at) VALUES ('u','u@example.com','User',1),('v','v@example.com','Other',1);
	 INSERT INTO projects(id,workspace_id,name,key,created_at,updated_at) VALUES ('pa','wa','Project','PA',1,1),('pb','wb','Foreign','PB',1,1);
	 INSERT INTO wiki_pages(id,workspace_id,slug,title,content,created_by_id,updated_by_id,created_at,updated_at,tags,owners,type,status,verify_interval,project_id,is_template,deleted_at,parent_id) VALUES
	 ('root','wa','root','Alpha','Root content','u','u',1,10,'["ops"]','["u"]','runbook',NULL,NULL,NULL,0,NULL,NULL),
	 ('child','wa','child','Beta','Child content','u','u',1,20,'["ops","dev"]','[]','guide',NULL,1,'pa',0,NULL,'root'),
	 ('template','wa','template','Template','Template content','u','u',1,30,'[]','[]','runbook',NULL,NULL,NULL,1,NULL,NULL),
	 ('trash','wa','trash','Trash','Trash content','u','u',1,40,'[]','[]',NULL,'stale',NULL,NULL,0,50,NULL),
	 ('foreign','wb','foreign','Foreign','Foreign content','u','u',1,50,'[]','[]',NULL,NULL,NULL,'pb',0,NULL,NULL);
	 INSERT INTO wiki_redirects(id,workspace_id,old_slug,page_id,created_at) VALUES ('redirect','wa','old-root','root',1),('bad','wa','cross-tenant','foreign',1);
	 INSERT INTO wiki_revisions(id,page_id,content,author_id,created_at,title,summary) VALUES
	 ('r1','root','Before','u',100,'Old','first'),('r2','root','After','u',100,'New','second'),('rf','foreign','Secret','u',100,'Hidden','foreign');
	 INSERT INTO wiki_drafts(id,workspace_id,page_id,user_id,title,content,updated_at) VALUES ('d','wa','root','u','Draft','Draft text',90);
	`)
  return { sqlite, db: readDatabase(sqlite) }
}

describe('pure wiki reads', () => {
  let sqlite: DatabaseSync
  let db: D1Database
  beforeEach(() => ({ sqlite, db } = wikiReadFixture()))
  afterEach(() => sqlite.close())

  test('preserves list metadata projection, JSON decoding, filters and template exclusion', async () => {
    const rows = await runTestEffect(wiki.listWikiPages(db, 'wa'))
    expect(rows.map((row) => row.id)).toStrictEqual(['root', 'child'])
    expect(rows[0]).toStrictEqual({
      id: 'root',
      is_template: false,
      owners: ['u'],
      parent_id: null,
      project_id: null,
      slug: 'root',
      status: null,
      tags: ['ops'],
      title: 'Alpha',
      type: 'runbook',
      updated_at: 10,
      verified_at: null,
      verified_by: null,
      verify_interval: null,
    })
    await expect(
      runTestEffect(wiki.listWikiPages(db, 'wa', { type: 'guide', tags: ['dev'], parentId: 'root' })),
    ).resolves.toHaveLength(1)
    await expect(runTestEffect(wiki.listWikiPages(db, 'wa', { tags: ['none'] }))).resolves.toStrictEqual([])
    await expect(runTestEffect(wiki.listWikiPages(db, 'wa', { includeTemplates: true }))).resolves.toHaveLength(3)
  })

  test('accepts app-authorized visibility and includes workspace pages only when requested', async () => {
    const visibility = or(isNull(schema.wikiPages.projectId), eq(schema.wikiPages.projectId, 'other'))
    expect((await runTestEffect(wiki.listWikiPages(db, 'wa', { visibility }))).map((r) => r.id)).toStrictEqual(['root'])
    expect(
      (await runTestEffect(wiki.listWikiTreeRows(db, 'wa', { projectId: 'pa', includeWorkspacePages: true }))).map(
        (r) => r.id,
      ),
    ).toStrictEqual(['root', 'child', 'template'])
    const projectTree = await runTestEffect(wiki.listWikiTreeRows(db, 'wa', { projectId: 'pa' }))
    expect(projectTree.map((row) => row.id)).toStrictEqual(['child'])
  })

  test('resolves id before colliding slug and live pages before redirects, excludes trash and foreign targets', async () => {
    const result = await runTestEffect(wiki.findWikiPage(db, 'wa', 'old-root'))
    expect(result?.content).toBe('Root content')
    await expect(runTestEffect(wiki.findWikiPage(db, 'wa', 'cross-tenant'))).resolves.toBeUndefined()
    await expect(runTestEffect(wiki.findWikiPage(db, 'wa', 'trash'))).resolves.toBeUndefined()
    await expect(runTestEffect(wiki.findWikiPage(db, 'wa', 'foreign'))).resolves.toBeUndefined()
    sqlite.exec(
      "UPDATE wiki_pages SET slug='new-root' WHERE id='root'; UPDATE wiki_pages SET slug='root' WHERE id='child';",
    )
    const resolvedValue = await runTestEffect(wiki.findWikiPage(db, 'wa', 'root'))
    expect(resolvedValue?.id).toBe('root')
    sqlite.exec("UPDATE wiki_pages SET slug='old-root' WHERE id='child';")
    expect((await runTestEffect(wiki.findWikiPage(db, 'wa', 'old-root')))?.id).toBe('child')
  })

  test('preserves maintenance/trash/template filtering and pagination without presentation fields', async () => {
    expect(
      (await runTestEffect(wiki.listStaleWikiPages(db, 'wa', { now: 100, limit: 10, offset: 0 }))).map((r) => r.id),
    ).toStrictEqual(['child'])
    expect((await runTestEffect(wiki.listWikiTemplates(db, 'wa'))).map((r) => r.id)).toStrictEqual(['template'])
    const trash = await runTestEffect(wiki.listWikiTrash(db, 'wa', { limit: 10, offset: 0 }))
    expect(trash).toStrictEqual([
      {
        deleted_at: 50,
        id: 'trash',
        parent_id: null,
        project_id: null,
        slug: 'trash',
        title: 'Trash',
      },
    ])
    await expect(runTestEffect(wiki.listWikiTrash(db, 'wa', { limit: 10, offset: 1 }))).resolves.toStrictEqual([])
  })

  test('orders same-second revisions by rowid and scopes every revision query to the workspace/page', async () => {
    expect((await runTestEffect(wiki.listWikiRevisions(db, 'wa', 'root'))).map((r) => r.id)).toStrictEqual(['r2', 'r1'])
    await expect(runTestEffect(wiki.getLatestWikiRevisionId(db, 'wa', 'root'))).resolves.toBe('r2')
    await expect(runTestEffect(wiki.getWikiRevision(db, 'wa', 'root', 'r1'))).resolves.toStrictEqual({
      author_id: 'u',
      content: 'Before',
      created_at: 100,
      id: 'r1',
      summary: 'first',
      title: 'Old',
    })
    await expect(runTestEffect(wiki.listWikiRevisions(db, 'wa', 'foreign'))).resolves.toStrictEqual([])
    await expect(runTestEffect(wiki.getWikiRevision(db, 'wa', 'foreign', 'rf'))).resolves.toBeUndefined()
    await expect(runTestEffect(wiki.getLatestWikiRevisionId(db, 'wa', 'foreign'))).resolves.toBeNull()
  })

  test('isolates drafts by workspace, user and page', async () => {
    await expect(runTestEffect(wiki.getWikiDraft(db, 'wa', 'root', 'u'))).resolves.toStrictEqual({
      baseRevisionId: null,
      content: 'Draft text',
      title: 'Draft',
      updatedAt: 90,
    })
    await expect(runTestEffect(wiki.getWikiDraft(db, 'wa', 'root', 'v'))).resolves.toBeNull()
    await expect(runTestEffect(wiki.getWikiDraft(db, 'wb', 'root', 'u'))).resolves.toBeNull()
  })

  test('keeps FTS weighting, stable paging, JSON mapping, templates/trash exclusion and permission fragments', async () => {
    sqlite.exec(
      "CREATE VIRTUAL TABLE wiki_fts USING fts5(page_id UNINDEXED, workspace_id UNINDEXED, title, content, tags); INSERT INTO wiki_fts(page_id,workspace_id,title,content,tags) SELECT id,workspace_id,title,'needle',tags FROM wiki_pages;",
    )
    const opts = { now: 100, limit: 10, offset: 0 }
    const rows = await runTestEffect(wiki.searchWiki(db, 'wa', 'needle*', opts))
    expect(rows.map((row) => row.id).sort()).toStrictEqual(['child', 'root'])
    expect(rows.find((row) => row.id === 'root')?.owners).toStrictEqual(['u'])
    const restricted = await runTestEffect(
      wiki.searchWiki(db, 'wa', 'needle*', {
        ...opts,
        visibilitySql: { sql: 'p.project_id IS NULL', params: [] },
      }),
    )
    expect(restricted.map((r) => r.id)).toStrictEqual(['root'])
    const noMatch = await runTestEffect(wiki.searchWiki(db, 'wa', 'needle*', { ...opts, tags: ['none'] }))
    expect(noMatch).toStrictEqual([])
    const one = await runTestEffect(wiki.searchWiki(db, 'wa', 'needle*', { ...opts, limit: 1 }))
    const two = await runTestEffect(wiki.searchWiki(db, 'wa', 'needle*', { ...opts, limit: 1, offset: 1 }))
    expect([one[0].id, two[0].id]).toStrictEqual(rows.map((row) => row.id))
  })

  test('is lazy and reports database failures as typed DataQueryError', async () => {
    const broken = {
      prepare: () => {
        throw new Error('database unavailable')
      },
    } as unknown as D1Database
    const query = wiki.listWikiPages(broken, 'wa')
    await expect(runTestEffect(query)).rejects.toBeInstanceOf(DataQueryError)
  })

  test('keeps API list, template, trash and tree contracts while sharing the DB read', async () => {
    const ctx = { db, workspaceId: 'wa', userId: 'u', role: 'owner' } as ServiceCtx
    const rows = await runTestEffect(wiki.listWikiPages(db, 'wa'))
    await expect(apiWiki.listWikiPages(ctx, {})).resolves.toStrictEqual(
      rows.map((row) => ({ ...row, url: `/wiki/${row.slug}` })),
    )
    await expect(apiWiki.listWikiTemplates(ctx, {})).resolves.toStrictEqual([
      {
        id: 'template',
        project_id: null,
        slug: 'template',
        title: 'Template',
        type: 'runbook',
        url: '/wiki/template',
      },
    ])
    await expect(apiWiki.listWikiTrash(ctx, {})).resolves.toStrictEqual([
      {
        id: 'trash',
        slug: 'trash',
        title: 'Trash',
        parent_id: null,
        project_id: null,
        deleted_at: 50,
        purgeAfter: 50 + apiWiki.WIKI_TRASH_RETENTION_SECONDS,
      },
    ])
    await expect(apiWiki.getWikiTree(ctx)).resolves.toStrictEqual([
      {
        children: [
          {
            children: [],
            id: 'child',
            slug: 'child',
            title: 'Beta',
            type: 'guide',
            url: '/wiki/child',
          },
        ],
        id: 'root',
        slug: 'root',
        title: 'Alpha',
        type: 'runbook',
        url: '/wiki/root',
      },
      {
        children: [],
        id: 'template',
        slug: 'template',
        title: 'Template',
        type: 'runbook',
        url: '/wiki/template',
      },
    ])
  })

  test('preserves detail redirect extras, revision contracts and API not-found errors', async () => {
    const ctx = { db, workspaceId: 'wa', userId: 'u', role: 'owner' } as ServiceCtx
    const detail = await runTestEffect(wiki.findWikiPage(db, 'wa', 'root'))
    await expect(apiWiki.getWikiPage(ctx, 'root')).resolves.toStrictEqual({
      ...detail,
      revisionId: 'r2',
      url: '/wiki/root',
      freshness: null,
    })
    await expect(apiWiki.getWikiPage(ctx, 'old-root')).resolves.toHaveProperty('version', 0)
    await expect(apiWiki.listWikiRevisions(ctx, 'old-root')).resolves.toStrictEqual(
      await runTestEffect(wiki.listWikiRevisions(db, 'wa', 'root')),
    )
    await expect(apiWiki.getWikiRevision(ctx, 'old-root', 'r1')).resolves.toStrictEqual(
      await runTestEffect(wiki.getWikiRevision(db, 'wa', 'root', 'r1')),
    )
    await expect(apiWiki.getWikiPage(ctx, 'foreign')).rejects.toMatchObject({
      message: 'Wiki page not found',
    })
    await expect(apiWiki.getWikiRevision(ctx, 'root', 'rf')).rejects.toMatchObject({
      message: 'Revision not found',
    })
    await expect(apiWiki.getWikiRevisionDiff(ctx, 'root', 'r1', { against: 'r2' })).resolves.toStrictEqual({
      diff: '--- base\n+++ current\n@@ -1,1 +1,1 @@\n-Before\n+After',
      from: 'r1',
      to: 'r2',
    })
  })

  test('leaves validation, project authorization and search freshness in the API', async () => {
    const ctx = { db, workspaceId: 'wa', userId: 'u', role: 'viewer' } as ServiceCtx
    expect((await apiWiki.listWikiPages(ctx, {})).map((r) => r.id)).toStrictEqual(['root'])
    await expect(apiWiki.getWikiPage(ctx, 'child')).rejects.toMatchObject({
      message: 'Wiki page not found',
    })
    await expect(apiWiki.listWikiPages(ctx, { projectId: 'not-a-uuid' })).rejects.toMatchObject({
      kind: 'validation',
    })
    sqlite.exec(
      "CREATE VIRTUAL TABLE wiki_fts USING fts5(page_id UNINDEXED, workspace_id UNINDEXED, title, content, tags); INSERT INTO wiki_fts(page_id,workspace_id,title,content,tags) SELECT id,workspace_id,title,'needle',tags FROM wiki_pages;",
    )
    await expect(apiWiki.searchWiki(ctx, { query: 'needle' })).resolves.toStrictEqual([
      expect.objectContaining({ freshness: null, id: 'root', owners: ['u'], tags: ['ops'] }),
    ])
    await expect(apiWiki.listStaleWikiPages(ctx, {})).resolves.toStrictEqual([])
  })

  test('keeps bounded unified diff behavior for unchanged content, contextual hunks and huge pages', () => {
    expect(apiWiki.buildUnifiedDiff).toBe(wiki.buildUnifiedDiff)
    expect(wiki.buildUnifiedDiff('same', 'same')).toBe('')
    expect(wiki.buildUnifiedDiff('one\ntwo\nthree', 'one\nnew\nthree')).toBe(
      '--- base\n+++ current\n@@ -1,3 +1,3 @@\n one\n-two\n+new\n three',
    )
    const huge = Array.from({ length: 1001 }, () => 'old').join('\n')
    expect(wiki.buildUnifiedDiff(huge, huge.replaceAll('old', 'new'))).toContain('@@ -1,1001 +1,1001 @@')
  })
})
