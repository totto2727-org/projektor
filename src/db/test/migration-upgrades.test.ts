import { readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vite-plus/test'

import { loadMigrations } from './helpers'

// These are offline, explicitly approved fixture mappings, not a production repair
// algorithm. Execute complete historical files, including FTS, without rewriting SQL
// or simulating an Alchemy ledger. Node SQLite does not prove native D1 atomicity.
const pageId = 'abcdef12-0000-4000-8000-000000000001'
const migrations = loadMigrations()
const filenames = readdirSync(new URL('../../../migrations/', import.meta.url))
  .filter((file) => file.endsWith('.sql'))
  .sort()

function seedWorkspace(db: DatabaseSync) {
  db.exec(`INSERT INTO workspaces(id,name,slug,created_at) VALUES ('w','Workspace','workspace',0);
    INSERT INTO users(id,email,name,created_at) VALUES ('u','user@example.invalid','User',0);`)
  // No owner membership: historical template seeds must not create unrelated pages.
}

function seedWiki(db: DatabaseSync, slugs: readonly string[]) {
  const insert = db.prepare(`INSERT INTO wiki_pages
    (id,workspace_id,slug,title,content,created_by_id,updated_by_id,created_at,updated_at)
    VALUES (?,?,?,?,'searchneedle','u','u',?,?)`)
  for (const [index, slug] of slugs.entries()) {
    insert.run(index === 0 ? pageId : `other-${index}`, 'w', slug, `Page ${index}`, index, index)
  }
  db.exec(`INSERT INTO wiki_revisions(id,page_id,content,author_id,created_at)
    VALUES ('revision','${pageId}','original content','u',0)`)
  if (db.prepare("SELECT name FROM sqlite_master WHERE name='wiki_fts'").get()) {
    db.exec(`INSERT INTO wiki_fts(page_id,workspace_id,title,content,tags)
      SELECT id,workspace_id,title,content,'' FROM wiki_pages`)
  }
}

function checkIntegrity(db: DatabaseSync) {
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
}

function pages(db: DatabaseSync) {
  return db.prepare('SELECT id,workspace_id,slug,version FROM wiki_pages ORDER BY id').all()
}

const cases = [
  {
    prefix: 35,
    seed(this: void, db: DatabaseSync) {
      db.exec(`INSERT INTO projects(id,workspace_id,name,key,created_at,updated_at) VALUES
        ('first','w','Foo','FIRST',1,1),('second','w','Foo','SECOND',2,2),
        ('natural','w','Foo-2','NATURAL',3,3)`)
    },
    repair(this: void, db: DatabaseSync) {
      expect(db.prepare("UPDATE projects SET name='Foo legacy 2' WHERE id='second' AND name='Foo'").run().changes).toBe(
        1,
      )
    },
    verify(this: void, db: DatabaseSync) {
      expect(db.prepare('SELECT id,workspace_id,name,slug FROM projects ORDER BY id').all()).toEqual([
        { id: 'first', workspace_id: 'w', name: 'Foo', slug: 'foo' },
        { id: 'natural', workspace_id: 'w', name: 'Foo-2', slug: 'foo-2' },
        { id: 'second', workspace_id: 'w', name: 'Foo legacy 2', slug: 'foo-legacy-2' },
      ])
    },
  },
  {
    prefix: 41,
    seed(this: void, db: DatabaseSync) {
      seedWiki(db, ['operations', 'operations', 'operations-other-1'])
    },
    repair(this: void, db: DatabaseSync) {
      expect(
        db.prepare("UPDATE wiki_pages SET slug='operations-legacy-copy' WHERE id='other-1' AND slug='operations'").run()
          .changes,
      ).toBe(1)
    },
    verify(this: void, db: DatabaseSync) {
      expect(pages(db)).toEqual([
        { id: pageId, workspace_id: 'w', slug: 'operations', version: 0 },
        { id: 'other-1', workspace_id: 'w', slug: 'operations-legacy-copy', version: 0 },
        { id: 'other-2', workspace_id: 'w', slug: 'operations-other-1', version: 0 },
      ])
    },
  },
  {
    prefix: 50,
    seed(this: void, db: DatabaseSync) {
      seedWiki(db, ['a/b', 'a-b', 'a-b-abcdef12'])
      db.exec(
        "INSERT INTO wiki_redirects(id,workspace_id,old_slug,page_id,created_at) VALUES ('prior','w','a/b','other-2',0)",
      )
    },
    repair(this: void, db: DatabaseSync) {
      expect(
        db.prepare("UPDATE wiki_pages SET slug='a-b-legacy-copy' WHERE id=? AND slug='a/b'").run(pageId).changes,
      ).toBe(1)
      // The reviewed mapping transfers this exact old URL to the repaired page,
      // preserving the existing redirect ID rather than silently replacing it.
      expect(
        db.prepare("UPDATE wiki_redirects SET page_id=? WHERE id='prior' AND page_id='other-2'").run(pageId).changes,
      ).toBe(1)
    },
    verify(this: void, db: DatabaseSync) {
      expect(pages(db)).toEqual([
        { id: pageId, workspace_id: 'w', slug: 'a-b-legacy-copy', version: 0 },
        { id: 'other-1', workspace_id: 'w', slug: 'a-b', version: 0 },
        { id: 'other-2', workspace_id: 'w', slug: 'a-b-abcdef12', version: 0 },
      ])
      expect(db.prepare('SELECT * FROM wiki_redirects').all()).toEqual([
        { id: 'prior', workspace_id: 'w', old_slug: 'a/b', page_id: pageId, created_at: 0 },
      ])
    },
  },
  {
    prefix: 60,
    seed(this: void, db: DatabaseSync) {
      seedWiki(db, ['view', 'view-page', 'view-page-abcdef12'])
    },
    repair(this: void, db: DatabaseSync) {
      expect(
        db
          .prepare("UPDATE wiki_pages SET slug='view-legacy-copy',version=version+1 WHERE id=? AND slug='view'")
          .run(pageId).changes,
      ).toBe(1)
    },
    verify(this: void, db: DatabaseSync) {
      expect(pages(db)).toEqual([
        { id: pageId, workspace_id: 'w', slug: 'view-legacy-copy', version: 1 },
        { id: 'other-1', workspace_id: 'w', slug: 'view-page', version: 0 },
        { id: 'other-2', workspace_id: 'w', slug: 'view-page-abcdef12', version: 0 },
      ])
    },
  },
]

describe('offline populated historical upgrades with approved fixture mappings', () => {
  it.each(cases)(
    'resumes unchanged history at $prefix without losing populated identities or search',
    ({ prefix, seed, repair, verify }) => {
      const db = new DatabaseSync(':memory:')
      try {
        db.exec('PRAGMA foreign_keys=ON')
        const position = filenames.findIndex((file) => file.startsWith(`${String(prefix).padStart(4, '0')}_`))
        expect(position).toBeGreaterThanOrEqual(0)
        for (const sql of migrations.slice(0, position)) db.exec(sql)
        seedWorkspace(db)
        seed(db)
        const originalPages = db.prepare('SELECT id,workspace_id FROM wiki_pages ORDER BY id').all()
        const originalProjects = db.prepare('SELECT id,workspace_id FROM projects ORDER BY id').all()
        const originalRevisions = db
          .prepare('SELECT id,page_id,content,author_id,created_at FROM wiki_revisions ORDER BY id')
          .all()
        repair(db)
        for (const sql of migrations.slice(position)) db.exec(sql)
        expect(db.prepare('SELECT id,workspace_id FROM wiki_pages ORDER BY id').all()).toEqual(originalPages)
        expect(db.prepare('SELECT id,workspace_id FROM projects ORDER BY id').all()).toEqual(originalProjects)
        expect(
          db.prepare('SELECT id,page_id,content,author_id,created_at FROM wiki_revisions ORDER BY id').all(),
        ).toEqual(originalRevisions)
        verify(db)
        expect(
          db.prepare("SELECT page_id FROM wiki_fts WHERE wiki_fts MATCH 'searchneedle' ORDER BY page_id").all(),
        ).toEqual(originalPages.map(({ id }) => ({ page_id: id })))
        expect(db.prepare('SELECT page_id FROM wiki_fts ORDER BY page_id').all()).toEqual(
          originalPages.map(({ id }) => ({ page_id: id })),
        )
        expect(
          db
            .prepare(
              'SELECT p.id FROM wiki_pages p JOIN wiki_fts f ON f.rowid=p.search_rowid AND f.page_id=p.id ORDER BY p.id',
            )
            .all(),
        ).toEqual(originalPages.map(({ id }) => ({ id })))
        checkIntegrity(db)
      } finally {
        db.close()
      }
    },
  )

  it('replays fresh full history including real issue and wiki FTS backfills', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('PRAGMA foreign_keys=ON')
      db.exec(migrations[0])
      seedWorkspace(db)
      db.exec(`INSERT INTO projects(id,workspace_id,name,key,created_at,updated_at)
        VALUES ('project','w','Project','PROJ',0,0);
        INSERT INTO issues(id,workspace_id,project_id,number,title,body,created_by_id,created_at,updated_at)
        VALUES ('issue','w','project',1,'Issueneedle','Body','u',0,0)`)
      seedWiki(db, ['wiki-page'])
      for (const sql of migrations.slice(1)) db.exec(sql)
      expect(
        db.prepare("SELECT issue_id,workspace_id FROM issues_fts WHERE issues_fts MATCH 'issueneedle'").all(),
      ).toEqual([{ issue_id: 'issue', workspace_id: 'w' }])
      expect(db.prepare("SELECT page_id,workspace_id FROM wiki_fts WHERE wiki_fts MATCH 'searchneedle'").all()).toEqual(
        [{ page_id: pageId, workspace_id: 'w' }],
      )
      checkIntegrity(db)
    } finally {
      db.close()
    }
  })
})
