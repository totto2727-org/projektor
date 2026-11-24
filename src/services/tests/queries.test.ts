import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { schema } from '#db'
import { migratedDb } from '#db/test/helpers.ts'
import {
  DataQueryError,
  findProjectById,
  findProjectBySlug,
  findProjectIdByKey,
  findWorkspaceBySlug,
  findWorkspaceMembership,
  listProjects,
  listProjectSummaries,
  listWorkspaceMembers,
  listWorkspaces,
  listWorkspaceTokenMetadata,
  readWorkspaceBrand,
} from '#services'
import { runTestEffect } from '#tests/run-effect.ts'

/** Read-only D1 transport over the real migrated schema. Not a Worker emulator. */
const readDatabase = function readDatabase(sqlite: DatabaseSync): D1Database {
  const prepare = function prepare(sql: string, bindings: SQLInputValue[] = []) {
    return {
      bind: (...values: SQLInputValue[]) => prepare(sql, values),
      all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }),
      raw: async () => {
        const statement = sqlite.prepare(sql)
        statement.setReturnArrays(true)
        return statement.all(...bindings)
      },
    }
  }
  return { prepare } as unknown as D1Database
}

describe('project/workspace pure queries', () => {
  let sqlite: DatabaseSync
  let db: D1Database

  beforeEach(() => {
    sqlite = migratedDb()
    db = readDatabase(sqlite)
    sqlite.exec(`
			INSERT INTO workspaces (id,name,slug,created_at,brand) VALUES
			 ('wa','Alpha workspace','alpha',10,'{"accent":"#abcdef","logoR2Key":"wa/brand-logo/x"}'),
			 ('wb','Beta workspace','beta',20,'{}');
			INSERT INTO users (id,email,name,created_at) VALUES
			 ('u1','one@example.com','One',1),('u2','two@example.com','Two',2);
			INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES
			 ('wa','u1','owner',20),('wa','u2','viewer',10),('wb','u2','member',30);
			INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at,archived_at) VALUES
			 ('p1','wa','Zeta','SAME','same',100,101,NULL),
			 ('p2','wa','Alpha','ARCH','archive',110,111,120),
			 ('p3','wa','Beta','BETA','beta',112,113,NULL),
			 ('p4','wb','Other tenant','SAME','same',200,201,NULL);
		`)
  })

  afterEach(() => sqlite.close())

  test('retains camelCase project rows, ordering, archive opt-in and app-supplied visibility', async () => {
    const projects = await runTestEffect(listProjects(db, 'wa'))
    expect(projects.map((project) => project.id)).toStrictEqual(['p3', 'p1'])
    expect(projects[1]).toEqual({
      agentWipLimit: null,
      archivedAt: null,
      createdAt: 100,
      description: null,
      id: 'p1',
      key: 'SAME',
      name: 'Zeta',
      slug: 'same',
      updatedAt: 101,
      workspaceId: 'wa',
    })
    expect((await runTestEffect(listProjects(db, 'wa', { includeArchived: true }))).map((p) => p.id)).toStrictEqual([
      'p2',
      'p3',
      'p1',
    ])
    expect(
      (
        await runTestEffect(
          listProjects(db, 'wa', {
            visibility: eq(schema.projects.id, 'p1'),
          }),
        )
      ).map((p) => p.id),
    ).toStrictEqual(['p1'])
  })

  test('scopes id, slug and key lookups to the explicit workspace and retains missing results', async () => {
    await expect(runTestEffect(findProjectById(db, 'wa', 'p4'))).resolves.toBeUndefined()
    await expect(runTestEffect(findProjectById(db, 'wa', 'p1'))).resolves.toMatchObject({ id: 'p1' })
    await expect(runTestEffect(findProjectBySlug(db, 'wa', 'same'))).resolves.toMatchObject({
      id: 'p1',
    })
    await expect(runTestEffect(findProjectBySlug(db, 'wb', 'same'))).resolves.toMatchObject({
      id: 'p4',
    })
    await expect(runTestEffect(findProjectIdByKey(db, 'wa', 'SAME'))).resolves.toEqual({ id: 'p1' })
    await expect(runTestEffect(findProjectIdByKey(db, 'wb', 'SAME'))).resolves.toEqual({ id: 'p4' })
    await expect(runTestEffect(findProjectIdByKey(db, 'wa', 'MISSING'))).resolves.toBeUndefined()
  })

  test('retains summary column names, membership join, archive filtering and custom status counts', async () => {
    const insert = sqlite.prepare(`INSERT INTO issues
			(id,workspace_id,project_id,number,title,status,status_category,labels,created_by_id,created_at,updated_at)
			VALUES (?, 'wa', 'p1', ?, 'Issue', ?, ?, '[]', 'u1', 100, 101)`)
    insert.run('i1', 1, 'backlog', '')
    insert.run('i2', 2, 'custom-done', 'done')
    insert.run('i3', 3, 'custom-working', 'in_progress')
    insert.run('i4', 4, 'cancelled', '')
    const rows = await runTestEffect(
      listProjectSummaries(db, 'u1', {
        sql: 'p.id = ?',
        bindings: ['p1'],
      }),
    )
    expect(rows).toEqual([
      {
        archived_at: null,
        backlog_issue_count: 1,
        created_at: 100,
        description: null,
        id: 'p1',
        key: 'SAME',
        name: 'Zeta',
        open_issue_count: 2,
        slug: 'same',
        updated_at: 101,
        workspace_id: 'wa',
        workspace_name: 'Alpha workspace',
        workspace_slug: 'alpha',
      },
    ])
    // Even a permissive caller predicate never drops the membership relation.
    expect(
      (await runTestEffect(listProjectSummaries(db, 'u1', { sql: '1 = 1', bindings: [] }))).map((p) => p.id),
    ).toStrictEqual(['p3', 'p1'])
    expect(
      (await runTestEffect(listProjectSummaries(db, 'u1', { sql: '1 = 1', bindings: [] }, true))).map((p) => p.id),
    ).toStrictEqual(['p2', 'p3', 'p1'])
    await expect(
      runTestEffect(listProjectSummaries(db, 'unknown', { sql: '1 = 1', bindings: [] })),
    ).resolves.toStrictEqual([])
  })

  test('loads workspace/membership relations without authorizing roles or selecting an implicit tenant', async () => {
    await expect(runTestEffect(listWorkspaces(db, 'u2'))).resolves.toEqual([
      { createdAt: 10, id: 'wa', name: 'Alpha workspace', role: 'viewer', slug: 'alpha' },
      { createdAt: 20, id: 'wb', name: 'Beta workspace', role: 'member', slug: 'beta' },
    ])
    await expect(runTestEffect(listWorkspaces(db, 'unknown'))).resolves.toStrictEqual([])
    await expect(runTestEffect(findWorkspaceBySlug(db, 'alpha'))).resolves.toMatchObject({
      id: 'wa',
      slug: 'alpha',
    })
    await expect(runTestEffect(findWorkspaceBySlug(db, 'unknown'))).resolves.toBeUndefined()
    await expect(runTestEffect(findWorkspaceMembership(db, 'wa', 'u2'))).resolves.toEqual({
      joinedAt: 10,
      role: 'viewer',
      userId: 'u2',
      workspaceId: 'wa',
    })
    await expect(runTestEffect(findWorkspaceMembership(db, 'wb', 'u1'))).resolves.toBeUndefined()
    expect((await runTestEffect(listWorkspaceMembers(db, 'wa'))).map((member) => member.id)).toStrictEqual(['u2', 'u1'])
  })

  test('decodes stored brand JSON but does not synthesize API URLs', async () => {
    await expect(runTestEffect(readWorkspaceBrand(db, 'wa'))).resolves.toEqual({
      accent: '#abcdef',
      logoR2Key: 'wa/brand-logo/x',
    })
    await expect(runTestEffect(readWorkspaceBrand(db, 'missing'))).resolves.toEqual({})
  })

  test('returns only scoped token metadata with decoded scopes and existing descending order', async () => {
    sqlite.exec(`INSERT INTO api_tokens (id,workspace_id,user_id,name,token_hash,scopes,created_at) VALUES
		 ('t1','wa','u1','First','secret1','["read"]',10),
		 ('t2','wa','u1','Second','secret2','["write"]',20),
		 ('t3','wb','u2','Other','secret3','["read"]',30);`)
    await expect(runTestEffect(listWorkspaceTokenMetadata(db, 'wa'))).resolves.toEqual([
      {
        createdAt: 20,
        expiresAt: null,
        id: 't2',
        lastUsedAt: null,
        name: 'Second',
        scopes: ['write'],
      },
      {
        createdAt: 10,
        expiresAt: null,
        id: 't1',
        lastUsedAt: null,
        name: 'First',
        scopes: ['read'],
      },
    ])
  })

  test('defers I/O and reports database failures through the typed Effect channel', async () => {
    let calls = 0
    const cause = new Error('database unavailable')
    const broken = {
      prepare: () => {
        calls++
        throw cause
      },
    } as unknown as D1Database
    const query = listProjects(broken, 'wa')
    expect(calls).toBe(0)
    const failure = await runTestEffect(
      query.pipe(
        Effect.match({
          onSuccess: () => undefined,
          onFailure: (error) => error,
        }),
      ),
    )
    expect(calls).toBe(1)
    expect(failure).toBeInstanceOf(DataQueryError)
    expect(failure).toMatchObject({ _tag: 'DataQueryError', cause, operation: 'listProjects' })
  })
})
