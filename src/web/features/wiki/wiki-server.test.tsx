import { Effect } from 'effect'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { resetProvisioningCacheForTests } from '#commands/provisioning'
import { resetAuthCachesForTests } from '#services/authentication'

import { makeRequestServices, RequestServices } from '../../request'
import type { RequestScope } from '../../server/request-context'
import { testEnvironment } from '../../server/test/resources'
import { createTestDatabase } from '../../test/database'
import { renderWiki } from './server'
import { WikiPageClient } from './WikiPageClient'

vi.mock('./actions', () => ({}))
vi.mock('../../attachment-actions', () => ({
  uploadAttachment: () => {},
  uploadInlineImage: () => {},
}))
vi.mock('@effront/core/query', () => ({
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
  if (!isValidElement<ComponentProps<typeof WikiPageClient>>(rendered) || rendered.type !== WikiPageClient)
    throw new Error('Expected the Wiki page client with server-owned initial data')
  return rendered.props.initial
}

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
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
  const services = await Effect.runPromise(
    makeRequestServices(request, testEnvironment(database.db, 'alice@example.test')),
  )
  const authenticated = await Effect.runPromise(services.scope({ workspaceHint: 'team' }))
  expect(authenticated.user.id).toBe(currentScope.user.id)
  const effect = (path = 'https://app.test/wiki/guide', params = { slug: 'guide' }) =>
    renderWiki(currentScope, new URL(path), params).pipe(Effect.provideService(RequestServices, services))
  return { ...database, calls, effect }
}

describe('Wiki direct request-owned queries', () => {
  it('is lazy, preserves real SSR HTML and ToC, tree shaping, revision pointer and user-only draft without wiki HTTP', async () => {
    const test = await fixture()
    const effect = test.effect('https://app.test/wiki/guide?workspace=team&slug=untrusted-hint')
    expect(test.calls).not.toHaveBeenCalled()
    const rendered = await Effect.runPromise(effect)
    const initial = initialData(rendered)
    expect(initial.page).toMatchObject({
      id: 'page',
      revisionId: 'rev-new',
      project_id: null,
      freshness: null,
    })
    expect(initial.draft).toMatchObject({ title: 'My draft', content: 'Personal body' })
    expect(initial.attachments).toEqual([
      { id: 'attachment', filename: 'guide.txt', contentType: 'text/plain', size: 4, createdAt: 1 },
    ])
    expect(initial.tree.find((node) => node.id === 'page')?.children.map((node) => node.id)).toEqual(['child'])
    expect(initial.tree.map((node) => node.id)).not.toContain('hidden-page')
    const html = renderToStaticMarkup(rendered)
    expect(html).toContain('Loaded on the <strong>server</strong>.')
    expect(html).toContain('Guide - Acme Wiki')
    expect(html).toContain('initial-body')
    expect(test.calls).not.toHaveBeenCalled()
  })
  it('disables autosave after an actual optional draft query failure', async () => {
    const test = await fixture()
    test.sqlite.exec('DROP TABLE wiki_drafts')
    const rendered = await Effect.runPromise(test.effect('https://app.test/wiki/guide/edit'))
    const initial = initialData(rendered)
    expect(initial.draftStatus).toBe('failed')
    expect(initial.page?.content).toContain('server')
  })
  it('rejects a fetched project page outside the authorized catalog before loading lookup data', async () => {
    const test = await fixture()
    await expect(
      Effect.runPromise(test.effect('https://app.test/wiki/hidden-guide', { slug: 'hidden-guide' })),
    ).rejects.toMatchObject({ status: 404 })
    expect(test.calls).not.toHaveBeenCalled()
  })
  it('applies the existing FTS and browse visibility policy with workspace pages and computed freshness', async () => {
    const test = await fixture()
    const rendered = await Effect.runPromise(test.effect('https://app.test/wiki?q=Guide', { slug: '' }))
    const initial = initialData(rendered)
    expect(initial.searchResults.map((page) => page.id).sort()).toEqual(['child', 'page', 'visible-page'])
    expect(initial.searchResults.find((page) => page.id === 'visible-page')?.freshness).toEqual({
      state: 'stale',
      staleSince: 86401,
    })
    expect(initial.stalePages.map((page) => page.id)).toEqual(['visible-page'])
  })
  it('retains explicit project scope plus workspace pages and validates bounded filters', async () => {
    const test = await fixture({ ...scope, selection: { kind: 'project', workspace, project } })
    const rendered = await Effect.runPromise(
      test.effect('https://app.test/wiki?type=guide&tags=docs&q=Guide', { slug: '' }),
    )
    const initial = initialData(rendered)
    expect(initial.projectId).toBe('allowed')
    expect(initial.filteredPages.map((page) => page.id)).toEqual(['page'])
    expect(initial.searchResults.map((page) => page.id)).toEqual(['page'])
    await expect(
      Effect.runPromise(test.effect('https://app.test/wiki?status=invalid', { slug: '' })),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      Effect.runPromise(
        test.effect(`https://app.test/wiki?tags=${Array.from({ length: 51 }, (_, i) => `tag${i}`).join(',')}`, {
          slug: '',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 })
  })
  it('does not infer an unselected workspace from a lone membership', async () => {
    const test = await fixture({
      ...scope,
      selection: { kind: 'selection-required', target: 'workspace', reason: 'ambiguous' },
    })
    const html = renderToStaticMarkup(await Effect.runPromise(test.effect()))
    expect(html).toContain('Choose a workspace')
    expect(test.calls).not.toHaveBeenCalled()
  })
})
