import { Iterable, Effect, Schema } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { runTestEffect } from '#tests/run-effect.ts'
import { makeRequestServices, RequestServices } from '@/request.ts'
import { inMemoryKV, inMemoryR2, testEnvironment } from '@/server/test/resources.ts'

import {
  setAttachmentReviewStatus,
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
} from './actions.ts'
import { issueDataFixture } from './test/data-fixture.ts'
import { project, scope, workspace } from './test/fixtures.ts'
const databases: ReturnType<typeof issueDataFixture>[] = []
afterEach(() => {
  Iterable.forEach(databases.splice(0), (database) => {
    database.close()
  })
})

/*
 * Capture the framework's schema boundary while exercising migrated D1, real development
 * authentication, shared domain authorization and direct command side effects.
 */
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
  readonly input: Schema.Decoder<unknown> | Readonly<Schema.Decoder<unknown>[]>
  readonly handler: (...input: Readonly<unknown[]>) => Effect.Effect<unknown, unknown, RequestServices>
}
const fixture = function fixture(options: { origin?: string } = {}) {
  const database = issueDataFixture()
  databases.push(database)
  const invalidated = vi.fn()
  const kv = inMemoryKV()
  const r2 = inMemoryR2()
  const invoke = async function invoke(action: unknown, input: unknown) {
    const definition = (action as { definition: Definition }).definition
    const multiple = Array.isArray(definition.input)
    const inputSchema = multiple
      ? Schema.Tuple(definition.input as Readonly<Schema.Decoder<unknown>[]>)
      : (definition.input as Schema.Decoder<unknown>)
    const decoded = await runTestEffect(Schema.decodeUnknownEffect(inputSchema)(input))
    const request = new Request('https://front.test/_effront/query', {
      method: 'POST',
      headers: {
        origin: options.origin ?? 'https://front.test',
      },
    })
    const services = await runTestEffect(
      makeRequestServices(request, testEnvironment(database.db, 'user@example.test', { KV: kv, R2: r2 })),
    )
    return runTestEffect(
      definition.handler(...(multiple ? (decoded as Readonly<unknown[]>) : [decoded])).pipe(
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
  test('sets and clears review status through the named Core command under selected issue ownership', async () => {
    const { invoke, database, invalidated } = fixture()
    database.sqlite.exec(
      "INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at) VALUES ('review-file','workspace-a','file','w/file','review.pdf','application/pdf',1,'issue','issue-a','user-a',1)",
    )
    const input = { workspaceSlug: workspace.slug, issueId: 'issue-a', attachmentId: 'review-file', status: 'fixing' }
    await expect(invoke(setAttachmentReviewStatus, input)).resolves.toEqual({ ok: true, value: { ok: true } })
    expect(database.sqlite.prepare("SELECT review_status FROM attachments WHERE id='review-file'").get()).toEqual({
      review_status: 'fixing',
    })
    await expect(
      invoke(setAttachmentReviewStatus, { ...input, issueId: 'issue-b', status: 'done' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
    await expect(invoke(setAttachmentReviewStatus, { ...input, status: null })).resolves.toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(database.sqlite.prepare("SELECT review_status FROM attachments WHERE id='review-file'").get()).toEqual({
      review_status: null,
    })
    expect(invalidated).toHaveBeenCalledTimes(3)
  })

  test('rejects cross-origin review status mutations before command execution', async () => {
    const { invoke, invalidated } = fixture({ origin: 'https://evil.test' })
    await expect(
      invoke(setAttachmentReviewStatus, {
        workspaceSlug: workspace.slug,
        issueId: 'issue-a',
        attachmentId: 'missing',
        status: 'fixing',
      }),
    ).resolves.toMatchObject({ ok: false, status: 403 })
    expect(invalidated).toHaveBeenCalledOnce()
  })

  test('updates a sprint directly while preserving tenant and project grant checks', async () => {
    const { invoke, database, invalidated } = fixture()
    database.sqlite.exec(
      "INSERT INTO sprints (id,workspace_id,project_id,name,status,created_at,updated_at) VALUES ('sprint-a','workspace-a','project-a','Original','planned',1,1),('sprint-hidden','workspace-a','hidden-project','Hidden','planned',1,1),('sprint-other','workspace-b','other-project','Other','planned',1,1)",
    )
    const patch = { name: 'Updated', goal: 'Direct command', status: 'active', startDate: null, endDate: null }
    for (const sprintId of ['sprint-hidden', 'sprint-other']) {
      await expect(invoke(updateSprint, { workspaceSlug: workspace.slug, sprintId, patch })).resolves.toMatchObject({
        ok: false,
        status: 404,
      })
    }
    await expect(
      invoke(updateSprint, { workspaceSlug: workspace.slug, sprintId: 'sprint-a', patch }),
    ).resolves.toMatchObject({
      ok: true,
      value: { ok: true },
    })
    expect(database.sqlite.prepare("SELECT name,goal,status FROM sprints WHERE id = 'sprint-a'").get()).toEqual({
      goal: 'Direct command',
      name: 'Updated',
      status: 'active',
    })
    expect(invalidated).toHaveBeenCalledTimes(3)
  })

  test('removes both stored bytes and attachment metadata through the shared storage command', async () => {
    const { invoke, database, r2, invalidated } = fixture()
    database.sqlite.exec(
      "UPDATE attachments SET kind = 'file', r2_key = 'workspace-a/file-a', filename = 'file.txt', content_type = 'text/plain', size = 4, url = NULL WHERE id = 'file-a'",
    )
    await r2.put('workspace-a/file-a', 'data')
    await expect(
      invoke(deleteAttachment, { workspaceSlug: workspace.slug, issueId: 'issue-a', attachmentId: 'file-a' }),
    ).resolves.toMatchObject({ ok: true, value: { ok: true } })
    await expect(r2.get('workspace-a/file-a')).resolves.toBeNull()
    expect(database.sqlite.prepare("SELECT id FROM attachments WHERE id = 'file-a'").get()).toBeUndefined()
    expect(invalidated).toHaveBeenCalledOnce()
  })

  test('persists comment creation, editing and deletion with authenticated authorship', async () => {
    const { invoke, database, invalidated } = fixture()
    const identity = { workspaceSlug: workspace.slug, issueId: 'issue-a' }
    await expect(invoke(addComment, { ...identity, body: 'Added directly' })).resolves.toMatchObject({
      ok: true,
      value: { id: expect.any(String) },
    })
    const comment = database.sqlite
      .prepare("SELECT id,author_id,body FROM issue_comments WHERE body = 'Added directly'")
      .get() as { id: string; author_id: string; body: string }
    expect(comment.author_id).toBe(scope.user.id)
    await expect(
      invoke(editComment, { ...identity, commentId: comment.id, body: 'Edited directly' }),
    ).resolves.toMatchObject({
      ok: true,
      value: { ok: true },
    })
    expect(database.sqlite.prepare('SELECT body FROM issue_comments WHERE id = ?').get(comment.id)).toEqual({
      body: 'Edited directly',
    })
    await expect(invoke(deleteComment, { ...identity, commentId: comment.id })).resolves.toMatchObject({
      ok: true,
      value: { ok: true },
    })
    expect(database.sqlite.prepare('SELECT id FROM issue_comments WHERE id = ?').get(comment.id)).toBeUndefined()
    expect(invalidated).toHaveBeenCalledTimes(3)
  })

  test('preserves comment ownership and issue association for edit and delete commands', async () => {
    const { invoke, database, invalidated } = fixture()
    database.sqlite.exec(
      "INSERT INTO users (id,email,name,created_at) VALUES ('author-b','other@example.test','Other',1); INSERT INTO issue_comments (id,issue_id,author_id,body,created_at,updated_at) VALUES ('foreign-comment','issue-a','author-b','Unchanged',1,1),('other-comment','issue-b','user-a','Other issue',1,1)",
    )
    for (const action of [editComment, deleteComment]) {
      await expect(
        invoke(action, {
          workspaceSlug: workspace.slug,
          issueId: 'issue-a',
          commentId: 'foreign-comment',
          body: 'Changed',
        }),
      ).resolves.toMatchObject({ ok: false, status: 403 })
      await expect(
        invoke(action, {
          workspaceSlug: workspace.slug,
          issueId: 'issue-a',
          commentId: 'other-comment',
          body: 'Changed',
        }),
      ).resolves.toMatchObject({ ok: false, status: 404 })
    }
    expect(database.sqlite.prepare("SELECT body FROM issue_comments WHERE id = 'foreign-comment'").get()).toEqual({
      body: 'Unchanged',
    })
    expect(database.sqlite.prepare("SELECT body FROM issue_comments WHERE id = 'other-comment'").get()).toEqual({
      body: 'Other issue',
    })
    expect(invalidated).toHaveBeenCalledTimes(4)
  })

  test('persists canonical links and refuses deletion under a different issue', async () => {
    const { invoke, database, invalidated } = fixture()
    const identity = { workspaceSlug: workspace.slug, issueId: 'issue-a' }
    await expect(
      invoke(addIssueLink, { ...identity, targetIssueId: 'issue-b', type: 'blocked_by' }),
    ).resolves.toMatchObject({
      ok: true,
      value: { id: expect.any(String) },
    })
    const link = database.sqlite.prepare('SELECT id,source_issue_id,target_issue_id,type FROM issue_links').get() as {
      id: string
    }
    expect(link).toMatchObject({ source_issue_id: 'issue-b', target_issue_id: 'issue-a', type: 'blocks' })
    database.insertIssue({ id: 'issue-c', number: 3 })
    await expect(
      invoke(deleteIssueLink, { workspaceSlug: workspace.slug, issueId: 'issue-c', linkId: link.id }),
    ).resolves.toMatchObject({ ok: false, status: 404 })
    expect(database.sqlite.prepare('SELECT id FROM issue_links WHERE id = ?').get(link.id)).toBeDefined()
    await expect(invoke(deleteIssueLink, { ...identity, linkId: link.id })).resolves.toMatchObject({
      ok: true,
      value: { ok: true },
    })
    expect(database.sqlite.prepare('SELECT id FROM issue_links WHERE id = ?').get(link.id)).toBeUndefined()
    expect(invalidated).toHaveBeenCalledTimes(3)
  })

  test('persists hashed share tokens and link attachment DTOs through concrete commands', async () => {
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
    await expect(
      invoke(addAttachmentLink, {
        ...identity,
        link: { kind: 'url', url: 'https://example.test/direct', label: 'Direct' },
      }),
    ).resolves.toMatchObject({ ok: true, value: { id: expect.any(String), kind: 'url' } })
    expect(
      database.sqlite
        .prepare("SELECT entity_type,entity_id,url FROM attachments WHERE url = 'https://example.test/direct'")
        .get(),
    ).toEqual({ entity_type: 'issue', entity_id: 'issue-a', url: 'https://example.test/direct' })
    expect(invalidated).toHaveBeenCalledTimes(2)
  })

  test.each(['http://example.test/path', 'https://example.test/path', 'mailto:review@example.test'])(
    'persists a standard URL through the decoded Web boundary: %s',
    async (url) => {
      const { invoke, database } = fixture()
      await expect(
        invoke(addAttachmentLink, {
          workspaceSlug: workspace.slug,
          issueId: 'issue-a',
          link: { kind: 'url', url },
        }),
      ).resolves.toMatchObject({ ok: true, value: { id: expect.any(String), kind: 'url' } })
      expect(database.sqlite.prepare('SELECT url FROM attachments WHERE url = ?').get(url)).toEqual({ url })
    },
  )

  test.each(['not-a-url', 'https://[broken', '/relative/path'])(
    'rejects malformed URLs before Web command execution: %s',
    async (url) => {
      const { invoke, database, invalidated } = fixture()
      const before = database.sqlite.prepare('SELECT id,url FROM attachments ORDER BY id').all()
      await expect(
        invoke(addAttachmentLink, {
          workspaceSlug: workspace.slug,
          issueId: 'issue-a',
          link: { kind: 'url', url },
        }),
      ).rejects.toThrow()
      expect(database.sqlite.prepare('SELECT id,url FROM attachments ORDER BY id').all()).toEqual(before)
      expect(invalidated).not.toHaveBeenCalled()
    },
  )

  test('enforces actual read-only project grants for issue, link, share and attachment commands', async () => {
    const { invoke, database, invalidated } = fixture()
    database.sqlite.exec("UPDATE group_project_grants SET role = 'viewer' WHERE project_id = 'project-a'")
    const identity = { workspaceSlug: workspace.slug, issueId: 'issue-a' }
    await expect(invoke(updateIssue, { ...identity, patch: { title: 'Denied' } })).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    await expect(
      invoke(addIssueLink, { ...identity, targetIssueId: 'issue-b', type: 'blocks' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    await expect(invoke(shareIssue, identity)).resolves.toMatchObject({ ok: false, status: 403 })
    await expect(
      invoke(addAttachmentLink, { ...identity, link: { kind: 'url', url: 'https://example.test/denied' } }),
    ).resolves.toMatchObject({ ok: false, status: 403 })
    expect(database.sqlite.prepare("SELECT title FROM issues WHERE id = 'issue-a'").get()).toEqual({
      title: 'Original issue',
    })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issue_links').get()).toEqual({ count: 0 })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM share_tokens').get()).toEqual({ count: 0 })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM attachments').get()).toEqual({ count: 1 })
    expect(invalidated).toHaveBeenCalledTimes(4)
  })

  test('resolves an entity in the explicit workspace and checks its authorized catalog project', async () => {
    const valid = fixture()
    await expect(valid.invoke(readIssue, { workspaceSlug: workspace.slug, issueId: 'issue-a' })).resolves.toMatchObject(
      {
        ok: true,
        value: { id: 'issue-a', workspaceSlug: workspace.slug },
      },
    )
    expect(valid.invalidated).not.toHaveBeenCalled()
    const hidden = fixture()
    await expect(
      hidden.invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        issueId: 'hidden-issue',
        patch: { title: 'Changed' },
      }),
    ).resolves.toMatchObject({ ok: false, status: 404 })
    expect(hidden.database.sqlite.prepare("SELECT title FROM issues WHERE id = 'hidden-issue'").get()).toEqual({
      title: 'Hidden secret',
    })
    expect(hidden.invalidated).toHaveBeenCalledOnce()
  })

  test('builds project list and search contracts from D1, without query refresh', async () => {
    const { invoke, database, invalidated } = fixture()
    await expect(
      invoke(readIssuePage, {
        workspaceSlug: workspace.slug,
        projectId: project.id,
        limit: 30,
      }),
    ).resolves.toMatchObject({ ok: true, value: { items: [{ id: 'issue-a' }], total: 1 } })
    await expect(
      invoke(searchIssues, {
        workspaceSlug: workspace.slug,
        projectId: project.id,
        query: 'Original',
      }),
    ).resolves.toMatchObject({ ok: true, value: [{ id: 'issue-a', project_id: project.id }] })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 4 })
    expect(invalidated).not.toHaveBeenCalled()
  })

  test.each([
    { issueId: 'hidden-issue' },
    { issueId: 'other-issue' },
    { issueId: 'missing-issue' },
    { issueId: 'issue-b', projectId: project.id },
    { issueId: 'issue-a', parentId: 'hidden-issue' },
    { issueId: 'issue-a', parentId: 'other-issue' },
    { issueId: 'issue-a', projectId: project.id, parentId: 'issue-b' },
  ])('rejects inaccessible mutation references from D1: %j', async ({ issueId, projectId, parentId }) => {
    const { invoke, database, invalidated } = fixture()
    await expect(
      invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        ...(projectId ? { projectId } : {}),
        issueId,
        patch: { title: 'Changed', ...(parentId ? { parentId } : {}) },
      }),
    ).resolves.toMatchObject({ ok: false, status: 404 })
    expect(
      database.sqlite
        .prepare('SELECT title FROM issues WHERE id = ?')
        .get(issueId === 'missing-issue' ? 'issue-a' : issueId),
    ).toMatchObject({ title: expect.not.stringMatching(/^Changed$/) })
    expect(invalidated).toHaveBeenCalledOnce()
  })

  test('preserves archived project visibility only through an explicit authorized project selector', async () => {
    const { invoke, database } = fixture()
    database.sqlite.exec("UPDATE projects SET archived_at = 2 WHERE id IN ('project-a', 'hidden-project')")
    await expect(
      invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        issueId: 'issue-a',
        patch: { title: 'Changed' },
      }),
    ).resolves.toMatchObject({ ok: false, status: 404 })
    await expect(
      invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        projectId: 'hidden-project',
        issueId: 'hidden-issue',
        patch: { title: 'Changed' },
      }),
    ).resolves.toMatchObject({ ok: false, status: 404 })
    await expect(
      invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        projectId: project.id,
        issueId: 'issue-a',
        patch: { title: 'Changed' },
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(database.sqlite.prepare("SELECT title FROM issues WHERE id = 'issue-a'").get()).toEqual({ title: 'Changed' })
  })

  test('independently authorizes comments, links, attachments and wiki searches before direct reads', async () => {
    const { invoke, database, invalidated } = fixture()
    const identity = { workspaceSlug: workspace.slug, issueId: 'A-1' }
    await expect(invoke(readComments, identity)).resolves.toMatchObject({
      ok: true,
      value: [{ id: 'comment-a', author_id: scope.user.id }],
    })
    await expect(invoke(readLinks, identity)).resolves.toEqual({ ok: true, value: [] })
    await expect(invoke(readAttachments, identity)).resolves.toMatchObject({
      ok: true,
      value: [{ id: 'file-a', kind: 'url' }],
    })
    await expect(
      invoke(searchWikiAttachments, { workspaceSlug: workspace.slug, query: 'guide' }),
    ).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        { id: 'wiki-a', title: 'Visible guide', slug: 'guide', project_id: project.id },
        { id: 'wiki-global', title: 'Workspace guide', slug: 'workspace-guide', project_id: null },
      ]),
    })
    for (const read of [readIssue, readComments, readLinks, readAttachments]) {
      await expect(invoke(read, { workspaceSlug: workspace.slug, issueId: 'hidden-issue' })).resolves.toMatchObject({
        ok: false,
        status: 404,
      })
      await expect(
        invoke(read, {
          workspaceSlug: workspace.slug,
          projectId: project.id,
          issueId: 'issue-b',
        }),
      ).resolves.toMatchObject({ ok: false, status: 404 })
    }
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 4 })
    expect(invalidated).not.toHaveBeenCalled()
  })

  test('rejects malformed cursor input through Effect Schema before the shared query', async () => {
    const { invoke, database } = fixture()
    await expect(invoke(readIssuePage, { workspaceSlug: workspace.slug, cursor: 'next' })).resolves.toMatchObject({
      ok: false,
      status: 400,
    })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 4 })
  })

  test('rejects cross-origin writes before any backend read and invalidates expected failures', async () => {
    const { invoke, database, invalidated } = fixture({ origin: 'https://evil.test' })
    const data = new FormData()
    data.set('workspaceSlug', workspace.slug)
    data.set('projectId', project.id)
    data.set('title', 'Created')
    await expect(invoke(createIssue, [null, data])).resolves.toMatchObject({ ok: false, status: 403 })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 4 })
    expect(invalidated).toHaveBeenCalledOnce()
  })

  test('passes only schema-selected issue fields to explicit shared commands', async () => {
    const native = fixture()
    const formData = new FormData()
    formData.set('workspaceSlug', workspace.slug)
    formData.set('projectId', project.id)
    formData.set('title', '  Created natively  ')
    formData.set('priority', 'medium')
    formData.set('method', 'DELETE')
    formData.set('path', '/api/workspaces/other')
    await expect(native.invoke(createIssue, [null, formData])).resolves.toMatchObject({ ok: true })
    expect(
      native.database.sqlite
        .prepare("SELECT project_id,title,priority FROM issues WHERE title = 'Created natively'")
        .get(),
    ).toEqual({ project_id: project.id, title: 'Created natively', priority: 'medium' })
    expect(native.database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 5 })
    expect(native.invalidated).toHaveBeenCalledOnce()
    const { invoke, database, invalidated } = fixture()
    await expect(
      invoke(updateIssue, {
        workspaceSlug: workspace.slug,
        issueId: 'issue-a',
        patch: { title: 'Changed', path: '/api/workspaces/other' },
        method: 'DELETE',
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(database.sqlite.prepare("SELECT title FROM issues WHERE id = 'issue-a'").get()).toEqual({ title: 'Changed' })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 4 })
    expect(invalidated).toHaveBeenCalledOnce()
  })

  test("will not delete an attachment absent from the issue's server-loaded attachment set", async () => {
    const { invoke, database } = fixture()
    database.sqlite.exec(`
      INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,url,entity_type,entity_id,created_by_id,created_at) VALUES
        ('foreign-attachment','workspace-a','url','','Other issue','text/uri-list',0,'https://example.test','issue','issue-b','user-a',1),
        ('foreign-workspace','workspace-b','url','','Other workspace','text/uri-list',0,'https://example.test','issue','issue-a','user-a',1),
        ('wiki-attachment','workspace-a','url','','Wiki','text/uri-list',0,'https://example.test','wiki_page','issue-a','user-a',1);
    `)
    for (const attachmentId of ['foreign-attachment', 'foreign-workspace', 'wiki-attachment', 'missing-attachment']) {
      await expect(
        invoke(deleteAttachment, {
          workspaceSlug: workspace.slug,
          issueId: 'issue-a',
          attachmentId,
        }),
      ).resolves.toMatchObject({ ok: false, status: 404 })
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

  test('deletes an issue-owned attachment through shared storage command after direct retrieval', async () => {
    const { invoke, database, invalidated } = fixture()
    await expect(
      invoke(deleteAttachment, {
        workspaceSlug: workspace.slug,
        projectId: project.id,
        issueId: 'issue-a',
        attachmentId: 'file-a',
      }),
    ).resolves.toMatchObject({ ok: true, value: { ok: true } })
    expect(database.sqlite.prepare("SELECT id FROM attachments WHERE id = 'file-a'").get()).toBeUndefined()
    expect(invalidated).toHaveBeenCalledOnce()
  })

  test.each([{ issueId: 'hidden-issue' }, { issueId: 'other-issue' }, { issueId: 'issue-b', projectId: project.id }])(
    'rejects attachment deletion under an inaccessible issue: %j',
    async ({ issueId, projectId }) => {
      const { invoke, database, invalidated } = fixture()
      await expect(
        invoke(deleteAttachment, {
          workspaceSlug: workspace.slug,
          ...(projectId ? { projectId } : {}),
          issueId,
          attachmentId: 'file-a',
        }),
      ).resolves.toMatchObject({ ok: false, status: 404 })
      expect(database.sqlite.prepare("SELECT entity_id FROM attachments WHERE id = 'file-a'").get()).toEqual({
        entity_id: 'issue-a',
      })
      expect(invalidated).toHaveBeenCalledOnce()
    },
  )
})
