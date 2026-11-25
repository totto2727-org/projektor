import { String } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { wikiRouter } from '#api/routes/wiki.ts'
import { RESERVED_WIKI_SLUGS } from '#commands/wiki.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import m0060 from '#migrations/0060_wiki_reserved_slug_rename.sql?raw'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { IdResponse, SlugResponse, readNativeJson } from './response-json.ts'

/*
 * PROJ-811: every fixed first path segment under /api/wiki is matched before the /:slug
 * catch-all, so a page with that slug could never load.
 */
describe('reserved wiki slugs (PROJ-811)', () => {
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

  test('reserves every fixed first segment registered on the wiki router', () => {
    const fixedSegments = new Set(
      wikiRouter.routes
        .map((r) => r.path.split('/')[1] ?? '')
        .filter((seg) => String.isNonEmpty(seg) && !seg.startsWith(':') && seg !== '*'),
    )
    expect(fixedSegments.size).toBeGreaterThan(5)
    const missing = [...fixedSegments].filter((seg) => !RESERVED_WIKI_SLUGS.has(seg))
    expect(missing).toStrictEqual([])
  })

  test('auto-slugs a reserved title with a -page suffix, and the page loads', async () => {
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'body', title: 'Search' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const page = await readNativeJson(res, SlugResponse)
    expect(page.slug).toBe('search-page')

    const get = await fetchNativeApi(`http://localhost/api/wiki/${page.slug}`, {
      headers: authHeaders(token, slug),
    })
    expect(get.status).toBe(200)
  })

  test('rejects choosing a reserved slug explicitly, on create and on rename', async () => {
    const created = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ slug: 'trash', title: 'Bin' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(created.status).toBe(400)

    const ok = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Plain' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const page = await readNativeJson(ok, IdResponse)
    const renamed = await fetchNativeApi(`http://localhost/api/wiki/${page.id}`, {
      body: JSON.stringify({ slug: 'tree' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(renamed.status).toBe(400)
  })

  test('migration 0060 renames existing pages off reserved slugs, trashed ones included', async () => {
    const now = currentEpochSeconds()
    const insert = (pageSlug: string, deletedAt: number | null) => {
      const id = crypto.randomUUID()
      return {
        id,
        stmt: env.DB.prepare(
          `INSERT INTO wiki_pages (id, workspace_id, project_id, slug, title, content,
					 parent_id, created_by_id, updated_by_id, created_at, updated_at, deleted_at)
					 VALUES (?, ?, NULL, ?, ?, '', NULL, ?, ?, ?, ?, ?)`,
        ).bind(id, workspaceId, pageSlug, pageSlug, userId, userId, now, now, deletedAt),
      }
    }
    const search = insert('search', null)
    const exportPage = insert('export', null)
    // Forces the second pass
    const exportTaken = insert('export-page', null)
    const trashed = insert('trash', now)
    await env.DB.batch([search.stmt, exportPage.stmt, exportTaken.stmt, trashed.stmt])

    const statements = m0060
      .replaceAll(/--[^\n]*/g, '')
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => String.isNonEmpty(statement))
    for (const stmt of statements) {
      await env.DB.prepare(stmt).run()
    }

    const slugOf = async (id: string): Promise<undefined | string> =>
      (
        await env.DB.prepare('SELECT slug FROM wiki_pages WHERE id = ?').bind(id).first<{
          slug: string
        }>()
      )?.slug
    await expect(slugOf(search.id)).resolves.toBe('search-page')
    await expect(slugOf(exportTaken.id)).resolves.toBe('export-page')
    await expect(slugOf(exportPage.id)).resolves.toBe(`export-page-${exportPage.id.replaceAll('-', '').slice(0, 8)}`)
    await expect(slugOf(trashed.id)).resolves.toBe('trash-page')

    const reservedLeft = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM wiki_pages WHERE workspace_id = ? AND slug IN (${[...RESERVED_WIKI_SLUGS]
        .map(() => '?')
        .join(',')})`,
    )
      .bind(workspaceId, ...RESERVED_WIKI_SLUGS)
      .first<{ n: number }>()
    expect(reservedLeft?.n).toBe(0)
  })
})
