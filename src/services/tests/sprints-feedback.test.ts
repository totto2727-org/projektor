import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { migratedDb } from '#db/test/helpers.ts'
import { DataQueryError } from '#services/errors.ts'
import { findFeedbackSourceById, listFeedback, listFeedbackSources, readFeedbackSummary } from '#services/feedback.ts'
import { findSprintById, listSprints } from '#services/sprints.ts'
import { runTestEffect } from '#tests/run-effect.ts'

/**
 * Read-only transport over the real migrated schema.
 *
 * @param {DatabaseSync} sqlite - The SQLite database with migrations applied.
 * @returns {D1Database} The D1 read methods that use this database.
 */
const readDatabase = function readDatabase(sqlite: DatabaseSync): D1Database {
  const prepare = function prepare(sql: string, bindings: SQLInputValue[] = []) {
    return {
      bind: (...values: SQLInputValue[]) => prepare(sql, values),
      first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }),
      raw: async () =>
        sqlite
          .prepare(sql)
          .all(...bindings)
          .map((row) => Object.values(row)),
    }
  }
  return { prepare } as unknown as D1Database
}

describe('sprint and feedback database read models', () => {
  let sqlite: DatabaseSync
  let db: D1Database
  beforeEach(() => {
    sqlite = migratedDb()
    db = readDatabase(sqlite)
    sqlite.exec(`
			INSERT INTO workspaces (id,name,slug,created_at) VALUES ('wa','A','a',1),('wb','B','b',1);
			INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.com','User',1);
			INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES
			 ('pa','wa','A','A','a',1,1),('pa2','wa','A2','A2','a2',1,1),('pb','wb','B','B','b',1,1);
			INSERT INTO sprints (id,workspace_id,project_id,name,status,created_at,updated_at) VALUES
			 ('s2','wa','pa','Later','active',20,21),('s1','wa','pa','Earlier','planned',10,11),
			 ('s3','wa','pa2','Other project','completed',30,31),('sb','wb','pb','Other tenant','planned',5,6);
			INSERT INTO feedback_sources (id,token_hash,workspace_id,project_id,name,allowed_origins,created_by,created_at,revoked_at) VALUES
			 ('sa','hash-a','wa','pa','A source','["https://a.example"]','u',10,NULL),
			 ('sa2','hash-a2','wa','pa','Second source',NULL,'u',20,25),
			 ('sb','hash-b','wb','pb','B source',NULL,'u',30,NULL);
			INSERT INTO feedback (id,source_id,workspace_id,project_id,rating,rating_scale,body,app_version,status,created_at) VALUES
			 ('f1','sa','wa','pa',1,'thumbs','Comment','1','new',10),
			 ('f2','sa','wa','pa',-1,'thumbs',NULL,'1','reviewed',20),
			 ('f3','sa','wa','pa',5,'five_star','','1','actioned',30),
			 ('f4','sa','wa','pa',NULL,NULL,'Text',NULL,'new',40),
			 ('f5','sa2','wa','pa',3,'five_star','Other','2','new',50),
			 ('fb','sb','wb','pb',1,'thumbs','Tenant B','1','new',60);
		`)
  })
  afterEach(() => sqlite.close())

  test('retains sprint model columns, creation ordering and explicit workspace/project scope', async () => {
    const rows = await runTestEffect(listSprints(db, 'wa', { projectId: 'pa' }))
    expect(rows.map((row) => row.id)).toStrictEqual(['s1', 's2'])
    expect(rows[0]).toStrictEqual({
      createdAt: 10,
      endDate: null,
      goal: null,
      id: 's1',
      name: 'Earlier',
      projectId: 'pa',
      startDate: null,
      status: 'planned',
      updatedAt: 11,
      workspaceId: 'wa',
    })
    await expect(runTestEffect(listSprints(db, 'wa', { projectId: 'pb' }))).resolves.toStrictEqual([])
    await expect(runTestEffect(findSprintById(db, 'wa', 'sb'))).resolves.toBeUndefined()
    await expect(runTestEffect(findSprintById(db, 'wa', 'missing'))).resolves.toBeUndefined()
    await expect(runTestEffect(findSprintById(db, 'wa', 's2'))).resolves.toStrictEqual(rows[1])
  })

  test('retains raw feedback list rows, descending order and combined filters', async () => {
    const rows = await runTestEffect(listFeedback(db, 'wa', { projectId: 'pa' }))
    expect(rows.map((row) => row.id)).toStrictEqual(['f5', 'f4', 'f3', 'f2', 'f1'])
    expect({ ...rows[4] }).toStrictEqual({
      app_version: '1',
      body: 'Comment',
      created_at: 10,
      id: 'f1',
      linked_issue_id: null,
      rating: 1,
      rating_scale: 'thumbs',
      source_id: 'sa',
      source_name: 'A source',
      source_url: null,
      status: 'new',
      submitter_label: null,
    })
    const result = await runTestEffect(listFeedback(db, 'wa', { projectId: 'pa', sourceId: 'sa', status: 'new' }))
    expect(result.map((row) => row.id)).toStrictEqual(['f4', 'f1'])
    await expect(runTestEffect(listFeedback(db, 'wa', { projectId: 'pb' }))).resolves.toStrictEqual([])
  })

  test('retains source/version aggregate counts, null groups and SQL average semantics', async () => {
    const rows = await runTestEffect(readFeedbackSummary(db, 'wa', { projectId: 'pa' }))
    const columnValues = rows.map((row) => Object.fromEntries(Object.entries(row)))
    expect(columnValues).toStrictEqual([
      {
        app_version: '2',
        five_star_avg: 3,
        five_star_total: 1,
        last_seen_at: 50,
        source_id: 'sa2',
        source_name: 'Second source',
        thumbs_total: 0,
        thumbs_up: 0,
        total: 1,
        with_comment_count: 1,
      },
      {
        app_version: null,
        five_star_avg: null,
        five_star_total: 0,
        last_seen_at: 40,
        source_id: 'sa',
        source_name: 'A source',
        thumbs_total: 0,
        thumbs_up: 0,
        total: 1,
        with_comment_count: 1,
      },
      {
        app_version: '1',
        five_star_avg: 5,
        five_star_total: 1,
        last_seen_at: 30,
        source_id: 'sa',
        source_name: 'A source',
        thumbs_total: 2,
        thumbs_up: 1,
        total: 3,
        with_comment_count: 1,
      },
    ])
    await expect(runTestEffect(readFeedbackSummary(db, 'wa', { projectId: 'pb' }))).resolves.toStrictEqual([])
  })

  test('retains raw source metadata and revoked rows without producing API previews', async () => {
    const rows = await runTestEffect(listFeedbackSources(db, 'wa', { projectId: 'pa' }))
    expect(rows.map((row) => row.id)).toStrictEqual(['sa2', 'sa'])
    expect({ ...rows[0] }).toStrictEqual({
      allowed_origins: null,
      created_at: 20,
      description: null,
      id: 'sa2',
      is_active: 1,
      name: 'Second source',
      revoked_at: 25,
      token_hash: 'hash-a2',
    })
    const source = await runTestEffect(findFeedbackSourceById(db, 'wa', 'sa'))
    expect({ ...source }).toStrictEqual({
      ...rows[1],
      project_id: 'pa',
    })
    await expect(runTestEffect(findFeedbackSourceById(db, 'wa', 'sb'))).resolves.toBeNull()
    await expect(runTestEffect(findFeedbackSourceById(db, 'wa', 'missing'))).resolves.toBeNull()
    await expect(runTestEffect(listFeedbackSources(db, 'wa', { projectId: 'pb' }))).resolves.toStrictEqual([])
  })

  test('defers I/O and reports tagged query errors without app semantics', async () => {
    let calls = 0
    const cause = new Error('database unavailable')
    const broken = {
      prepare: () => {
        calls++
        throw cause
      },
    } as unknown as D1Database
    const effect = listFeedback(broken, 'wa', { projectId: 'pa' })
    expect(calls).toBe(0)
    const result = await runTestEffect(Effect.flip(effect))
    expect(calls).toBe(1)
    expect(result).toBeInstanceOf(DataQueryError)
    expect(result).toMatchObject({ _tag: 'DataQueryError', cause, operation: 'listFeedback' })
  })
})
