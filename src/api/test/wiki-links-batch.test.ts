import { Predicate } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

/*
 * PROJ-858: saving a page resolves its slug links in a fixed number of queries,
 * not 1–3 per link, and produces the same wiki_links rows as before.
 */
import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

describe('covers PROJ-858: batched slug link resolution on save', () => {
  afterEach(() => vi.restoreAllMocks())

  test('200 distinct slug links (direct, redirected, missing) resolve correctly in O(1) reads', async () => {
    const { workspace, user, token } = await seedFixture({ role: 'owner' })
    const now = currentEpochSeconds()
    const insertPage = (
      id: string,
      slug: string,
      title: string,
      deletedAt: number | null = null,
    ): Promise<D1Result<Record<string, unknown>>> =>
      env.DB.prepare(
        `INSERT INTO wiki_pages (id, workspace_id, project_id, slug, title, content, parent_id,
				   created_by_id, updated_by_id, created_at, updated_at, deleted_at)
				 VALUES (?, ?, NULL, ?, ?, '', NULL, ?, ?, ?, ?, ?)`,
      )
        .bind(id, workspace.id, slug, title, user.id, user.id, now, now, deletedAt)
        .run()

    // 80 pages linked by their current slug.
    const direct: string[] = []
    for (let index = 0; index < 80; index++) {
      const id = crypto.randomUUID()
      direct.push(id)
      await insertPage(id, `direct-${index}`, `Direct ${index}`)
    }
    // 40 pages linked by an old slug (redirect) — 5 of them trashed, so unresolved.
    const redirected: string[] = []
    for (let index = 0; index < 40; index++) {
      const id = crypto.randomUUID()
      redirected.push(id)
      await insertPage(id, `renamed-${index}`, `Renamed ${index}`, index < 5 ? now : null)
      await env.DB.prepare(
        'INSERT INTO wiki_redirects (id, workspace_id, old_slug, page_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), workspace.id, `old-${index}`, id, now)
        .run()
    }

    const links = [
      ...Array.from({ length: 80 }, (_value, index) => `[d${index}](/wiki/direct-${index})`),
      ...Array.from({ length: 40 }, (_value, index) => `[r${index}](/wiki/old-${index})`),
      ...Array.from({ length: 80 }, (_value, index) => `[m${index}](/wiki/missing-${index})`),
      // Duplicates must not create extra rows or queries
      ...Array.from({ length: 30 }, () => '[again](/wiki/direct-0)'),
    ]

    const sqls: string[] = []
    const orig = env.DB.prepare.bind(env.DB)
    vi.spyOn(env.DB, 'prepare').mockImplementation((q: string) => {
      sqls.push(q)
      return orig(q)
    })

    const res = await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, workspace.slug),
      body: JSON.stringify({ title: 'Hub', content: links.join('\n') }),
    })
    expect(res.status).toBe(201)
    vi.restoreAllMocks()

    /*
     * Every read of wiki_pages / wiki_redirects during the save — slug checks, parent
     * lookups and link resolution together. Per-link resolution made this ~300.
     */
    const wikiReads = sqls.filter((q) => /^select/i.test(q.trim()) && /from "?wiki_(pages|redirects)"?/i.test(q))
    expect(wikiReads.length).toBeLessThanOrEqual(12)

    const { id: hubId } = (await res.json()) as { id: string }
    const rows = await env.DB.prepare('SELECT target_page_id, target_title FROM wiki_links WHERE source_page_id = ?')
      .bind(hubId)
      .all<{ target_page_id: string | null; target_title: string }>()
    const resolvedIds = new Set(
      (rows.results ?? []).map((r) => r.target_page_id).filter((x): x is string => Predicate.isNotNullish(x)),
    )
    const unresolved = (rows.results ?? []).filter((r) => Predicate.isNullish(r.target_page_id))

    expect(resolvedIds).toEqual(new Set([...direct, ...redirected.slice(5)]))
    // 80 missing slugs + 5 redirects whose page is trashed.
    expect(unresolved).toHaveLength(85)
    expect(rows.results ?? []).toHaveLength(80 + 35 + 85)
  })
})
