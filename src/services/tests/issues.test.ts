import { readFileSync } from 'node:fs'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { eq } from 'drizzle-orm'
import { Iterable, Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { schema } from '#db'
import { migratedDb } from '#db/test/helpers.ts'
import { listComments } from '#services/comments.ts'
import { batchLoadCustomFields, listCustomFieldDefs } from '#services/custom-fields.ts'
import { listLinksForIssue } from '#services/issue-links.ts'
import * as issues from '#services/issues.ts'
import { listTaskStatuses } from '#services/task-statuses.ts'
import { listTaskTypes } from '#services/task-types.ts'
import { runTestEffect } from '#tests/run-effect.ts'

/** Maintained read transport fixture over the real migrated schema, with D1's bind cap. */
const readDatabase = function readDatabase(sqlite: DatabaseSync): D1Database {
  const prepare = function prepare(sql: string, bindings: SQLInputValue[] = []) {
    return {
      bind: (...values: SQLInputValue[]) => {
        if (values.length > 100) {
          throw new Error('D1 bound parameter limit exceeded')
        }
        return prepare(sql, values)
      },
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

describe('issue and related pure data queries', () => {
  let sqlite: DatabaseSync
  let db: D1Database
  beforeEach(() => {
    sqlite = migratedDb()
    db = readDatabase(sqlite)
    // The general DB fixture skips FTS. These query regressions exercise the canonical FTS migration.
    sqlite.exec(
      readFileSync(fileURLToPath(new URL('../../../migrations/0007_issue_fts.sql', import.meta.url).href), 'utf8'),
    )
    sqlite.exec(`
      INSERT INTO workspaces(id,name,slug,created_at) VALUES ('wa','A','a',1),('wb','B','b',1);
      INSERT INTO users(id,email,name,created_at) VALUES ('u','u@example.com','User',1);
      INSERT INTO projects(id,workspace_id,name,key,created_at,updated_at) VALUES ('pa','wa','Project A','A',1,1),('pb','wb','Project B','A',1,1),('hidden','wa','Hidden','H',1,1);
      INSERT INTO issues(id,workspace_id,project_id,number,title,body,status,priority,assignee_id,labels,created_by_id,created_at,updated_at) VALUES
        ('i1','wa','pa',1,'Needle one','Body','todo','high','u','["x"]','u',100,101),
        ('i2','wa','pa',2,'Needle two','','done','none',NULL,'[]','u',100,101),
        ('i3','wa','hidden',1,'Hidden','','todo','none',NULL,'[]','u',100,101),
        ('other','wb','pb',1,'Other tenant','','todo','none',NULL,'[]','u',100,101);
      UPDATE issues SET parent_id='i1' WHERE id='i2';
      INSERT INTO custom_field_definitions(id,workspace_id,key,label,type,options,created_at) VALUES ('f','wa','size','Size','number',NULL,1),('fb','wb','size','Other','number',NULL,1);
      INSERT INTO custom_field_values(issue_id,field_id,value) VALUES ('i1','f','10'),('other','fb','20');
      INSERT INTO issue_comments(id,issue_id,author_id,body,created_at,updated_at) VALUES ('c','i1','u','Comment',1,2);
      INSERT INTO issue_links(id,workspace_id,source_issue_id,target_issue_id,type,created_by_id,created_at) VALUES ('l','wa','i1','i2','blocks','u',1);
      INSERT INTO issues_fts(issue_id,workspace_id,title,body) VALUES ('i1','wa','Needle one','Body'),('other','wb','Needle other','Body');
    `)
  })
  afterEach(() => sqlite.close())

  test('preserves exact detail selector keys, raw labels and absent assignee_name', async () => {
    const row = await runTestEffect(issues.getIssue(db, 'wa', { ref: 'A-01' }))
    expect(row).toEqual({
      assignee_id: 'u',
      author_kind: null,
      body: 'Body',
      completed_at: null,
      created_at: 100,
      created_by_id: 'u',
      id: 'i1',
      labels: '["x"]',
      needs_audit: false,
      number: 1,
      parent_id: null,
      priority: 'high',
      project_id: 'pa',
      project_key: 'A',
      project_name: 'Project A',
      sprint_id: null,
      status: 'todo',
      status_category: null,
      status_id: null,
      status_key: null,
      status_name: null,
      title: 'Needle one',
      type_id: null,
      type_key: null,
      type_name: null,
      updated_at: 101,
      workspace_id: 'wa',
    })
    await expect(runTestEffect(issues.getIssue(db, 'wa', { id: 'other' }))).resolves.toBeNull()
    await expect(runTestEffect(issues.findIssueIdByRef(db, 'wb', 'A-1'))).resolves.toBe('other')
  })

  test('preserves pagination tie-break, cursor total null, body omission and optional rollups', async () => {
    const visibility = eq(schema.issues.projectId, 'pa')
    const page = await runTestEffect(issues.listIssues(db, 'wa', { limit: 1, includeRollups: true }, visibility))
    expect(page.total).toBe(2)
    expect(page.items[0].id).toBe('i2')
    expect(page.items[0]).not.toHaveProperty('body')
    expect(page.items[0]).toHaveProperty('assignee_name', null)
    expect(page.items[0].rollup).toEqual({ byStatus: {}, done: 0, remaining: 0, total: 0 })
    const next = await runTestEffect(
      issues.listIssues(db, 'wa', { limit: 1, cursor: { createdAt: 100, id: 'i2' }, includeBody: true }, visibility),
    )
    expect(next.total).toBeNull()
    expect(next.nextCursor).toBeNull()
    expect(next.items[0]).toMatchObject({
      assignee_name: 'User',
      body: 'Body',
      customFields: [{ key: 'size', label: 'Size', type: 'number', value: '10' }],
      id: 'i1',
    })
    expect(next.items[0]).not.toHaveProperty('rollup')
    const bare = await runTestEffect(issues.listIssues(db, 'wa', { limit: 30, cursor: { createdAt: 100 } }))
    expect(bare.items).toEqual([])
  })

  test('applies shared association, status, numeric field and date predicates', async () => {
    const page = await runTestEffect(
      issues.listIssues(db, 'wa', {
        limit: 30,
        status: 'todo',
        priority: 'high',
        assignee: 'u',
        noParent: true,
        updatedAfter: 100,
        customField: { id: 'f', op: 'gte', value: '5' },
      }),
    )
    expect(page.items.map((r) => r.id)).toEqual(['i1'])
    await expect(runTestEffect(issues.findIssueCustomField(db, 'wa', 'size'))).resolves.toEqual({
      id: 'f',
      type: 'number',
    })
    await expect(runTestEffect(issues.findIssueCustomField(db, 'wa', 'missing'))).resolves.toBeNull()
    await expect(runTestEffect(issues.getIssueExtras(db, 'wa', 'i1'))).resolves.toEqual({
      customFields: [{ key: 'size', label: 'Size', type: 'number', value: '10' }],
      rollup: { byStatus: { done: 1 }, done: 1, remaining: 0, total: 1 },
    })
  })

  test('preserves batch ordering, canonical padded refs, dedup and missing literals', async () => {
    const page = await runTestEffect(
      issues.getIssuesBatch(
        db,
        'wa',
        { refs: ['A-02', 'A-999', 'H-1'], ids: ['i1', 'i2', 'other'] },
        eq(schema.issues.projectId, 'pa'),
      ),
    )
    expect(page.items.map((r) => r.id)).toEqual(['i2', 'i1'])
    expect(page.missing).toEqual(['A-999', 'H-1', 'other'])
    expect(page.items[0]).not.toHaveProperty('assignee_name')
  })

  test('preserves comments keys, link direction and empty workspace-scoped reads', async () => {
    await expect(runTestEffect(listComments(db, 'wa', 'i1'))).resolves.toEqual([
      {
        author_email: 'u@example.com',
        author_id: 'u',
        author_name: 'User',
        body: 'Comment',
        created_at: 1,
        id: 'c',
        updated_at: 2,
      },
    ])
    await expect(runTestEffect(listComments(db, 'wb', 'i1'))).resolves.toEqual([])
    await expect(runTestEffect(listLinksForIssue(db, 'wa', 'i2'))).resolves.toEqual([
      {
        createdAt: 1,
        createdById: 'u',
        id: 'l',
        linkedIssueId: 'i1',
        linkedIssueNumber: 1,
        linkedIssueProjectKey: 'A',
        linkedIssueStatusCategory: '',
        linkedIssueTitle: 'Needle one',
        type: 'blocked_by',
      },
    ])
    await expect(runTestEffect(listLinksForIssue(db, 'wb', 'i2'))).resolves.toEqual([])
    await expect(runTestEffect(batchLoadCustomFields(db, 'wa', ['other']))).resolves.toEqual({})
  })

  test('returns the existing search keys and sanitizes FTS operators literally', async () => {
    const rows = await runTestEffect(
      issues.searchIssues(db, 'wa', { query: 'needle', limit: 20 }, { sql: 'i.project_id = ?', params: ['pa'] }),
    )
    expect(rows).toEqual([
      {
        id: 'i1',
        number: 1,
        priority: 'high',
        project_id: 'pa',
        project_key: 'A',
        project_name: 'Project A',
        status: 'todo',
        title: 'Needle one',
      },
    ])
    await expect(runTestEffect(issues.searchIssues(db, 'wa', { query: 'needle OR', limit: 20 }))).resolves.toEqual([])
    await expect(runTestEffect(issues.searchIssues(db, 'wa', { query: '***', limit: 20 }))).resolves.toEqual([])
  })

  test('retains taxonomy aliases and definition option decoding', async () => {
    sqlite.exec(`INSERT INTO task_types(id,workspace_id,key,name,position,is_default) VALUES ('t','wa','bug','Bug',0,1);
      INSERT INTO task_statuses(id,workspace_id,key,name,category,position,is_default,is_review_step) VALUES ('s','wa','review','Review','in_progress',0,1,1);
      INSERT INTO custom_field_definitions(id,workspace_id,key,label,type,options,created_at) VALUES ('choice','wa','choice','Choice','select','["A","B"]',2);`)
    await expect(runTestEffect(listTaskTypes(db, 'wa'))).resolves.toEqual([
      {
        color: null,
        icon: null,
        id: 't',
        is_default: 1,
        key: 'bug',
        name: 'Bug',
        position: 0,
        workspace_id: 'wa',
      },
    ])
    await expect(runTestEffect(listTaskStatuses(db, 'wa'))).resolves.toEqual([
      {
        category: 'in_progress',
        color: null,
        id: 's',
        is_default: 1,
        is_review_step: 1,
        key: 'review',
        name: 'Review',
        position: 0,
        workspace_id: 'wa',
      },
    ])
    const fields = await runTestEffect(listCustomFieldDefs(db, 'wa'))
    expect(fields.find((r) => r.key === 'choice')?.options).toEqual(['A', 'B'])
    expect(fields.map((r) => r.workspaceId)).toEqual(['wa', 'wa'])
  })

  test("chunks variable-length field, rollup and link metadata loads below D1's bind cap", async () => {
    const ids = Array.from({ length: 195 }, (_, i) => `missing-${i}`)
    await expect(runTestEffect(batchLoadCustomFields(db, 'wa', [...ids, 'i1']))).resolves.toHaveProperty('i1')
    const rollups = await runTestEffect(issues.getChildRollups(db, 'wa', [...ids, 'i1']))
    expect(Object.keys(rollups)).toHaveLength(196)
    expect(rollups.i1.total).toBe(1)
    const issueInsert = sqlite.prepare(
      "INSERT INTO issues(id,workspace_id,project_id,number,title,body,status,priority,labels,created_by_id,created_at,updated_at) VALUES (?, 'wa', 'pa', ?, 'Linked', '', 'todo', 'none', '[]', 'u', 1, 1)",
    )
    const linkInsert = sqlite.prepare(
      "INSERT INTO issue_links(id,workspace_id,source_issue_id,target_issue_id,type,created_by_id,created_at) VALUES (?, 'wa', 'i1', ?, 'relates_to', 'u', 1)",
    )
    Iterable.forEach(ids.entries(), ([index, id]) => {
      issueInsert.run(id, index + 100)
      linkInsert.run(`link-${index}`, id)
    })
    const links = await runTestEffect(listLinksForIssue(db, 'wa', 'i1'))
    expect(links).toHaveLength(196)
    expect(links.filter((link) => link.linkedIssueTitle === 'Linked')).toHaveLength(195)
  })

  test("keeps long taxonomy membership filters below D1's bind cap", async () => {
    sqlite.exec(
      "INSERT INTO task_statuses(id,workspace_id,key,name,category,position,is_default,is_review_step) VALUES ('s','wa','todo','Todo','todo',0,1,0); UPDATE issues SET status_id='s' WHERE id='i1';",
    )
    const ids = Array.from({ length: 195 }, (_, index) => `unknown-${index}`)
    const page = await runTestEffect(
      issues.listIssues(db, 'wa', {
        limit: 30,
        statusIds: [...ids, 's'].join(','),
        excludeTypeIds: ids.join(','),
        priorities: [...ids, 'high'].join(','),
      }),
    )
    expect(page.items.map((row) => row.id)).toEqual(['i1'])
    expect(page.total).toBe(1)
  })

  test('is lazy and exposes a typed query error for D1 failures', async () => {
    const missing = {} as D1Database
    const effect = issues.getIssue(missing, 'wa', { id: 'i1' })
    const result = await runTestEffect(Effect.result(effect))
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'DataQueryError', operation: 'getIssue' },
    })
  })
})
