import { readFileSync } from 'node:fs'
import type { SQLInputValue } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { migratedDb } from '#db/test/helpers'

import { ConflictError, NotFoundError } from '../commands/errors'
import { deleteProject } from '../commands/projects'
import type { ServiceCtx } from '../commands/types'
import {
  beginWikiDraftPublish,
  discardWikiDraft,
  finishWikiDraftPublish,
  readWikiDraftState,
  saveWikiDraft,
  deleteWikiDraftsForPages,
} from '../commands/wiki-drafts'
import { deleteWorkspace } from '../commands/workspaces'

const databases: ReturnType<typeof migratedDb>[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
function fixture() {
  const sqlite = migratedDb()
  databases.push(sqlite)
  sqlite.exec(`
    INSERT INTO workspaces(id,name,slug,created_at) VALUES ('w','Workspace','workspace',1);
    INSERT INTO users(id,email,name,created_at) VALUES ('u','u@test.local','User',1),('other','other@test.local','Other',1);
    INSERT INTO wiki_pages(id,workspace_id,slug,title,content,created_by_id,updated_by_id,created_at,updated_at)
      VALUES ('page','w','guide','Published','Published content','u','u',1,1);
  `)
  function prepare(query: string, bindings: SQLInputValue[] = []) {
    return {
      bind: (...values: SQLInputValue[]) => prepare(query, values),
      all: async () => ({ success: true, results: sqlite.prepare(query).all(...bindings), meta: {} }),
      raw: async () => {
        const statement = sqlite.prepare(query)
        statement.setReturnArrays(true)
        return statement.all(...bindings)
      },
      first: async () => sqlite.prepare(query).get(...bindings) ?? null,
      run: async () => ({
        success: true,
        results: [],
        meta: { changes: Number(sqlite.prepare(query).run(...bindings).changes) },
      }),
    }
  }
  // D1 batches execute atomically. Use a real SQLite transaction rather than a
  // Promise.all facade so failed scratch writes exercise the head rollback too.
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.all())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  const ctx = {
    db,
    workspaceId: 'w',
    userId: 'u',
    role: 'owner',
    kv: { delete: async () => {} },
  } as unknown as ServiceCtx
  const state = () => readWikiDraftState(db, 'w', 'page', 'u')
  return { sqlite, ctx, state }
}
const snapshot = (content: string, expectedDraftRevision: string | null) => ({
  title: 'Draft',
  content,
  baseRevisionId: 'page-revision',
  expectedDraftRevision,
})

describe('durable Wiki draft lifecycle preconditions', () => {
  it('reauthorizes cleanup after publication instead of trusting a reserved page id', async () => {
    const { ctx, sqlite, state } = fixture()
    const saved = await saveWikiDraft(ctx, 'guide', snapshot('A', null))
    const publication = await beginWikiDraftPublish(ctx, 'guide', snapshot('A', saved.revision))
    sqlite.exec(
      "INSERT INTO projects(id,workspace_id,name,key,created_at,updated_at) VALUES ('hidden','w','Hidden','H',1,1); UPDATE wiki_pages SET project_id = 'hidden' WHERE id = 'page'",
    )
    await expect(
      finishWikiDraftPublish({ ...ctx, role: 'member' }, 'page', publication.revision),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await state()).toMatchObject({ revision: publication.revision, draft: { content: 'A' } })
  })
  it.each(['page', 'project', 'workspace'] as const)(
    'explicitly cleans heads on %s deletion with FK enforcement off',
    async (parent) => {
      const { ctx, sqlite } = fixture()
      sqlite.exec('PRAGMA foreign_keys = OFF')
      sqlite.exec(
        'CREATE TABLE issues_fts(workspace_id TEXT,issue_id TEXT); CREATE TABLE wiki_fts(workspace_id TEXT,page_id TEXT)',
      )
      const projectId = '00000000-0000-4000-8000-000000000001'
      if (parent === 'project') {
        sqlite
          .prepare('INSERT INTO projects(id,workspace_id,name,key,created_at,updated_at) VALUES (?, ?, ?, ?, 1, 1)')
          .run(projectId, 'w', 'Project', 'P')
        sqlite.prepare('UPDATE wiki_pages SET project_id = ? WHERE id = ?').run(projectId, 'page')
      }
      await saveWikiDraft(ctx, 'guide', snapshot('A', null))
      expect(sqlite.prepare('SELECT count(*) AS count FROM wiki_draft_heads').get()).toEqual({ count: 1 })
      if (parent === 'page') {
        await deleteWikiDraftsForPages(ctx, ['page'])
        sqlite.exec("DELETE FROM wiki_pages WHERE id = 'page'")
      } else if (parent === 'project') await deleteProject(ctx, projectId)
      else await deleteWorkspace(ctx, 'workspace', 'another-default')
      expect(sqlite.prepare('SELECT count(*) AS count FROM wiki_draft_heads').get()).toEqual({ count: 0 })
      expect(sqlite.prepare('SELECT count(*) AS count FROM wiki_drafts').get()).toEqual({ count: 0 })
    },
  )
  it('preserves existing scratch rows when the new head starts absent', async () => {
    const { sqlite, ctx, state } = fixture()
    sqlite.exec('DROP TABLE wiki_draft_heads')
    sqlite.exec(
      "INSERT INTO wiki_drafts(id,workspace_id,user_id,page_id,title,content,updated_at) VALUES ('legacy','w','u','page','Legacy','Recover me',1)",
    )
    sqlite.exec(readFileSync(new URL('../../../migrations/0068_wiki_draft_heads.sql', import.meta.url), 'utf8'))
    expect(await state()).toMatchObject({ revision: null, draft: { content: 'Recover me' } })
    const saved = await saveWikiDraft(ctx, 'guide', snapshot('New', null))
    expect(await state()).toMatchObject({ revision: saved.revision, draft: { content: 'New' } })
  })
  it('rejects late A after B and rejects stale deletes without changing B', async () => {
    const { ctx, state } = fixture()
    const a = await saveWikiDraft(ctx, 'guide', snapshot('A', null))
    const b = await saveWikiDraft(ctx, 'guide', snapshot('B', a.revision))
    await expect(saveWikiDraft(ctx, 'guide', snapshot('Late A', a.revision))).rejects.toBeInstanceOf(ConflictError)
    await expect(discardWikiDraft(ctx, 'guide', { expectedDraftRevision: a.revision })).rejects.toBeInstanceOf(
      ConflictError,
    )
    expect(await state()).toMatchObject({ revision: b.revision, draft: { content: 'B' } })
  })
  it('retains a tombstone after discard so old requests cannot resurrect the draft', async () => {
    const { ctx, state } = fixture()
    const saved = await saveWikiDraft(ctx, 'guide', snapshot('A', null))
    const discarded = await discardWikiDraft(ctx, 'guide', { expectedDraftRevision: saved.revision })
    await expect(saveWikiDraft(ctx, 'guide', snapshot('Delayed A', saved.revision))).rejects.toBeInstanceOf(
      ConflictError,
    )
    await expect(saveWikiDraft(ctx, 'guide', snapshot('Old initial request', null))).rejects.toBeInstanceOf(
      ConflictError,
    )
    expect(await state()).toEqual({ revision: discarded.revision, draft: null })
    await saveWikiDraft(ctx, 'guide', snapshot('New intentional edit', discarded.revision))
    expect(await state()).toMatchObject({ draft: { content: 'New intentional edit' } })
  })
  it('invalidates old writers before publication and keeps scratch if publishing fails', async () => {
    const { ctx, state } = fixture()
    const saved = await saveWikiDraft(ctx, 'guide', snapshot('Recoverable A', null))
    const publication = await beginWikiDraftPublish(ctx, 'guide', snapshot('A', saved.revision))
    await expect(saveWikiDraft(ctx, 'guide', snapshot('Late autosave', saved.revision))).rejects.toBeInstanceOf(
      ConflictError,
    )
    expect(await state()).toMatchObject({ revision: publication.revision, draft: { content: 'Recoverable A' } })
  })
  it('cleans only the reserved publication generation and preserves newer accepted B', async () => {
    const { ctx, state } = fixture()
    const saved = await saveWikiDraft(ctx, 'guide', snapshot('A', null))
    const publication = await beginWikiDraftPublish(ctx, 'guide', snapshot('A', saved.revision))
    const b = await saveWikiDraft(ctx, 'guide', snapshot('B', publication.revision))
    expect(await finishWikiDraftPublish(ctx, 'page', publication.revision)).toEqual({ ok: true, draftRevision: null })
    expect(await state()).toMatchObject({ revision: b.revision, draft: { content: 'B' } })
  })
  it('retains a new head after successful publish cleanup and rejects pre-publication requests', async () => {
    const { ctx, state } = fixture()
    const saved = await saveWikiDraft(ctx, 'guide', snapshot('A', null))
    const publication = await beginWikiDraftPublish(ctx, 'guide', snapshot('A', saved.revision))
    const completed = await finishWikiDraftPublish(ctx, 'page', publication.revision)
    expect(completed.draftRevision).toEqual(expect.any(String))
    expect(await state()).toEqual({ revision: completed.draftRevision, draft: null })
    await expect(saveWikiDraft(ctx, 'guide', snapshot('Late A', saved.revision))).rejects.toBeInstanceOf(ConflictError)
    expect((await state()).draft).toBeNull()
  })
  it('rolls back head advancement if storing the scratch snapshot fails', async () => {
    const { sqlite, ctx, state } = fixture()
    const saved = await saveWikiDraft(ctx, 'guide', snapshot('A', null))
    sqlite.exec(
      "CREATE TRIGGER reject_draft_update BEFORE UPDATE ON wiki_drafts BEGIN SELECT RAISE(ABORT, 'storage failed'); END",
    )
    await expect(saveWikiDraft(ctx, 'guide', snapshot('B', saved.revision))).rejects.toThrow('storage failed')
    expect(await state()).toMatchObject({ revision: saved.revision, draft: { content: 'A' } })
  })
  it('advances heads for legacy writes while keeping user scopes independent', async () => {
    const { ctx, state } = fixture()
    const saved = await saveWikiDraft(ctx, 'guide', snapshot('A', null))
    await saveWikiDraft({ ...ctx, userId: 'other' }, 'guide', snapshot('Other user', null))
    expect(await state()).toMatchObject({ revision: saved.revision, draft: { content: 'A' } })
    await saveWikiDraft(ctx, 'guide', { title: 'Legacy client', content: 'New legacy snapshot' })
    await expect(saveWikiDraft(ctx, 'guide', snapshot('Stale browser', saved.revision))).rejects.toBeInstanceOf(
      ConflictError,
    )
    expect(await state()).toMatchObject({ draft: { content: 'New legacy snapshot' } })
  })
})
