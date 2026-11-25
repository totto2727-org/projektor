import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { Predicate, Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { SQL_NULL } from '#db/sql-null.ts'
import { migratedDb } from '#db/test/helpers.ts'
import { DataQueryError } from '#services/errors.ts'
import { findAttachment, listAttachments } from '#services/files.ts'
import { findGroup, listGroupGrants, listGroupMembers, listGroups, listMemberGroups } from '#services/groups.ts'
import { JSON_NULL } from '#tests/json-null.ts'
import { runTestEffect } from '#tests/run-effect.ts'

/**
 * Executes the actual Drizzle/raw SQL over the complete migrated SQLite schema.
 *
 * @param {DatabaseSync} sqlite - The SQLite database with migrations applied.
 * @returns {D1Database} The D1 read methods that use this database.
 */
const readDatabase = function readDatabase(sqlite: DatabaseSync): D1Database {
  const prepare = function prepare(sql: string, bindings: SQLInputValue[] = []) {
    return {
      bind: (...values: SQLInputValue[]) => prepare(sql, values),
      all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }),
      first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
      raw: async () =>
        sqlite
          .prepare(sql)
          .all(...bindings)
          .map((row) => Object.values(row)),
    }
  }
  return { prepare } as unknown as D1Database
}

describe('groups and attachment pure retrieval', () => {
  let sqlite: DatabaseSync
  let db: D1Database
  beforeEach(() => {
    sqlite = migratedDb()
    db = readDatabase(sqlite)
    sqlite.exec(`
			INSERT INTO workspaces (id,name,slug,created_at) VALUES ('wa','A','a',1),('wb','B','b',2);
			INSERT INTO users (id,email,name,created_at) VALUES ('u1','one@example.com','One',1),('u2','two@example.com','Two',2);
			INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('wa','u1','member',1),('wa','u2','viewer',2),('wb','u1','member',1);
			INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES ('p1','wa','Project','ONE',1,1),('p2','wb','Other','TWO',1,1);
			INSERT INTO user_groups (id,workspace_id,name,description,created_at) VALUES ('g1','wa','Zeta',NULL,3),('g2','wa','Alpha','Description',4),('g3','wb','Other',NULL,5);
			INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u2',20),('g1','u2','u1',10),('g3','u1','u1',30);
			INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','member'),('g3','p2','viewer');
			INSERT INTO wiki_pages (id,workspace_id,slug,title,project_id,created_by_id,updated_by_id,created_at,updated_at,deleted_at) VALUES
			 ('w1','wa','hello world','Hello','p1','u1','u1',1,1,NULL),
			 ('w2','wa','deleted','Deleted',NULL,'u1','u1',1,1,2),
			 ('w3','wb','other','Other tenant','p2','u1','u1',1,1,NULL);
			INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,url,linked_wiki_page_id,entity_type,entity_id,created_by_id,created_at) VALUES
			 ('a1','wa','file','secret/key','photo.png','image/png',123,NULL,NULL,'issue','same','u1',30),
			 ('a2','wa','wiki_ref','','','',0,NULL,'w1','issue','same','u1',10),
			 ('a3','wa','wiki_ref','','','',0,NULL,'w2','issue','same','u1',20),
			 ('a4','wa','url','','Site','',0,'https://example.com',NULL,'wiki_page','same','u1',40),
			 ('a5','wb','file','other/key','Other','text/plain',1,NULL,NULL,'issue','same','u1',1),
			 ('a6','wa','wiki_ref','','','',0,NULL,'w3','issue','same','u1',25);
		`)
  })
  afterEach(() => sqlite.close())

  test('lists exact group summaries/counts and app-selected membership subset', async () => {
    await expect(runTestEffect(listGroups(db, 'wa'))).resolves.toStrictEqual([
      {
        createdAt: 4,
        description: 'Description',
        grantCount: 0,
        id: 'g2',
        memberCount: 0,
        name: 'Alpha',
      },
      { createdAt: 3, description: SQL_NULL, grantCount: 1, id: 'g1', memberCount: 2, name: 'Zeta' },
    ])
    const result = await runTestEffect(listGroups(db, 'wa', { memberUserId: 'u1' }))
    expect(result.map((g) => g.id)).toStrictEqual(['g1'])
    await expect(runTestEffect(listGroups(db, 'wa', { memberUserId: 'missing' }))).resolves.toStrictEqual([])
  })

  test('retrieves domain group/member/grant rows with explicit tenant boundaries', async () => {
    await expect(runTestEffect(findGroup(db, 'wa', 'g1'))).resolves.toStrictEqual({
      createdAt: 3,
      description: SQL_NULL,
      id: 'g1',
      name: 'Zeta',
      workspaceId: 'wa',
    })
    await expect(runTestEffect(findGroup(db, 'wa', 'g3'))).resolves.toBeUndefined()
    await expect(runTestEffect(listGroupMembers(db, 'wa', 'g1'))).resolves.toStrictEqual([
      { addedAt: 10, addedBy: 'u1', email: 'two@example.com', name: 'Two', userId: 'u2' },
      { addedAt: 20, addedBy: 'u2', email: 'one@example.com', name: 'One', userId: 'u1' },
    ])
    await expect(runTestEffect(listGroupGrants(db, 'wa', 'g1'))).resolves.toStrictEqual([
      { projectId: 'p1', projectKey: 'ONE', projectName: 'Project', role: 'member' },
    ])
    await expect(runTestEffect(listGroupMembers(db, 'wa', 'g3'))).resolves.toStrictEqual([])
    await expect(runTestEffect(listGroupGrants(db, 'wa', 'g3'))).resolves.toStrictEqual([])
  })

  test('includes zero-group workspace members without leaking memberships from another tenant', async () => {
    sqlite.exec("DELETE FROM user_group_members WHERE group_id = 'g1' AND user_id = 'u2'")
    await expect(runTestEffect(listMemberGroups(db, 'wa'))).resolves.toStrictEqual([
      { groups: [{ id: 'g1', name: 'Zeta' }], userId: 'u1' },
      { groups: [], userId: 'u2' },
    ])
  })

  test('maps file/link/wiki metadata, orders by creation and filters entity type/id/workspace', async () => {
    const rows = await runTestEffect(listAttachments(db, 'wa', { entityType: 'issue', entityId: 'same' }))
    expect(rows.map((row) => row.id)).toStrictEqual(['a2', 'a3', 'a6', 'a1'])
    expect(rows[0]).toStrictEqual({
      contentType: '',
      createdAt: 10,
      filename: '',
      id: 'a2',
      kind: 'wiki_ref',
      reviewStatus: SQL_NULL,
      size: 0,
      url: SQL_NULL,
      wikiPage: { id: 'w1', projectId: 'p1', slug: 'hello world', title: 'Hello' },
    })
    expect(rows[1].wikiPage).toBeNull()
    expect(rows[2].wikiPage).toBeNull()
    expect(rows[3]).toStrictEqual({
      contentType: 'image/png',
      createdAt: 30,
      filename: 'photo.png',
      id: 'a1',
      kind: 'file',
      reviewStatus: SQL_NULL,
      size: 123,
      url: SQL_NULL,
      wikiPage: JSON_NULL,
    })
    await expect(
      runTestEffect(listAttachments(db, 'wa', { entityType: 'issue', entityId: 'missing' })),
    ).resolves.toStrictEqual([])
    const result = await runTestEffect(listAttachments(db, 'wa', { entityType: 'wiki_page', entityId: 'same' }))
    expect(result.map((a) => a.id)).toStrictEqual(['a4'])
  })

  test('applies app-owned owner and linked-page predicates without losing unavailable refs', async () => {
    const rows = await runTestEffect(
      listAttachments(db, 'wa', {
        entityType: 'issue',
        entityId: 'same',
        ownerVisibility: { sql: 'a.id != ?', params: ['a1'] },
        linkedWikiVisibility: { sql: 'w.project_id = ?', params: ['hidden'] },
      }),
    )
    expect(rows.map((row) => row.id)).toStrictEqual(['a2', 'a3', 'a6'])
    expect(rows.every((row) => Predicate.isNullish(row.wikiPage))).toBe(true)
    await expect(
      runTestEffect(findAttachment(db, 'wa', 'a1', { ownerVisibility: { sql: 'a.id != ?', params: ['a1'] } })),
    ).resolves.toBeNull()
  })

  test('finds scoped metadata, missing rows remain null and internal storage keys stay absent', async () => {
    await expect(runTestEffect(findAttachment(db, 'wa', 'a5'))).resolves.toBeNull()
    await expect(runTestEffect(findAttachment(db, 'wa', 'missing'))).resolves.toBeNull()
    const row = await runTestEffect(findAttachment(db, 'wa', 'a4'))
    expect(row).toMatchObject({
      id: 'a4',
      kind: 'url',
      filename: 'Site',
      url: 'https://example.com',
    })
    expect(row).not.toHaveProperty('r2Key')
  })

  test('defers actual DB access until Effect execution and tags SQL failures', async () => {
    const query = listGroups(db, 'wa')
    sqlite.exec('DROP TABLE group_project_grants')
    const error = await runTestEffect(Effect.flip(query))
    expect(error).toBeInstanceOf(DataQueryError)
    expect(error.operation).toBe('listGroups')
    await expect(
      runTestEffect(
        Effect.flip(
          listAttachments(db, 'wa', {
            entityType: 'issue',
            entityId: 'same',
            ownerVisibility: { sql: 'invalid_column = ?', params: [1] },
          }),
        ),
      ),
    ).resolves.toMatchObject({ _tag: 'DataQueryError', operation: 'listAttachments' })
  })
})
