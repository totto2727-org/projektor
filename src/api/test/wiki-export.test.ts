import { unzipSync } from 'fflate'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test'

import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture, seedProject, seedProjectFixture } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

/*
 * MAX_EXPORT_PAGES in services/wiki-export.ts — kept in sync manually since the
 * constant isn't exported; a mismatch would just make this test seed a few more/fewer
 * rows than strictly necessary, not silently pass.
 */
const MAX_EXPORT_PAGES = 500

/**
 * Seeds `count` wiki pages directly via SQL (bypassing the create-page API) so a
 * page-count-cap test stays fast — content bodies are kept empty since the cap must
 * reject the export before any page content is ever fetched.
 */
const seedManyPages = async function seedManyPages(
  workspaceId: string,
  userId: string,
  count: number,
  projectId: string | null = null,
): Promise<void> {
  const now = currentEpochSeconds()
  const statements = Array.from({ length: count }, (_value, index) =>
    env.DB.prepare(
      `INSERT INTO wiki_pages (id, workspace_id, project_id, slug, title, content,
			 parent_id, created_by_id, updated_by_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, '', NULL, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      workspaceId,
      projectId,
      `bulk-page-${index}`,
      `Bulk Page ${index}`,
      userId,
      userId,
      now,
      now,
    ),
  )
  await env.DB.batch(statements)
}

const createPage = async function createPage(
  token: string,
  slug: string,
  body: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  const res = await fetchNativeApi('http://localhost/api/wiki', {
    method: 'POST',
    headers: authHeaders(token, slug),
    body: JSON.stringify(body),
  })
  expect(res.status).toBe(201)
  return res.json()
}

const uploadAttachment = async function uploadAttachment(
  token: string,
  slug: string,
  pageId: string,
  filename: string,
  content: string,
): Promise<void> {
  const form = new FormData()
  form.append('file', new File([content], filename, { type: 'text/plain' }))
  form.append('entityType', 'wiki_page')
  form.append('entityId', pageId)
  const res = await fetchNativeApi('http://localhost/api/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Slug': slug },
    body: form,
  })
  expect(res.status).toBe(201)
}

const exportZip = async function exportZip(
  token: string,
  slug: string,
  query: string,
): Promise<{ status: number; entries?: Record<string, Uint8Array> }> {
  const res = await fetchNativeApi(`http://localhost/api/wiki/export?${query}`, {
    headers: authHeaders(token, slug),
  })
  if (res.status !== 200) {
    return { status: res.status }
  }
  expect(res.headers.get('content-type')).toBe('application/zip')
  const buf = new Uint8Array(await res.arrayBuffer())
  return { status: res.status, entries: unzipSync(buf) }
}

const entryText = function entryText(entries: Record<string, Uint8Array>, path: string): string {
  return new TextDecoder().decode(entries[path])
}

describe('wiki export (PROJ-497)', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let userId: string

  beforeEach(async () => {
    const fixture = await seedFixture({ role: 'admin' })
    token = fixture.token
    slug = fixture.workspace.slug
    workspaceId = fixture.workspace.id
    userId = fixture.user.id
  })

  test('exports workspace-level pages with frontmatter when scope=space and no projectId', async () => {
    await createPage(token, slug, {
      title: 'Runbook One',
      content: '---\ntype: runbook\n---\nBody one',
    })
    await createPage(token, slug, { title: 'Note Two', content: 'Plain body, no frontmatter' })

    const { status, entries } = await exportZip(token, slug, 'scope=space')
    expect(status).toBe(200)
    const names = Object.keys(entries ?? {}).toSorted()
    expect(names).toEqual(['pages/note-two.md', 'pages/runbook-one.md'])

    expect(entryText(entries!, 'pages/runbook-one.md')).toContain('type: runbook')
    expect(entryText(entries!, 'pages/runbook-one.md')).toContain('Body one')

    // Page with no frontmatter block gets a minimal one synthesized (title only).
    const noteText = entryText(entries!, 'pages/note-two.md')
    expect(noteText).toMatch(/^---\ntitle: Note Two\n---\n/u)
    expect(noteText).toContain('Plain body, no frontmatter')
  })

  test('scopes scope=space to a single project, excluding workspace-level pages', async () => {
    const project = await seedProject(workspaceId)
    await createPage(token, slug, { title: 'Workspace Page', content: 'ws' })
    await createPage(token, slug, {
      title: 'Project Page',
      content: 'proj',
      projectId: project.id,
    })

    const { entries } = await exportZip(token, slug, `scope=space&projectId=${project.id}`)
    expect(Object.keys(entries ?? {})).toEqual(['pages/project-page.md'])
  })

  test('exports a subtree: the target page plus all descendants, excluding unrelated pages', async () => {
    const root = await createPage(token, slug, { title: 'Root', content: 'root body' })
    const child = await createPage(token, slug, {
      title: 'Child',
      content: 'child body',
      parentId: root.id,
    })
    await createPage(token, slug, {
      title: 'Grandchild',
      content: 'grandchild body',
      parentId: child.id,
    })
    await createPage(token, slug, { title: 'Unrelated', content: 'unrelated body' })

    const { entries } = await exportZip(token, slug, `scope=subtree&pageId=${root.slug}`)
    const names = Object.keys(entries ?? {}).toSorted()
    expect(names).toEqual(['pages/child.md', 'pages/grandchild.md', 'pages/root.md'])
  })

  test('includes file attachments under attachments/<page-slug>/', async () => {
    const page = await createPage(token, slug, { title: 'With Attachment', content: 'see file' })
    await uploadAttachment(token, slug, page.id, 'notes.txt', 'attachment bytes')

    const { entries } = await exportZip(token, slug, 'scope=space')
    expect(Object.keys(entries ?? {}).toSorted()).toEqual([
      'attachments/with-attachment/notes.txt',
      'pages/with-attachment.md',
    ])
    expect(entryText(entries!, 'attachments/with-attachment/notes.txt')).toBe('attachment bytes')
  })

  test("never leaks another workspace's pages into a space export", async () => {
    await createPage(token, slug, { title: 'Mine', content: 'mine' })

    const other = await seedFixture({ role: 'admin' })
    await createPage(other.token, other.workspace.slug, { title: 'Theirs', content: 'theirs' })

    const { entries } = await exportZip(token, slug, 'scope=space')
    expect(Object.keys(entries ?? {})).toEqual(['pages/mine.md'])
  })

  test('404s a subtree export for a page id/slug from a different workspace', async () => {
    const other = await seedFixture({ role: 'admin' })
    const otherPage = await createPage(other.token, other.workspace.slug, {
      title: 'Theirs',
      content: 'theirs',
    })

    const { status } = await exportZip(token, slug, `scope=subtree&pageId=${otherPage.id}`)
    expect(status).toBe(404)
  })

  test('404s a space export scoped to a project the caller has no grant on', async () => {
    const member = await seedFixture({ role: 'member' })
    const project = await seedProject(member.workspace.id) // No group grant for member.user

    const { status } = await exportZip(member.token, member.workspace.slug, `scope=space&projectId=${project.id}`)
    expect(status).toBe(404)
  })

  test('allows a project export for a member with a group grant on that project', async () => {
    const fixture = await seedProjectFixture({ role: 'member' })
    await createPage(fixture.token, fixture.slug, {
      title: 'Granted',
      content: 'granted',
      projectId: fixture.projectId,
    })

    const { status, entries } = await exportZip(
      fixture.token,
      fixture.slug,
      `scope=space&projectId=${fixture.projectId}`,
    )
    expect(status).toBe(200)
    expect(Object.keys(entries ?? {})).toEqual(['pages/granted.md'])
  })

  test('400s when scope is missing or invalid', async () => {
    const res = await fetchNativeApi('http://localhost/api/wiki/export?scope=bogus', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(400)
  })

  test('keeps colliding attachment filenames distinct in the zip, with correct content each', async () => {
    const page = await createPage(token, slug, { title: 'Collide', content: 'body' })
    /*
     * The second "notes.txt" renames to "1-notes.txt", which must not clobber the
     * real "1-notes.txt" uploaded after it.
     */
    await uploadAttachment(token, slug, page.id, 'notes.txt', 'first')
    await uploadAttachment(token, slug, page.id, 'notes.txt', 'second')
    await uploadAttachment(token, slug, page.id, '1-notes.txt', 'third')

    const { status, entries } = await exportZip(token, slug, 'scope=space')
    expect(status).toBe(200)
    const names = Object.keys(entries ?? {})
      .filter((key) => key.startsWith('attachments/'))
      .toSorted()
    expect(names).toHaveLength(3)

    const contents = names.map((n) => entryText(entries!, n)).sort()
    expect(contents).toEqual(['first', 'second', 'third'])
  })

  test("defensively excludes a descendant whose projectId mismatches the subtree root's", async () => {
    const project = await seedProject(workspaceId)
    const root = await createPage(token, slug, {
      title: 'Root',
      content: 'root body',
      projectId: project.id,
    })
    const now = currentEpochSeconds()
    const mismatchedId = crypto.randomUUID()
    /*
     * Bypasses validateNewPageParent (services/wiki.ts), which normally forbids a
     * child's projectId from diverging from its parent's — writing directly via SQL
     * simulates a regression of that write-time invariant.
     */
    await env.DB.prepare(
      `INSERT INTO wiki_pages (id, workspace_id, project_id, slug, title, content,
			 parent_id, created_by_id, updated_by_id, created_at, updated_at)
			 VALUES (?, ?, NULL, ?, ?, ?, ?, (SELECT created_by_id FROM wiki_pages WHERE id = ?),
				 (SELECT updated_by_id FROM wiki_pages WHERE id = ?), ?, ?)`,
    )
      .bind(
        mismatchedId,
        workspaceId,
        'mismatched-child',
        'Mismatched Child',
        'child body',
        root.id,
        root.id,
        root.id,
        now,
        now,
      )
      .run()

    const { status, entries } = await exportZip(token, slug, `scope=subtree&pageId=${root.slug}`)
    expect(status).toBe(200)
    const names = Object.keys(entries ?? {})
    expect(names).toEqual(['pages/root.md'])
  })

  /*
   * Follow-up: these two tests only assert the 400 status, not that the cap check ran
   * before content was fetched — a mutation reverting the early-exit ordering would
   * still pass. Properly covering that needs a query-recording proxy on ctx.db.
   */
  test('rejects a space export whose page count exceeds the cap before fetching content', async () => {
    await seedManyPages(workspaceId, userId, MAX_EXPORT_PAGES + 1)

    const { status } = await exportZip(token, slug, 'scope=space')
    expect(status).toBe(400)
  })

  test('rejects a subtree export whose descendant count exceeds the cap during the BFS walk', async () => {
    const root = await createPage(token, slug, { title: 'Big Root', content: 'root' })
    /*
     * Every bulk page is parented directly under root, so collectDescendantIds's BFS
     * sees the whole set on its first level and must bail before pagesByIds fetches
     * content for MAX_EXPORT_PAGES+1 rows.
     */
    const now = currentEpochSeconds()
    const statements = Array.from({ length: MAX_EXPORT_PAGES + 1 }, (_value, index) =>
      env.DB.prepare(
        `INSERT INTO wiki_pages (id, workspace_id, project_id, slug, title, content,
				 parent_id, created_by_id, updated_by_id, created_at, updated_at)
				 VALUES (?, ?, NULL, ?, ?, '', ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        workspaceId,
        `bulk-child-${index}`,
        `Bulk Child ${index}`,
        root.id,
        userId,
        userId,
        now,
        now,
      ),
    )
    await env.DB.batch(statements)

    const { status } = await exportZip(token, slug, `scope=subtree&pageId=${root.slug}`)
    expect(status).toBe(400)
  })
  // PROJ-813: trashed pages must never leave the workspace via export.
  describe('trashed pages (PROJ-813)', () => {
    // Each test here makes more than RATE_LIMIT_API_MAX (5) calls on one token.
    let originalMax: unknown
    beforeAll(() => {
      originalMax = (env as unknown as Record<string, unknown>).RATE_LIMIT_API_MAX
      ;(env as unknown as Record<string, unknown>).RATE_LIMIT_API_MAX = '1000'
    })
    afterAll(() => {
      ;(env as unknown as Record<string, unknown>).RATE_LIMIT_API_MAX = originalMax
    })

    const trash = async function trash(pageId: string): Promise<void> {
      const res = await fetchNativeApi(`http://localhost/api/wiki/${pageId}`, {
        headers: authHeaders(token, slug),
        method: 'DELETE',
      })
      expect(res.status).toBeLessThan(300)
    }

    test('omits a trashed page from a space export', async () => {
      await createPage(token, slug, { title: 'Kept', content: 'kept body' })
      const leaked = await createPage(token, slug, { title: 'Leaked Secret', content: 'hunter2' })
      await trash(leaked.id)

      const { entries } = await exportZip(token, slug, 'scope=space')
      expect(Object.keys(entries ?? {})).toEqual(['pages/kept.md'])
    })

    test('with a reused slug, exports only the live page and resolves the subtree root to it', async () => {
      const old = await createPage(token, slug, { title: 'Notes', content: 'old secret' })
      await trash(old.id)
      const live = await createPage(token, slug, { title: 'Notes', content: 'live body' })
      expect(live.slug).toBe(old.slug)
      await createPage(token, slug, { title: 'Live Child', content: 'c', parentId: live.id })

      const space = await exportZip(token, slug, 'scope=space')
      const spaceNames = Object.keys(space.entries ?? {}).toSorted()
      expect(spaceNames).toEqual(['pages/live-child.md', `pages/${live.slug}.md`])
      expect(entryText(space.entries!, `pages/${live.slug}.md`)).toContain('live body')
      expect(entryText(space.entries!, `pages/${live.slug}.md`)).not.toContain('old secret')

      const sub = await exportZip(token, slug, `scope=subtree&pageId=${live.slug}`)
      expect(sub.status).toBe(200)
      expect(Object.keys(sub.entries ?? {}).toSorted()).toEqual(['pages/live-child.md', `pages/${live.slug}.md`])
      expect(entryText(sub.entries!, `pages/${live.slug}.md`)).toContain('live body')
    })

    test('excludes a trashed descendant from a subtree export and 404s a trashed root', async () => {
      const root = await createPage(token, slug, { title: 'Tree Root', content: 'r' })
      const gone = await createPage(token, slug, {
        title: 'Gone Child',
        content: 'g',
        parentId: root.id,
      })
      await createPage(token, slug, { title: 'Kept Child', content: 'k', parentId: root.id })
      await trash(gone.id)

      const { entries } = await exportZip(token, slug, `scope=subtree&pageId=${root.id}`)
      expect(Object.keys(entries ?? {}).toSorted()).toEqual(['pages/kept-child.md', 'pages/tree-root.md'])

      await trash(root.id)
      const after = await exportZip(token, slug, `scope=subtree&pageId=${root.id}`)
      expect(after.status).toBe(404)
    })
  })
})
