import { Effect, Schema } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { makeRequestServices, RequestServices } from '../../request'
import { inMemoryKV, inMemoryR2, testEnvironment } from '../../server/test/resources'
import {
  addComment,
  editComment,
  deleteComment,
  addIssueLink,
  deleteIssueLink,
  shareIssue,
  addAttachmentLink,
  updateSprint,
  createIssue,
  deleteAttachment,
  readIssue,
  readComments,
  readLinks,
  readAttachments,
  searchWikiAttachments,
  readIssuePage,
  searchIssues,
  updateIssue,
} from './actions'
import { issueDataFixture } from './test/data-fixture'
import { project, scope, workspace } from './test/fixtures'
const databases: ReturnType<typeof issueDataFixture>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

// Capture the framework's schema boundary while exercising migrated D1, real development
// authentication, shared domain authorization and direct command side effects.
vi.mock('../../effront', () => ({
  EFFRONT: { ServerFn: { make: (definition: unknown) => ({ definition }) } },
}))
vi.mock('@effront/core/workers', async () => {
  const { Effect } = await import('effect')
  return {
    getWorkersRequestContext: () => Effect.die('Worker context is supplied by this operation test.'),
  }
})
interface Definition {
  readonly input: Schema.Decoder<unknown> | ReadonlyArray<Schema.Decoder<unknown>>
  readonly handler: (...input: readonly unknown[]) => Effect.Effect<unknown, unknown, RequestServices>
}
function fixture(options: { origin?: string } = {}) {
  const database = issueDataFixture()
  databases.push(database)
  const invalidated = vi.fn()
  const kv = inMemoryKV()
  const r2 = inMemoryR2()
  async function invoke(action: unknown, input: unknown) {
    const definition = (action as { definition: Definition }).definition
    const multiple = Array.isArray(definition.input)
    const inputSchema = multiple
      ? Schema.Tuple(definition.input as ReadonlyArray<Schema.Decoder<unknown>>)
      : (definition.input as Schema.Decoder<unknown>)
    const decoded = await Effect.runPromise(Schema.decodeUnknownEffect(inputSchema)(input))
    const request = new Request('https://front.test/_effront/query', {
      method: 'POST',
      headers: {
        origin: options.origin ?? 'https://front.test',
      },
    })
    const services = await Effect.runPromise(
      makeRequestServices(request, testEnvironment(database.db, 'user@example.test', { KV: kv, R2: r2 })),
    )
    return Effect.runPromise(
      definition.handler(...(multiple ? (decoded as readonly unknown[]) : [decoded])).pipe(
        Effect.provideService(RequestServices, {
          ...services,
          invalidate: services.invalidate.pipe(Effect.tap(() => Effect.sync(invalidated))),
        }),
      ),
    )
  }
  return { invoke, invalidated, database, r2 }
}

describe('individual issue ServerFn authorization and contracts', () => {
  it('updates a sprint directly while preserving tenant and project grant checks', async () => {
    const { invoke, database, invalidated } = fixture()
    database.sqlite.exec(
      "INSERT INTO sprints (id,workspace_id,project_id,name,status,created_at,updated_at) VALUES ('sprint-a','workspace-a','project-a','Original','planned',1,1),('sprint-hidden','workspace-a','hidden-project','Hidden','planned',1,1),('sprint-other','workspace-b','other-project','Other','planned',1,1)",
    )
    const patch = { name: 'Updated', goal: 'Direct command', status: 'active', startDate: null, endDate: null }
    for (const sprintId of ['sprint-hidden', 'sprint-other']) {
      expect(await invoke(updateSprint, { workspaceSlug: workspace.slug, sprintId, patch })).toMatchObject({
        ok: false,
        status: 404,
      })
    }
    expect(await invoke(updateSprint, { workspaceSlug: workspace.slug, sprintId: 'sprint-a', patch })).toMatchObject({
      ok: true,
      value: { ok: true },
    })
    expect(database.sqlite.prepare("SELECT name,goal,status FROM sprints WHERE id = 'sprint-a'").get()).toEqual({
      name: 'Updated',
      goal: 'Direct command',
      status: 'active',
    })
    expect(invalidated).toHaveBeenCalledTimes(3)
  })
  it('removes both stored bytes and attachment metadata through the shared storage command', async () => {
    const { invoke, database, r2, invalidated } = fixture()
    database.sqlite.exec(
      "UPDATE attachments SET kind = 'file', r2_key = 'workspace-a/file-a', filename = 'file.txt', content_type = 'text/plain', size = 4, url = NULL WHERE id = 'file-a'",
    )
    await r2.put('workspace-a/file-a', 'data')
    expect(
      await invoke(deleteAttachment, { workspaceSlug: workspace.slug, issueId: 'issue-a', attachmentId: 'file-a' }),
    ).toMatchObject({ ok: true, value: { ok: true } })
    expect(await r2.get('workspace-a/file-a')).toBeNull()
    expect(database.sqlite.prepare("SELECT id FROM attachments WHERE id = 'file-a'").get()).toBeUndefined()
    expect(invalidated).toHaveBeenCalledOnce()
  })
  it('persists comment creation, editing and deletion with authenticated authorship', async () => {
    const { invoke, database, invalidated } = fixture()
    const identity = { workspaceSlug: workspace.slug, issueId: 'issue-a' }
    expect(await invoke(addComment, { ...identity, body: 'Added directly' })).toMatchObject({
      ok: true,
      value: { id: expect.any(String) },
    })
    const comment = database.sqlite
      .prepare("SELECT id,author_id,body FROM issue_comments WHERE body = 'Added directly'")
      .get() as { id: string; author_id: string; body: string }
    expect(comment.author_id).toBe(scope.user.id)
    expect(await invoke(editComment, { ...identity, commentId: comment.id, body: 'Edited directly' })).toMatchObject({
      ok: true,
      value: { ok: true },
    })
    expect(database.sqlite.prepare('SELECT body FROM issue_comments WHERE id = ?').get(comment.id)).toEqual({
      body: 'Edited directly',
    })
    expect(await invoke(deleteComment, { ...identity, commentId: comment.id })).toMatchObject({
      ok: true,
      value: { ok: true },
    })
    expect(database.sqlite.prepare('SELECT id FROM issue_comments WHERE id = ?').get(comment.id)).toBeUndefined()
    expect(invalidated).toHaveBeenCalledTimes(3)
  })
  it('preserves comment ownership and issue association for edit and delete commands', async () => {
    const { invoke, database, invalidated } = fixture()
    database.sqlite.exec(
      "INSERT INTO users (id,email,name,created_at) VALUES ('author-b','other@example.test','Other',1); INSERT INTO issue_comments (id,issue_id,author_id,body,created_at,updated_at) VALUES ('foreign-comment','issue-a','author-b','Unchanged',1,1),('other-comment','issue-b','user-a','Other issue',1,1)",
    )
    for (const action of [editComment, deleteComment]) {
      expect(
        await invoke(action, {
          workspaceSlug: workspace.slug,
          issueId: 'issue-a',
          commentId: 'foreign-comment',
          body: 'Changed',
        }),
      ).toMatchObject({ ok: false, status: 403 })
      expect(
        await invoke(action, {
          workspaceSlug: workspace.slug,
          issueId: 'issue-a',
          commentId: 'other-comment',
          body: 'Changed',
        }),
      ).toMatchObject({ ok: false, status: 404 })
    }
    expect(database.sqlite.prepare("SELECT body FROM issue_comments WHERE id = 'foreign-comment'").get()).toEqual({
      body: 'Unchanged',
    })
    expect(database.sqlite.prepare("SELECT body FROM issue_comments WHERE id = 'other-comment'").get()).toEqual({
      body: 'Other issue',
    })
    expect(invalidated).toHaveBeenCalledTimes(4)
  })
  it('persists canonical links and refuses deletion under a different issue', async () => {
    const { invoke, database, invalidated } = fixture()
    const identity = { workspaceSlug: workspace.slug, issueId: 'issue-a' }
    expect(await invoke(addIssueLink, { ...identity, targetIssueId: 'issue-b', type: 'blocked_by' })).toMatchObject({
      ok: true,
      value: { id: expect.any(String) },
    })
    const link = database.sqlite.prepare('SELECT id,source_issue_id,target_issue_id,type FROM issue_links').get() as {
      id: string
    }
    expect(link).toMatchObject({ source_issue_id: 'issue-b', target_issue_id: 'issue-a', type: 'blocks' })
    database.insertIssue({ id: 'issue-c', number: 3 })
    expect(
      await invoke(deleteIssueLink, { workspaceSlug: workspace.slug, issueId: 'issue-c', linkId: link.id }),
    ).toMatchObject({ ok: false, status: 404 })
    expect(database.sqlite.prepare('SELECT id FROM issue_links WHERE id = ?').get(link.id)).toBeDefined()
    expect(await invoke(deleteIssueLink, { ...identity, linkId: link.id })).toMatchObject({
      ok: true,
      value: { ok: true },
    })
    expect(database.sqlite.prepare('SELECT id FROM issue_links WHERE id = ?').get(link.id)).toBeUndefined()
    expect(invalidated).toHaveBeenCalledTimes(3)
  })
  it('persists hashed share tokens and link attachment DTOs through concrete commands', async () => {
    const { invoke, database, invalidated } = fixture()
    const identity = { workspaceSlug: workspace.slug, issueId: 'issue-a' }
    const result = (await invoke(shareIssue, identity)) as { ok: true; value: { token: string; url: string } }
    expect(result).toMatchObject({
      ok: true,
      value: { token: expect.any(String), url: `/share/${result.value.token}` },
    })
    const token = database.sqlite.prepare('SELECT id,issue_id,created_by FROM share_tokens').get()
    expect(token).toMatchObject({ issue_id: 'issue-a', created_by: scope.user.id })
    expect(token).not.toMatchObject({ id: result.value.token })
    expect(
      await invoke(addAttachmentLink, {
        ...identity,
        link: { kind: 'url', url: 'https://example.test/direct', label: 'Direct' },
      }),
    ).toMatchObject({ ok: true, value: { id: expect.any(String), kind: 'url' } })
    expect(
      database.sqlite
        .prepare("SELECT entity_type,entity_id,url FROM attachments WHERE url = 'https://example.test/direct'")
        .get(),
    ).toEqual({ entity_type: 'issue', entity_id: 'issue-a', url: 'https://example.test/direct' })
    expect(invalidated).toHaveBeenCalledTimes(2)
  })
  it('enforces actual read-only project grants for issue, link, share and attachment commands', async () => {
    const { invoke, database, invalidated } = fixture()
    database.sqlite.exec("UPDATE group_project_grants SET role = 'viewer' WHERE project_id = 'project-a'")
    const identity = { workspaceSlug: workspace.slug, issueId: 'issue-a' }
    expect(await invoke(updateIssue, { ...identity, patch: { title: 'Denied' } })).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(await invoke(addIssueLink, { ...identity, targetIssueId: 'issue-b', type: 'blocks' })).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(await invoke(shareIssue, identity)).toMatchObject({ ok: false, status: 403 })
    expect(
      await invoke(addAttachmentLink, { ...identity, link: { kind: 'url', url: 'https://example.test/denied' } }),
    ).toMatchObject({ ok: false, status: 403 })
    expect(database.sqlite.prepare("SELECT title FROM issues WHERE id = 'issue-a'").get()).toEqual({
      title: 'Original issue',
    })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issue_links').get()).toEqual({ count: 0 })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM share_tokens').get()).toEqual({ count: 0 })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM attachments').get()).toEqual({ count: 1 })
    expect(invalidated).toHaveBeenCalledTimes(4)
  })
  it('resolves an entity in the explicit workspace and checks its authorized catalog project', async () => {
    const valid = fixture()
    expect(await valid.invoke(readIssue, { workspaceSlug: workspace.slug, issueId: 'issue-a' })).toMatchObject({
      ok: true,
      value: { id: 'issue-a', workspaceSlug: workspace.slug },
    })
    expect(valid.invalidated).not.toHaveBeenCalled()
    const hidden = fixture()
    expect(
      await hidden.invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        issueId: 'hidden-issue',
        patch: { title: 'Changed' },
      }),
    ).toMatchObject({ ok: false, status: 404 })
    expect(hidden.database.sqlite.prepare("SELECT title FROM issues WHERE id = 'hidden-issue'").get()).toEqual({
      title: 'Hidden secret',
    })
    expect(hidden.invalidated).toHaveBeenCalledOnce()
  })
  it('builds project list and search contracts from D1, without query refresh', async () => {
    const { invoke, database, invalidated } = fixture()
    expect(
      await invoke(readIssuePage, {
        workspaceSlug: workspace.slug,
        projectId: project.id,
        limit: 30,
      }),
    ).toMatchObject({ ok: true, value: { items: [{ id: 'issue-a' }], total: 1 } })
    expect(
      await invoke(searchIssues, {
        workspaceSlug: workspace.slug,
        projectId: project.id,
        query: 'Original',
      }),
    ).toMatchObject({ ok: true, value: [{ id: 'issue-a', project_id: project.id }] })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 4 })
    expect(invalidated).not.toHaveBeenCalled()
  })
  it.each([
    { issueId: 'hidden-issue' },
    { issueId: 'other-issue' },
    { issueId: 'missing-issue' },
    { issueId: 'issue-b', projectId: project.id },
    { issueId: 'issue-a', parentId: 'hidden-issue' },
    { issueId: 'issue-a', parentId: 'other-issue' },
    { issueId: 'issue-a', projectId: project.id, parentId: 'issue-b' },
  ])('rejects inaccessible mutation references from D1: %j', async ({ issueId, projectId, parentId }) => {
    const { invoke, database, invalidated } = fixture()
    expect(
      await invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        ...(projectId ? { projectId } : {}),
        issueId,
        patch: { title: 'Changed', ...(parentId ? { parentId } : {}) },
      }),
    ).toMatchObject({ ok: false, status: 404 })
    expect(
      database.sqlite
        .prepare('SELECT title FROM issues WHERE id = ?')
        .get(issueId === 'missing-issue' ? 'issue-a' : issueId),
    ).toMatchObject({ title: expect.not.stringMatching(/^Changed$/) })
    expect(invalidated).toHaveBeenCalledOnce()
  })
  it('preserves archived project visibility only through an explicit authorized project selector', async () => {
    const { invoke, database } = fixture()
    database.sqlite.exec("UPDATE projects SET archived_at = 2 WHERE id IN ('project-a', 'hidden-project')")
    expect(
      await invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        issueId: 'issue-a',
        patch: { title: 'Changed' },
      }),
    ).toMatchObject({ ok: false, status: 404 })
    expect(
      await invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        projectId: 'hidden-project',
        issueId: 'hidden-issue',
        patch: { title: 'Changed' },
      }),
    ).toMatchObject({ ok: false, status: 404 })
    expect(
      await invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        projectId: project.id,
        issueId: 'issue-a',
        patch: { title: 'Changed' },
      }),
    ).toMatchObject({ ok: true })
    expect(database.sqlite.prepare("SELECT title FROM issues WHERE id = 'issue-a'").get()).toEqual({ title: 'Changed' })
  })
  it('independently authorizes comments, links, attachments and wiki searches before direct reads', async () => {
    const { invoke, database, invalidated } = fixture()
    const identity = { workspaceSlug: workspace.slug, issueId: 'A-1' }
    expect(await invoke(readComments, identity)).toMatchObject({
      ok: true,
      value: [{ id: 'comment-a', author_id: scope.user.id }],
    })
    expect(await invoke(readLinks, identity)).toEqual({ ok: true, value: [] })
    expect(await invoke(readAttachments, identity)).toMatchObject({
      ok: true,
      value: [{ id: 'file-a', kind: 'url' }],
    })
    expect(await invoke(searchWikiAttachments, { workspaceSlug: workspace.slug, query: 'guide' })).toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        { id: 'wiki-a', title: 'Visible guide', slug: 'guide', project_id: project.id },
        { id: 'wiki-global', title: 'Workspace guide', slug: 'workspace-guide', project_id: null },
      ]),
    })
    for (const read of [readIssue, readComments, readLinks, readAttachments]) {
      expect(await invoke(read, { workspaceSlug: workspace.slug, issueId: 'hidden-issue' })).toMatchObject({
        ok: false,
        status: 404,
      })
      expect(
        await invoke(read, {
          workspaceSlug: workspace.slug,
          projectId: project.id,
          issueId: 'issue-b',
        }),
      ).toMatchObject({ ok: false, status: 404 })
    }
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 4 })
    expect(invalidated).not.toHaveBeenCalled()
  })
  it('rejects malformed cursor input through Effect Schema before the shared query', async () => {
    const { invoke, database } = fixture()
    expect(await invoke(readIssuePage, { workspaceSlug: workspace.slug, cursor: 'next' })).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 4 })
  })
  it('rejects cross-origin writes before any backend read and invalidates expected failures', async () => {
    const { invoke, database, invalidated } = fixture({ origin: 'https://evil.test' })
    const data = new FormData()
    data.set('workspaceSlug', workspace.slug)
    data.set('projectId', project.id)
    data.set('title', 'Created')
    expect(await invoke(createIssue, [null, data])).toMatchObject({ ok: false, status: 403 })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 4 })
    expect(invalidated).toHaveBeenCalledOnce()
  })
  it('passes only schema-selected issue fields to explicit shared commands', async () => {
    const native = fixture()
    const formData = new FormData()
    formData.set('workspaceSlug', workspace.slug)
    formData.set('projectId', project.id)
    formData.set('title', '  Created natively  ')
    formData.set('priority', 'medium')
    formData.set('method', 'DELETE')
    formData.set('path', '/api/workspaces/other')
    expect(await native.invoke(createIssue, [null, formData])).toMatchObject({ ok: true })
    expect(
      native.database.sqlite
        .prepare("SELECT project_id,title,priority FROM issues WHERE title = 'Created natively'")
        .get(),
    ).toEqual({ project_id: project.id, title: 'Created natively', priority: 'medium' })
    expect(native.database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 5 })
    expect(native.invalidated).toHaveBeenCalledOnce()
    const { invoke, database, invalidated } = fixture()
    expect(
      await invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        issueId: 'issue-a',
        patch: { title: 'Changed', path: '/api/workspaces/other' },
        method: 'DELETE',
      }),
    ).toMatchObject({ ok: true })
    expect(database.sqlite.prepare("SELECT title FROM issues WHERE id = 'issue-a'").get()).toEqual({ title: 'Changed' })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 4 })
    expect(invalidated).toHaveBeenCalledOnce()
  })
  it("will not delete an attachment absent from the issue's server-loaded attachment set", async () => {
    const { invoke, database } = fixture()
    database.sqlite.exec(`
      INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,url,entity_type,entity_id,created_by_id,created_at) VALUES
        ('foreign-attachment','workspace-a','url','','Other issue','text/uri-list',0,'https://example.test','issue','issue-b','user-a',1),
        ('foreign-workspace','workspace-b','url','','Other workspace','text/uri-list',0,'https://example.test','issue','issue-a','user-a',1),
        ('wiki-attachment','workspace-a','url','','Wiki','text/uri-list',0,'https://example.test','wiki_page','issue-a','user-a',1);
    `)
    for (const attachmentId of ['foreign-attachment', 'foreign-workspace', 'wiki-attachment', 'missing-attachment']) {
      expect(
        await invoke(deleteAttachment, {
          workspaceSlug: workspace.slug,
          issueId: 'issue-a',
          attachmentId,
        }),
      ).toMatchObject({ ok: false, status: 404 })
    }
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 4 })
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM attachments WHERE id IN ('foreign-attachment','foreign-workspace','wiki-attachment')",
        )
        .get(),
    ).toEqual({ count: 3 })
  })
  it('deletes an issue-owned attachment through shared storage command after direct retrieval', async () => {
    const { invoke, database, invalidated } = fixture()
    expect(
      await invoke(deleteAttachment, {
        workspaceSlug: workspace.slug,
        projectId: project.id,
        issueId: 'issue-a',
        attachmentId: 'file-a',
      }),
    ).toMatchObject({ ok: true, value: { ok: true } })
    expect(database.sqlite.prepare("SELECT id FROM attachments WHERE id = 'file-a'").get()).toBeUndefined()
    expect(invalidated).toHaveBeenCalledOnce()
  })
  it.each([{ issueId: 'hidden-issue' }, { issueId: 'other-issue' }, { issueId: 'issue-b', projectId: project.id }])(
    'rejects attachment deletion under an inaccessible issue: %j',
    async ({ issueId, projectId }) => {
      const { invoke, database, invalidated } = fixture()
      expect(
        await invoke(deleteAttachment, {
          workspaceSlug: workspace.slug,
          ...(projectId ? { projectId } : {}),
          issueId,
          attachmentId: 'file-a',
        }),
      ).toMatchObject({ ok: false, status: 404 })
      expect(database.sqlite.prepare("SELECT entity_id FROM attachments WHERE id = 'file-a'").get()).toEqual({
        entity_id: 'issue-a',
      })
      expect(invalidated).toHaveBeenCalledOnce()
    },
  )
})
