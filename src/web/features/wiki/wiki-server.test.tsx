import { Iterable, Effect } from 'effect'
import { isValidElement } from 'react'
import type { ComponentProps, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { resetProvisioningCacheForTests } from '#commands/provisioning.ts'
import type { ServiceCtx } from '#commands/types.ts'
import { discardWikiDraft, saveWikiDraft } from '#commands/wiki-drafts.ts'
import { resetAuthCachesForTests } from '#services/authentication.ts'
import { runTestEffect } from '#tests/run-effect.ts'
import { makeRequestServices, RequestServices } from '@/request.ts'
import type { RequestScope } from '@/server/request-context.ts'
import { testEnvironment } from '@/server/test/resources.ts'
import { createTestDatabase } from '@/test/database.ts'

import { renderWiki } from './server.tsx'
import { WikiPageClient } from './wiki-page-client.tsx'

vi.mock(import('./actions.ts'), () => ({}))
vi.mock('../../attachment-actions', () => ({
  uploadAttachment: () => {},
  uploadInlineImage: () => {},
}))
vi.mock(import('@effront/core/query'), () => ({
  query: () => {
    throw new Error('No client bootstrap during SSR')
  },
}))

const workspace = { id: 'workspace', name: 'Team', slug: 'team', role: 'member' as const }
const project = {
  id: 'allowed',
  workspace_id: 'workspace',
  workspace_slug: 'team',
  workspace_name: 'Team',
  name: 'Allowed',
  key: 'ALLOW',
  slug: 'allowed',
  role: 'member' as const,
  description: null,
  open_issue_count: 0,
  backlog_issue_count: 0,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
}
const scope: RequestScope = {
  user: { id: 'user', name: 'Alice', email: 'alice@example.test' },
  workspaces: [workspace],
  projects: [project],
  selection: { kind: 'workspace', workspace },
}
function initialData(rendered: ReactElement) {
  if (!isValidElement<ComponentProps<typeof WikiPageClient>>(rendered) || rendered.type !== WikiPageClient) {
    throw new Error('Expected the Wiki page client with server-owned initial data')
  }
  return rendered.props.initial
}

const databases: ReturnType<typeof createTestDatabase>[] = []
async function fixture(currentScope: RequestScope = scope) {
  resetAuthCachesForTests()
  resetProvisioningCacheForTests()
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
		INSERT INTO workspaces (id,name,slug,created_at) VALUES ('workspace','Team','team',1),('other','Other','other',1);
		UPDATE workspaces SET brand='{"displayName":"Acme"}' WHERE id='workspace';
		INSERT INTO users (id,email,name,created_at) VALUES ('user','alice@example.test','Alice',1),('other-user','other@example.test','Other',1);
		INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('workspace','user','member',1);
		INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES
		 ('allowed','workspace','Allowed','ALLOW','allowed',1,1),('hidden','workspace','Hidden','HIDE','hidden',1,1),('foreign','other','Foreign','FOREIGN','foreign',1,1);
		INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('group','workspace','Readers',1);
		INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('group','user','user',1);
		INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('group','allowed','member');
		INSERT INTO wiki_pages (id,workspace_id,slug,title,content,parent_id,project_id,created_by_id,updated_by_id,created_at,updated_at,type,tags,status,verified_at,verify_interval) VALUES
		 ('page','workspace','guide','Guide','## Initial body\n\nLoaded on the **server**.',NULL,NULL,'user','user',1,1,'guide','["docs"]',NULL,NULL,NULL),
		 ('child','workspace','child','Child','Guide child','page',NULL,'user','user',1,1,NULL,'[]',NULL,NULL,NULL),
		 ('visible-page','workspace','allowed-guide','Allowed Guide','Guide allowed',NULL,'allowed','user','user',1,1,NULL,'[]','current',1,1),
		 ('hidden-page','workspace','hidden-guide','Hidden Guide','Guide hidden',NULL,'hidden','user','user',1,1,NULL,'[]',NULL,NULL,NULL),
		 ('foreign-page','other','guide','Foreign Guide','Other tenant',NULL,'foreign','user','user',1,1,NULL,'[]',NULL,NULL,NULL);
		INSERT INTO wiki_revisions (id,page_id,content,author_id,created_at) VALUES ('rev','page','Body','user',1),('rev-new','page','Initial body','user',1);
		INSERT INTO wiki_drafts (id,workspace_id,user_id,page_id,title,content,base_revision_id,updated_at) VALUES
		 ('draft','workspace','user','page','My draft','Personal body','rev-new',3),('other-draft','workspace','other-user','page','Private','Not Alice','rev',4);
		INSERT INTO attachments (id,workspace_id,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at) VALUES ('attachment','workspace','a','guide.txt','text/plain',4,'wiki_page','page','user',1);
		CREATE VIRTUAL TABLE wiki_fts USING fts5(page_id UNINDEXED,workspace_id UNINDEXED,title,content,tags);
		INSERT INTO wiki_fts (page_id,workspace_id,title,content,tags) SELECT id,workspace_id,title,content,tags FROM wiki_pages;
	`)
  const calls = vi.spyOn(globalThis, 'fetch')
  const request = new Request('https://app.test/wiki/guide')
  const services = await runTestEffect(makeRequestServices(request, testEnvironment(database.db, 'alice@example.test')))
  const authenticated = await runTestEffect(services.scope({ workspaceHint: 'team' }))
  expect(authenticated.user.id).toBe(currentScope.user.id)
  const effect = (path = 'https://app.test/wiki/guide', params = { slug: 'guide' }) =>
    renderWiki(currentScope, new URL(path), params).pipe(Effect.provideService(RequestServices, services))
  return { ...database, calls, effect }
}

describe('wiki direct request-owned queries', () => {
  afterEach(() => {
    Iterable.forEach(databases.splice(0), (database) => {
      database.close()
    })
  })

  test('reopens editing with the current personal draft head, including after legacy scratch and discard', async () => {
    const testFixture = await fixture()
    const reopen = async () => initialData(await runTestEffect(testFixture.effect('https://app.test/wiki/guide/edit')))
    const initial = await reopen()
    expect(initial.draftRevision).toBeNull()
    expect(initial.draft).toMatchObject({ content: 'Personal body' })
    const ctx = { db: testFixture.db, workspaceId: 'workspace', userId: 'user', role: 'member' } as ServiceCtx
    const first = await saveWikiDraft(ctx, 'guide', {
      title: 'Draft A',
      content: 'A',
      expectedDraftRevision: initial.draftRevision,
    })
    const next = await reopen()
    expect(next.draftRevision).toBe(first.revision)
    expect(next.draft).toMatchObject({ content: 'A' })
    const discarded = await discardWikiDraft(ctx, 'guide', { expectedDraftRevision: next.draftRevision })
    const empty = await reopen()
    expect(empty.draft).toBeNull()
    expect(empty.draftRevision).toBe(discarded.revision)
    const saved = await saveWikiDraft(ctx, 'guide', {
      title: 'Fresh edit',
      content: 'B',
      expectedDraftRevision: empty.draftRevision,
    })
    const fresh = await reopen()
    expect(fresh.draftRevision).toBe(saved.revision)
    expect(fresh.draft).toMatchObject({ content: 'B', title: 'Fresh edit' })
  })

  test('is lazy, preserves real SSR HTML and ToC, tree shaping, revision pointer and user-only draft without wiki HTTP', async () => {
    const testFixture = await fixture()
    const effect = testFixture.effect('https://app.test/wiki/guide?workspace=team&slug=untrusted-hint')
    expect(testFixture.calls).not.toHaveBeenCalled()
    const rendered = await runTestEffect(effect)
    const initial = initialData(rendered)
    expect(initial.page).toMatchObject({
      freshness: null,
      id: 'page',
      project_id: null,
      revisionId: 'rev-new',
    })
    expect(initial.draft).toMatchObject({ content: 'Personal body', title: 'My draft' })
    expect(initial.attachments).toStrictEqual([
      { contentType: 'text/plain', createdAt: 1, filename: 'guide.txt', id: 'attachment', size: 4 },
    ])
    expect(initial.tree.find((node) => node.id === 'page')?.children.map((node) => node.id)).toStrictEqual(['child'])
    expect(initial.tree.map((node) => node.id)).not.toContain('hidden-page')
    const html = renderToStaticMarkup(rendered)
    expect(html).toContain('Loaded on the <strong>server</strong>.')
    expect(html).toContain('Guide - Acme Wiki')
    expect(html).toContain('initial-body')
    expect(testFixture.calls).not.toHaveBeenCalled()
  })

  test.each(['owner', 'admin', 'member'])(
    'reads an existing archived page with the same grant policy as ServerFns for %s',
    async (role) => {
      const testFixture = await fixture()
      testFixture.sqlite
        .prepare('UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?')
        .run(role, 'workspace', 'user')
      testFixture.sqlite.exec("UPDATE projects SET archived_at=99 WHERE id='allowed'")
      const initial = initialData(
        await runTestEffect(testFixture.effect('https://app.test/wiki/allowed-guide', { slug: 'allowed-guide' })),
      )
      expect(initial.page).toMatchObject({ id: 'visible-page', project_id: 'allowed' })
    },
  )

  test('does not widen archived page visibility to an ungranted member', async () => {
    const testFixture = await fixture()
    testFixture.sqlite.exec("UPDATE projects SET archived_at=99 WHERE id='allowed'; DELETE FROM group_project_grants")
    await expect(
      runTestEffect(testFixture.effect('https://app.test/wiki/allowed-guide', { slug: 'allowed-guide' })),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('disables autosave after an actual optional draft query failure', async () => {
    const testFixture = await fixture()
    testFixture.sqlite.exec('DROP TABLE wiki_drafts')
    const rendered = await runTestEffect(testFixture.effect('https://app.test/wiki/guide/edit'))
    const initial = initialData(rendered)
    expect(initial.draftStatus).toBe('failed')
    expect(initial.page?.content).toContain('server')
  })

  test('rejects a fetched project page outside the authorized catalog before loading lookup data', async () => {
    const testFixture = await fixture()
    await expect(
      runTestEffect(testFixture.effect('https://app.test/wiki/hidden-guide', { slug: 'hidden-guide' })),
    ).rejects.toMatchObject({ status: 404 })
    expect(testFixture.calls).not.toHaveBeenCalled()
  })

  test('applies the existing FTS and browse visibility policy with workspace pages and computed freshness', async () => {
    const testFixture = await fixture()
    const rendered = await runTestEffect(testFixture.effect('https://app.test/wiki?q=Guide', { slug: '' }))
    const initial = initialData(rendered)
    expect(initial.searchResults.map((page) => page.id).toSorted()).toStrictEqual(['child', 'page', 'visible-page'])
    expect(initial.searchResults.find((page) => page.id === 'visible-page')?.freshness).toStrictEqual({
      staleSince: 86_401,
      state: 'stale',
    })
    expect(initial.stalePages.map((page) => page.id)).toStrictEqual(['visible-page'])
  })

  test('retains explicit project scope plus workspace pages and validates bounded filters', async () => {
    const testFixture = await fixture({ ...scope, selection: { kind: 'project', workspace, project } })
    const rendered = await runTestEffect(
      testFixture.effect('https://app.test/wiki?type=guide&tags=docs&q=Guide', { slug: '' }),
    )
    const initial = initialData(rendered)
    expect(initial.projectId).toBe('allowed')
    expect(initial.filteredPages.map((page) => page.id)).toStrictEqual(['page'])
    expect(initial.searchResults.map((page) => page.id)).toStrictEqual(['page'])
    await expect(
      runTestEffect(testFixture.effect('https://app.test/wiki?status=invalid', { slug: '' })),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      runTestEffect(
        testFixture.effect(
          `https://app.test/wiki?tags=${Array.from({ length: 51 }, (_value, index) => `tag${index}`).join(',')}`,
          {
            slug: '',
          },
        ),
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  test('does not infer an unselected workspace from a lone membership', async () => {
    const testFixture = await fixture({
      ...scope,
      selection: { kind: 'selection-required', target: 'workspace', reason: 'ambiguous' },
    })
    const html = renderToStaticMarkup(await runTestEffect(testFixture.effect()))
    expect(html).toContain('Choose a workspace')
    expect(testFixture.calls).not.toHaveBeenCalled()
  })
})
