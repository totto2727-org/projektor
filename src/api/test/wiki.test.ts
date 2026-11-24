import { Schema, String, Iterable, Predicate } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { computeFreshness } from '#commands/wiki-freshness.ts'
import { listWikiChanges } from '#commands/wiki-watchers.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { JSON_NULL } from '#tests/json-null.ts'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  seedFixture,
  seedGroupGrant,
  seedMember,
  seedProject,
  seedToken,
  seedUser,
  seedUserToken,
  seedWorkspaceRoles,
  toolError,
} from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { resetRateLimits } from './rate-limit-reset.ts'
import {
  TitleItemsResponse,
  parseNativeMcpText,
  IdAndSlugResponse,
  IdListResponse,
  IdResponse,
  JsonListResponse,
  SlugListResponse,
  SlugResponse,
  TitleListResponse,
  readNativeJson,
} from './response-json.ts'

/*
 * PROJ-869: wraps a D1Database so every row a `.all()`/`.first()`/`.raw()` call resolves
 * with is pushed into `captured` — used to inspect what actually came back over the D1
 * binding from a service call, since a service's return value (here, WikiChangeEvent)
 * can hide a regression that already happened one layer down (the full row read out of
 * D1). drizzle-orm's D1 driver uses `.raw()` (not `.all()`) whenever a query selects a
 * custom field shape — which is exactly what listWikiChanges' select does — so all three
 * read methods need to be captured, not just `.all()`.
 */
const wrapD1CapturingReads = function wrapD1CapturingReads(db: D1Database, captured: unknown[]): D1Database {
  const READ_METHODS = new Set(['all', 'first', 'raw'])
  return new Proxy(db, {
    get(dbTarget, dbProp, dbReceiver) {
      if (dbProp === 'prepare') {
        return (sql: string) => {
          const stmt = Reflect.get(dbTarget, 'prepare', dbReceiver).call(dbTarget, sql)
          return new Proxy(stmt, {
            get(stmtTarget, stmtProp, stmtReceiver) {
              if (stmtProp === 'bind') {
                return (...args: unknown[]) => {
                  const bound = Reflect.get(stmtTarget, 'bind', stmtReceiver).call(stmtTarget, ...args)
                  return new Proxy(bound, {
                    get(boundTarget, boundProp, boundReceiver) {
                      const orig = Reflect.get(boundTarget, boundProp, boundReceiver)
                      if (Predicate.isString(boundProp) && READ_METHODS.has(boundProp)) {
                        return async (...a: unknown[]) => {
                          const result = await orig.apply(boundTarget, a)
                          captured.push(boundProp === 'all' ? (result as { results: unknown[] }).results : result)
                          return result
                        }
                      }
                      return Predicate.isFunction(orig) ? orig.bind(boundTarget) : orig
                    },
                  })
                }
              }
              const orig = Reflect.get(stmtTarget, stmtProp, stmtReceiver)
              return Predicate.isFunction(orig) ? orig.bind(stmtTarget) : orig
            },
          })
        }
      }
      const orig = Reflect.get(dbTarget, dbProp, dbReceiver)
      return Predicate.isFunction(orig) ? orig.bind(dbTarget) : orig
    },
  })
}

const mcpCall = async function mcpCall<T>(
  workspaceId: string,
  name: string,
  args: unknown,
  headers: Record<string, string>,
): Promise<JsonRpcResult<T> | JsonRpcError> {
  const res = await fetchNativeApi(
    `http://localhost/mcp/${workspaceId}`,
    requestOptionsWithBody(
      'POST',
      headers,
      JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: args, name },
      }),
    ),
  )
  return res.json()
}

const isMcpError = function isMcpError(r: JsonRpcResult | JsonRpcError): r is JsonRpcError {
  return 'error' in r
}

const WikiTags = Schema.Array(Schema.String).pipe(Schema.mutable)
const WikiFrontmatterResponse = Schema.Struct({ status: Schema.String, tags: WikiTags, type: Schema.String })
const WikiPageLinks = Schema.Array(Schema.Struct({ pageId: Schema.String })).pipe(Schema.mutable)
const OptionalWikiDraftResponse = Schema.Union([Schema.Struct({ content: Schema.String }), Schema.Null])

const mcpData = function mcpData<S extends Schema.Constraint>(
  rpc: JsonRpcResult<{ content: { text: string }[] }> | JsonRpcError,
  shape: S,
): S['Type'] {
  if (isMcpError(rpc)) {
    throw new Error(`MCP error: ${rpc.error.message}`)
  }
  return parseNativeMcpText(rpc.result.content[0].text, shape)
}

/*
 * PROJ-238: the test env's RATE_LIMIT_API_MAX is 5 req/window (vite.config.ts), and
 * many describe blocks below fire more than that against one token — reset the counter
 * before every request.
 */
const resetRateLimitAndFetch = async function resetRateLimitAndFetch(
  url: string,
  opts?: RequestInit,
): Promise<Response> {
  await resetRateLimits()
  return fetchNativeApi(url, opts)
}

const resetRateLimitAndMcpCall = async function resetRateLimitAndMcpCall<T>(
  workspaceId: string,
  token: string,
  slug: string,
  name: string,
  args: unknown,
): Promise<JsonRpcError | JsonRpcResult<T>> {
  await resetRateLimits()
  return mcpCall<T>(workspaceId, name, args, authHeaders(token, slug))
}

const seedWorkspaceFixture = async function seedWorkspaceFixture(): Promise<{
  token: string
  slug: string
  workspaceId: string
}> {
  const fixture = await seedFixture()
  return { token: fixture.token, slug: fixture.workspace.slug, workspaceId: fixture.workspace.id }
}

describe('wiki API', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let userId: string

  beforeEach(async () => {
    const fixture = await seedFixture()
    token = fixture.token
    slug = fixture.workspace.slug
    workspaceId = fixture.workspace.id
    userId = fixture.user.id
  })

  test('handles GET /api/wiki returns empty list initially', async () => {
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual([])
  })

  test('handles POST /api/wiki creates a page', async () => {
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '# Welcome', title: 'Getting Started' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const body = await readNativeJson(res, IdAndSlugResponse)
    expect(body.slug).toBe('getting-started')
  })

  describe('canonical page url (PROJ-307)', () => {
    test('create/get/update/list/tree all expose a resolvable url', async () => {
      const createRes = await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({ content: 'index', title: 'Weekly Updates' }),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
      const created = await readNativeJson(createRes, Schema.Struct({ url: Schema.String }))
      expect(created.url).toBe('/wiki/weekly-updates')

      const getRes = await fetchNativeApi('http://localhost/api/wiki/weekly-updates', {
        headers: authHeaders(token, slug),
      })
      const fetched = await readNativeJson(getRes, Schema.Struct({ url: Schema.String }))
      expect(fetched.url).toBe('/wiki/weekly-updates')

      const updateRes = await fetchNativeApi('http://localhost/api/wiki/weekly-updates', {
        body: JSON.stringify({ content: 'index v2' }),
        headers: authHeaders(token, slug),
        method: 'PUT',
      })
      const updated = await readNativeJson(updateRes, Schema.Struct({ url: Schema.String }))
      expect(updated.url).toBe('/wiki/weekly-updates')

      const listRes = await fetchNativeApi('http://localhost/api/wiki', {
        headers: authHeaders(token, slug),
      })
      const list = await readNativeJson(
        listRes,
        Schema.Array(Schema.Struct({ slug: Schema.String, url: Schema.String })).pipe(Schema.mutable),
      )
      expect(list.find((p) => p.slug === 'weekly-updates')?.url).toBe('/wiki/weekly-updates')

      const treeRes = await fetchNativeApi('http://localhost/api/wiki/tree', {
        headers: authHeaders(token, slug),
      })
      const tree = await readNativeJson(
        treeRes,
        Schema.Array(Schema.Struct({ slug: Schema.String, url: Schema.String })).pipe(Schema.mutable),
      )
      expect(tree.find((p) => p.slug === 'weekly-updates')?.url).toBe('/wiki/weekly-updates')
    })

    test('omits projectId from the url for a project-scoped page (slugs are workspace-unique, PROJ-483)', async () => {
      const project = await seedProject(workspaceId)
      await seedGroupGrant(workspaceId, userId, project.id)
      const createRes = await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({ title: 'Project Notes', content: 'notes', projectId: project.id }),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
      const created = await readNativeJson(createRes, Schema.Struct({ url: Schema.String }))
      expect(created.url).toBe('/wiki/project-notes')
    })
  })

  test("covers PROJ-389: another workspace's owner cannot create a wiki page in this project", async () => {
    const project = await seedProject(workspaceId)
    const otherOwner = await seedFixture({ role: 'owner' })
    const res = await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(otherOwner.token, otherOwner.workspace.slug),
        JSON.stringify({ title: 'Cross ws page', content: 'x', projectId: project.id }),
      ),
    )
    expect(res.status).toBe(404)
  })

  test('handles GET /api/wiki/:slug retrieves a page by slug', async () => {
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '## System design', title: 'Architecture' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/architecture', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const page = await readNativeJson(res, Schema.Struct({ content: Schema.String, title: Schema.String }))
    expect(page.title).toBe('Architecture')
    expect(page.content).toBe('## System design')
  })

  test('handles GET /api/wiki/:slug returns 404 for unknown slug', async () => {
    const res = await fetchNativeApi('http://localhost/api/wiki/does-not-exist', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(404)
  })

  test('handles PUT /api/wiki/:slug updates content and saves a revision', async () => {
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1 content', title: 'Versioned' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const updateRes = await fetchNativeApi('http://localhost/api/wiki/versioned', {
      body: JSON.stringify({ content: 'v2 content', title: 'Versioned' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(updateRes.status).toBe(200)

    const pageRes = await fetchNativeApi('http://localhost/api/wiki/versioned', {
      headers: authHeaders(token, slug),
    })
    const page = await readNativeJson(pageRes, Schema.Struct({ content: Schema.String }))
    expect(page.content).toBe('v2 content')

    const revRes = await fetchNativeApi('http://localhost/api/wiki/versioned/revisions', {
      headers: authHeaders(token, slug),
    })
    const revisions = await readNativeJson(revRes, JsonListResponse)
    expect(revisions).toHaveLength(1)
  })

  test('handles GET /api/wiki/search finds pages by keyword', async () => {
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'Use wrangler to deploy', title: 'Deployment Guide' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'Welcome to the team', title: 'Onboarding' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/search?q=wrangler', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(res, TitleListResponse)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Deployment Guide')
  })

  /*
   * PROJ-489 (R7): a page with no verify_interval/status frontmatter signal at all gets
   * `freshness: null` — never fabricated. (R7 landed; full freshness behavior is
   * exercised in the "Wiki freshness model (PROJ-489)" describe block below.)
   */
  test('handles GET /api/wiki/search returns freshness: null for a page with no verification signal', async () => {
    expect.hasAssertions()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'wrangler', title: 'Freshness Placeholder Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const res = await fetchNativeApi('http://localhost/api/wiki/search?q=wrangler', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ freshness: Schema.Unknown })).pipe(Schema.mutable),
    )
    expect(results.length).toBeGreaterThan(0)
    Iterable.forEach(results, (result) => {
      expect(result.freshness).toBeNull()
    })
  })

  /*
   * PROJ-513: `type` is freeform (per the PRD) — an arbitrary value like "guide" is a
   * valid filter, just one that (correctly) matches nothing here. `status` stays a
   * closed enum, so an unrecognized value there is still rejected.
   */
  test('handles GET /api/wiki/search accepts an arbitrary type filter but rejects an unknown status (PROJ-513)', async () => {
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'wrangler', title: 'Noop Filter Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const okRes = await fetchNativeApi('http://localhost/api/wiki/search?q=wrangler&type=guide', {
      headers: authHeaders(token, slug),
    })
    expect(okRes.status).toBe(200)
    const badStatusRes = await fetchNativeApi('http://localhost/api/wiki/search?q=wrangler&status=fresh', {
      headers: authHeaders(token, slug),
    })
    expect(badStatusRes.status).toBe(400)
  })

  test('accepts a custom slug', async () => {
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'Root page', slug: 'home', title: 'Home' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const body = await readNativeJson(res, SlugResponse)
    expect(body.slug).toBe('home')
  })

  // --- canonical behavior parity tests ---

  test('handles GET /api/wiki?parentId= filters to children of that page (PROJ-244)', async () => {
    const parentRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'root', title: 'Parent Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const parent = await readNativeJson(parentRes, IdResponse)

    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Child Page', content: 'child', parentId: parent.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'sibling', title: 'Unrelated Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi(`http://localhost/api/wiki?parentId=${parent.id}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const pages = await readNativeJson(res, TitleListResponse)
    expect(pages).toHaveLength(1)
    expect(pages[0].title).toBe('Child Page')
  })

  test('handles GET /api/wiki returns ALL pages regardless of parent hierarchy', async () => {
    const parentRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'root', title: 'Parent Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const parent = await readNativeJson(parentRes, IdAndSlugResponse)

    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Child Page', content: 'child', parentId: parent.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki', {
      headers: authHeaders(token, slug),
    })
    const pages = await readNativeJson(res, JsonListResponse)
    expect(pages).toHaveLength(2)
  })

  test('handles GET /api/wiki/search with no query returns empty array', async () => {
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'content', title: 'Some Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const res = await fetchNativeApi('http://localhost/api/wiki/search', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toStrictEqual([])
  })

  /*
   * PROJ-486: replaces the old "first 250 chars" excerpt with an FTS5 snippet()
   * that is anchored to the actual match and highlighted with ** markers.
   */
  test('handles GET /api/wiki/search snippet is match-anchored and highlighted', async () => {
    const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod '.repeat(20)
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        title: 'Deep Match Page',
        content: `${filler} needle-term ${filler}`,
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const res = await fetchNativeApi('http://localhost/api/wiki/search?q=needle-term', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ excerpt: Schema.String })).pipe(Schema.mutable),
    )
    expect(results).toHaveLength(1)
    /*
     * The match is buried deep in a long page; a static first-250-chars excerpt
     * would never contain it, but a match-anchored snippet does.
     */
    expect(results[0].excerpt).toContain('needle')
    expect(results[0].excerpt).toContain('**')
  })

  /*
   * PROJ-486: BM25 ranking with a title-weight boost — a query matching only the
   * title of one page should rank it above a page where the term only appears deep
   * in a long body.
   */
  test('handles GET /api/wiki/search ranks a title match above a buried body match', async () => {
    const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod '.repeat(20)
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        title: 'Unrelated Page',
        content: `${filler} zylophone ${filler}`,
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'short body, no repeat term', title: 'Zylophone Guide' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/search?q=zylophone', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(res, TitleListResponse)
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('Zylophone Guide')
  })

  test('handles GET /api/wiki/search supports limit/offset pagination', async () => {
    for (let index = 0; index < 3; index++) {
      await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({ title: `Paginated Page ${index}`, content: 'shared-search-term' }),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
    }
    const page1 = await fetchNativeApi('http://localhost/api/wiki/search?q=shared-search-term&limit=2', {
      headers: authHeaders(token, slug),
    })
    const page1Results = await readNativeJson(page1, IdListResponse)
    expect(page1Results).toHaveLength(2)

    const page2 = await fetchNativeApi('http://localhost/api/wiki/search?q=shared-search-term&limit=2&offset=2', {
      headers: authHeaders(token, slug),
    })
    const page2Results = await readNativeJson(page2, IdListResponse)
    expect(page2Results).toHaveLength(1)
    expect(page2Results.map((r) => r.id)).not.toContain(page1Results[0].id)
    expect(page2Results.map((r) => r.id)).not.toContain(page1Results[1].id)
  })

  test('handles GET /api/wiki/search paginates deterministically when results tie in rank', async () => {
    /*
     * All three pages below match equally (same term, same content shape), so bm25()
     * alone ties -- pagination must fall back to a stable tiebreaker (page id) rather
     * than duplicating or dropping rows across pages. Distinct titles avoid PROJ-483
     * slug-collision 409s; the rate_limit reset avoids tripping the 5-req/window cap
     * (RATE_LIMIT_API_MAX) across the create + fetch calls below.
     */
    for (let index = 0; index < 3; index++) {
      const createRes = await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({
          title: `Tie Rank Page ${index}`,
          content: 'tie-rank-search-term',
        }),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
      expect(createRes.status).toBe(201)
    }
    await resetRateLimits()

    const fetchAll = (): Promise<{ id: string }[]> =>
      fetchNativeApi('http://localhost/api/wiki/search?q=tie-rank-search-term&limit=2', {
        headers: authHeaders(token, slug),
      }).then((response) => response.json() as Promise<{ id: string }[]>)

    const first = await fetchAll()
    await resetRateLimits()
    const second = await fetchAll()
    expect(first.map((r) => r.id)).toStrictEqual(second.map((r) => r.id))

    await resetRateLimits()
    const page2 = await fetchNativeApi('http://localhost/api/wiki/search?q=tie-rank-search-term&limit=2&offset=2', {
      headers: authHeaders(token, slug),
    })
    const page2Results = await readNativeJson(page2, IdListResponse)
    const allIds = [...first.map((r) => r.id), ...page2Results.map((r) => r.id)]
    expect(new Set(allIds).size).toBe(allIds.length)
    expect(allIds).toHaveLength(3)
  })

  test('handles GET /api/wiki/search updatedSince filters out pages updated before the cutoff', async () => {
    const createRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'freshness-cutoff-term', title: 'Stale Match Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const created = await readNativeJson(createRes, IdResponse)
    const pageRow = await env.DB.prepare('SELECT updated_at FROM wiki_pages WHERE id = ?')
      .bind(created.id)
      .first<{ updated_at: number }>()
    const cutoff = (pageRow?.updated_at ?? 0) + 1000

    const res = await fetchNativeApi(
      `http://localhost/api/wiki/search?q=freshness-cutoff-term&updatedSince=${cutoff}`,
      {
        headers: authHeaders(token, slug),
      },
    )
    await expect(res.json()).resolves.toStrictEqual([])

    const resAll = await fetchNativeApi('http://localhost/api/wiki/search?q=freshness-cutoff-term', {
      headers: authHeaders(token, slug),
    })
    const allResults = await readNativeJson(resAll, IdListResponse)
    expect(allResults).toHaveLength(1)
  })

  test("handles GET /api/wiki/search never returns another workspace's pages", async () => {
    const other = await seedFixture()
    await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(other.token, other.workspace.slug),
        JSON.stringify({ content: 'cross-tenant-term', title: 'Other Workspace Page' }),
      ),
    )
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'cross-tenant-term', title: 'This Workspace Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/search?q=cross-tenant-term', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(res, TitleListResponse)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('This Workspace Page')
  })

  // PROJ-486: the wiki_fts mirror table must track create/update/delete of wiki_pages.
  describe('wiki_fts index stays in sync', () => {
    test('a newly created page is searchable immediately', async () => {
      await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({ content: 'sync-create-term', title: 'Sync Create Page' }),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
      const res = await fetchNativeApi('http://localhost/api/wiki/search?q=sync-create-term', {
        headers: authHeaders(token, slug),
      })
      await expect(res.json()).resolves.toHaveLength(1)
    })

    test("an updated page's new content becomes searchable and old content stops matching", async () => {
      const createRes = await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({ content: 'before-update-term', title: 'Sync Update Page' }),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
      const created = await readNativeJson(createRes, SlugResponse)

      await fetchNativeApi(`http://localhost/api/wiki/${created.slug}`, {
        body: JSON.stringify({ content: 'after-update-term' }),
        headers: authHeaders(token, slug),
        method: 'PUT',
      })

      const oldRes = await fetchNativeApi('http://localhost/api/wiki/search?q=before-update-term', {
        headers: authHeaders(token, slug),
      })
      await expect(oldRes.json()).resolves.toStrictEqual([])

      const newRes = await fetchNativeApi('http://localhost/api/wiki/search?q=after-update-term', {
        headers: authHeaders(token, slug),
      })
      await expect(newRes.json()).resolves.toHaveLength(1)
    })

    test('a deleted page is no longer searchable', async () => {
      // Deleting a workspace-level page requires admin/owner (services/wiki.ts).
      const owner = await seedFixture({ role: 'owner' })
      const createRes = await fetchNativeApi(
        'http://localhost/api/wiki',
        requestOptionsWithBody(
          'POST',
          authHeaders(owner.token, owner.workspace.slug),
          JSON.stringify({ content: 'sync-delete-term', title: 'Sync Delete Page' }),
        ),
      )
      const created = await readNativeJson(createRes, SlugResponse)

      await fetchNativeApi(`http://localhost/api/wiki/${created.slug}`, {
        headers: authHeaders(owner.token, owner.workspace.slug),
        method: 'DELETE',
      })

      const res = await fetchNativeApi('http://localhost/api/wiki/search?q=sync-delete-term', {
        headers: authHeaders(owner.token, owner.workspace.slug),
      })
      await expect(res.json()).resolves.toStrictEqual([])
    })

    test("a cascade-deleted subtree's pages are no longer searchable", async () => {
      const owner = await seedFixture({ role: 'owner' })
      const parentRes = await fetchNativeApi(
        'http://localhost/api/wiki',
        requestOptionsWithBody(
          'POST',
          authHeaders(owner.token, owner.workspace.slug),
          JSON.stringify({ content: 'root', title: 'Sync Cascade Parent' }),
        ),
      )
      const parent = await readNativeJson(parentRes, IdAndSlugResponse)
      await fetchNativeApi(
        'http://localhost/api/wiki',
        requestOptionsWithBody(
          'POST',
          authHeaders(owner.token, owner.workspace.slug),
          JSON.stringify({
            title: 'Sync Cascade Child',
            content: 'sync-cascade-term',
            parentId: parent.id,
          }),
        ),
      )

      await fetchNativeApi(`http://localhost/api/wiki/${parent.slug}?cascade=true`, {
        headers: authHeaders(owner.token, owner.workspace.slug),
        method: 'DELETE',
      })

      const res = await fetchNativeApi('http://localhost/api/wiki/search?q=sync-cascade-term', {
        headers: authHeaders(owner.token, owner.workspace.slug),
      })
      await expect(res.json()).resolves.toStrictEqual([])
    })
  })

  test('handles PUT /api/wiki/:slug title-only update does not create a revision', async () => {
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'body text', title: 'Original Title' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    await fetchNativeApi('http://localhost/api/wiki/original-title', {
      body: JSON.stringify({ title: 'Renamed Title' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })

    const revRes = await fetchNativeApi('http://localhost/api/wiki/original-title/revisions', {
      headers: authHeaders(token, slug),
    })
    const revisions = await readNativeJson(revRes, JsonListResponse)
    expect(revisions).toHaveLength(0)
  })

  test('handles POST /api/wiki returns 400 for invalid input', async () => {
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: '' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('project-scoped pages are isolated from workspace-level list', async () => {
    const { env } = await import('./fixture-api.ts')
    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first<{ id: string }>()
    const project = await seedProject(ws!.id, 'WIKI')
    await seedGroupGrant(ws!.id, userId, project.id)

    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Project Page', content: 'scoped', projectId: project.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'global', title: 'Workspace Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const projectRes = await fetchNativeApi(`http://localhost/api/wiki?projectId=${project.id}`, {
      headers: authHeaders(token, slug),
    })
    const projectPages = await readNativeJson(projectRes, TitleListResponse)
    expect(projectPages).toHaveLength(1)
    expect(projectPages[0].title).toBe('Project Page')

    const allRes = await fetchNativeApi('http://localhost/api/wiki', {
      headers: authHeaders(token, slug),
    })
    const allPages = await readNativeJson(allRes, JsonListResponse)
    expect(allPages).toHaveLength(2)
  })

  const seedWikiPageRow = async function seedWikiPageRow(
    workspaceId: string,
    projectId: string | null,
    pageSlug: string,
    title: string,
  ): Promise<void> {
    await env.DB.prepare(
      "INSERT INTO wiki_pages (id, workspace_id, project_id, slug, title, content, created_by_id, updated_by_id, created_at, updated_at, tags, owners, is_template) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 0)",
    )
      .bind(pageSlug, workspaceId, projectId, pageSlug, title, 'body', userId, userId, 1000, 1000)
      .run()
  }

  test('includeWorkspacePages widens a project scope to workspace-level pages (PROJ-742)', async () => {
    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first<{ id: string }>()
    const project = await seedProject(ws!.id, 'WIDEN')
    const other = await seedProject(ws!.id, 'OTHER')
    await seedGroupGrant(ws!.id, userId, project.id)
    await seedGroupGrant(ws!.id, userId, other.id)
    await seedWikiPageRow(ws!.id, project.id, 'scoped-page', 'Scoped Page')
    await seedWikiPageRow(ws!.id, null, 'shared-page', 'Shared Page')
    await seedWikiPageRow(ws!.id, other.id, 'other-page', 'Other Project Page')

    const strictRes = await fetchNativeApi(`http://localhost/api/wiki?projectId=${project.id}`, {
      headers: authHeaders(token, slug),
    })
    expect(((await strictRes.json()) as { title: string }[]).map((p) => p.title)).toStrictEqual(['Scoped Page'])

    const widenedRes = await fetchNativeApi(
      `http://localhost/api/wiki?projectId=${project.id}&includeWorkspacePages=1`,
      {
        headers: authHeaders(token, slug),
      },
    )
    expect(((await widenedRes.json()) as { title: string }[]).map((p) => p.title).sort()).toStrictEqual([
      'Scoped Page',
      'Shared Page',
    ])

    const treeRes = await fetchNativeApi(
      `http://localhost/api/wiki/tree?projectId=${project.id}&includeWorkspacePages=1`,
      {
        headers: authHeaders(token, slug),
      },
    )
    expect(((await treeRes.json()) as { title: string }[]).map((p) => p.title).sort()).toStrictEqual([
      'Scoped Page',
      'Shared Page',
    ])
  })

  test("includeWorkspacePages still hides a project the caller isn't granted (PROJ-742)", async () => {
    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first<{ id: string }>()
    const ungranted = await seedProject(ws!.id, 'UNGRANTED')
    await seedWikiPageRow(ws!.id, null, 'ungranted-shared-page', 'Shared Page')
    await seedWikiPageRow(ws!.id, ungranted.id, 'secret-page', 'Secret Page')

    const res = await fetchNativeApi(`http://localhost/api/wiki?projectId=${ungranted.id}&includeWorkspacePages=1`, {
      headers: authHeaders(token, slug),
    })
    expect(((await res.json()) as { title: string }[]).map((p) => p.title)).toStrictEqual(['Shared Page'])
  })

  test('handles POST /api/wiki stores projectId and GET returns it', async () => {
    const { env } = await import('./fixture-api.ts')
    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first<{ id: string }>()
    const project = await seedProject(ws!.id, 'P2')
    await seedGroupGrant(ws!.id, userId, project.id)

    const createRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Scoped Doc', content: 'content', projectId: project.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(createRes.status).toBe(201)
    const created = await readNativeJson(
      createRes,
      Schema.Struct({ projectId: Schema.Union([Schema.String, Schema.Null]), slug: Schema.String }),
    )
    expect(created.projectId).toBe(project.id)

    const getRes = await fetchNativeApi(`http://localhost/api/wiki/${created.slug}`, {
      headers: authHeaders(token, slug),
    })
    const page = await readNativeJson(getRes, Schema.Struct({ project_id: Schema.Union([Schema.String, Schema.Null]) }))
    expect(page.project_id).toBe(project.id)
  })

  test('handles POST /api/wiki creates a nested page with parentId', async () => {
    const parentRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'parent content', title: 'Parent' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(parentRes.status).toBe(201)
    const parent = await readNativeJson(parentRes, IdAndSlugResponse)

    const childRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Child', content: 'child content', parentId: parent.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(childRes.status).toBe(201)
    const child = await readNativeJson(childRes, IdAndSlugResponse)

    const getRes = await fetchNativeApi(`http://localhost/api/wiki/${child.slug}`, {
      headers: authHeaders(token, slug),
    })
    const page = await readNativeJson(getRes, Schema.Struct({ parent_id: Schema.String }))
    expect(page.parent_id).toBe(parent.id)
  })

  test('handles POST /api/wiki rejects when max nesting depth (5) is exceeded', async () => {
    let parentId: string | null = null
    // Create 5 levels deep (root → L1 → L2 → L3 → L4 → L5)
    for (let index = 0; index < 5; index++) {
      const body: Record<string, unknown> = { title: `Level ${index}`, content: '' }
      if (Predicate.isNotNullish(parentId) && String.isNonEmpty(parentId)) {
        body.parentId = parentId
      }
      const res = await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify(body),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
      expect(res.status).toBe(201)
      const created = await readNativeJson(res, IdResponse)
      parentId = created.id
    }

    // Reset rate limit so the validation check (not the limiter) fires on the 6th request.
    await resetRateLimits()

    // Level 6 must be rejected (parent is at depth 5 → child would be depth 6)
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '', parentId, title: 'Too deep' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
    const bodyShape = Schema.Struct({
      error: Schema.Struct({ formErrors: Schema.Array(Schema.String).pipe(Schema.mutable) }),
    })
    const body = await readNativeJson(res, bodyShape)
    expect(body.error.formErrors[0]).toMatch(/Maximum wiki nesting depth/u)
  })

  test('handles PUT /api/wiki/:slug rejects a reparent whose moved SUBTREE would exceed max depth (PROJ-820)', async () => {
    // Build a 4-level chain: L0 -> L1 -> L2 -> L3 (L3 sits at depth 3).
    let chainParentId: string | null = null
    let l3Id = ''
    for (let index = 0; index < 4; index++) {
      const body: Record<string, unknown> = { title: `Chain ${index}`, content: '' }
      if (Predicate.isNotNullish(chainParentId) && String.isNonEmpty(chainParentId)) {
        body.parentId = chainParentId
      }
      const res = await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify(body),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
      expect(res.status).toBe(201)
      const created = await readNativeJson(res, IdResponse)
      chainParentId = created.id
      l3Id = created.id
    }

    await resetRateLimits()

    // Build a separate 3-level subtree: A -> A1 -> A2 (A has height 2).
    const aRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '', title: 'Subtree Root A' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(aRes.status).toBe(201)
    const responseBody = await readNativeJson(aRes, IdAndSlugResponse)

    await resetRateLimits()
    const a1Res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Subtree A1', content: '', parentId: responseBody.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(a1Res.status).toBe(201)
    const a1 = await readNativeJson(a1Res, IdResponse)

    await resetRateLimits()
    const a2Res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Subtree A2', content: '', parentId: a1.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(a2Res.status).toBe(201)

    await resetRateLimits()

    /*
     * Moving A (height 2) under L3 (depth 3) would put A2 at depth 3+1+2 = 6, which
     * exceeds the max nesting depth of 5 (indices 0..4) even though A's OWN new depth
     * (4) is within range — the check must look at the whole subtree, not just A.
     */
    const moveRes = await fetchNativeApi(`http://localhost/api/wiki/${responseBody.slug}`, {
      body: JSON.stringify({ parentId: l3Id }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(moveRes.status).toBe(400)
    const moveBodyShape = Schema.Struct({
      error: Schema.Struct({ formErrors: Schema.Array(Schema.String).pipe(Schema.mutable) }),
    })
    const moveBody = await readNativeJson(moveRes, moveBodyShape)
    expect(moveBody.error.formErrors[0]).toMatch(/Maximum wiki nesting depth/u)
  })

  test("handles PUT /api/wiki/:slug doesn't hang when a legacy parent_id cycle exists in the subtree being moved (PROJ-820)", async () => {
    /*
     * A cycle can't be created through the API (validateParentDepth's ancestor walk has
     * its own `seen`-set cycle guard), but a legacy row or a direct DB write could leave
     * one behind IN THE SUBTREE being moved. Seed X -> Y -> X directly via raw SQL (Y's
     * parent is X, then X's parent is reset to Y), then move X itself somewhere else:
     * getSubtreeHeight(db, X, ...) starts its recursive walk AT X and, joining into
     * children by parent_id, finds Y then loops back to X — without the depth bound this
     * never terminates.
     */
    const xRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '', title: 'Cycle X' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(xRes.status).toBe(201)
    const responseBody = await readNativeJson(xRes, IdAndSlugResponse)

    await resetRateLimits()
    const yRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Cycle Y', content: '', parentId: responseBody.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(yRes.status).toBe(201)
    const y = await readNativeJson(yRes, IdResponse)

    // Seed the cycle: X's parent is now Y (Y's parent is already X).
    await env.DB.prepare('UPDATE wiki_pages SET parent_id = ? WHERE id = ?').bind(y.id, responseBody.id).run()

    await resetRateLimits()
    const otherRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '', title: 'Cycle New Parent' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(otherRes.status).toBe(201)
    const other = await readNativeJson(otherRes, IdResponse)

    await resetRateLimits()
    /*
     * Moving X under `other` computes getSubtreeHeight(X), which walks into the X<->Y
     * cycle. This must resolve promptly (reject or succeed), never hang.
     */
    const moveRes = await fetchNativeApi(`http://localhost/api/wiki/${responseBody.slug}`, {
      body: JSON.stringify({ parentId: other.id }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect([200, 400]).toContain(moveRes.status)
  }, 10_000)

  test('handles GET /api/wiki/tree returns nested structure', async () => {
    const rootRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '', title: 'Root' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const root = await readNativeJson(rootRes, IdResponse)

    const childRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Child', content: '', parentId: root.id }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const child = await readNativeJson(childRes, IdResponse)

    const treeRes = await fetchNativeApi('http://localhost/api/wiki/tree', {
      headers: authHeaders(token, slug),
    })
    expect(treeRes.status).toBe(200)
    const treeShape = Schema.Array(
      Schema.Struct({
        children: Schema.Array(
          Schema.Struct({ children: Schema.Array(Schema.Unknown).pipe(Schema.mutable), id: Schema.String }),
        ).pipe(Schema.mutable),
        id: Schema.String,
      }),
    ).pipe(Schema.mutable)
    const tree = await readNativeJson(treeRes, treeShape)
    const rootNode = tree.find((n) => n.id === root.id)
    expect(rootNode).toBeDefined()
    expect(rootNode!.children).toHaveLength(1)
    expect(rootNode!.children[0].id).toBe(child.id)
    expect(rootNode!.children[0].children).toHaveLength(0)
  })

  test('handles PUT /api/wiki/:slug reparents a page via parentId', async () => {
    const aRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'a', title: 'Page A' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const responseBody = await readNativeJson(aRes, IdAndSlugResponse)

    const bRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'b', title: 'Page B' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const b = await readNativeJson(bRes, SlugResponse)

    // Reparent B under A
    const updateRes = await fetchNativeApi(`http://localhost/api/wiki/${b.slug}`, {
      body: JSON.stringify({ parentId: responseBody.id }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(updateRes.status).toBe(200)

    const getRes = await fetchNativeApi(`http://localhost/api/wiki/${b.slug}`, {
      headers: authHeaders(token, slug),
    })
    const page = await readNativeJson(getRes, Schema.Struct({ parent_id: Schema.String }))
    expect(page.parent_id).toBe(responseBody.id)
  })

  test("handles DELETE /api/wiki/:slug (default) promotes children to the deleted page's parent (PROJ-238)", async () => {
    const owner = await seedFixture({ role: 'owner' })
    const ownerHeaders = authHeaders(owner.token, owner.workspace.slug)

    const grandparentRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '', title: 'Grandparent' }),
      headers: ownerHeaders,
      method: 'POST',
    })
    const grandparent = await readNativeJson(grandparentRes, IdResponse)

    const parentRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Parent To Delete', content: '', parentId: grandparent.id }),
      headers: ownerHeaders,
      method: 'POST',
    })
    const parent = await readNativeJson(parentRes, IdAndSlugResponse)

    const childRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Child', content: '', parentId: parent.id }),
      headers: ownerHeaders,
      method: 'POST',
    })
    const child = await readNativeJson(childRes, IdAndSlugResponse)

    const delRes = await fetchNativeApi(`http://localhost/api/wiki/${parent.slug}`, {
      headers: ownerHeaders,
      method: 'DELETE',
    })
    expect(delRes.status).toBe(200)
    await expect(delRes.json()).resolves.toStrictEqual({ deletedCount: 1, linkedByCount: 0, ok: true })

    const childPageRes = await fetchNativeApi(`http://localhost/api/wiki/${child.slug}`, {
      headers: ownerHeaders,
    })
    const childPage = await readNativeJson(childPageRes, Schema.Struct({ parent_id: Schema.String }))
    expect(childPage.parent_id).toBe(grandparent.id)
  })

  test('handles DELETE /api/wiki/:slug?cascade=true removes the page and its whole subtree', async () => {
    const owner = await seedFixture({ role: 'owner' })
    const ownerHeaders = authHeaders(owner.token, owner.workspace.slug)

    const parentRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '', title: 'Cascade Parent' }),
      headers: ownerHeaders,
      method: 'POST',
    })
    const parent = await readNativeJson(parentRes, IdAndSlugResponse)

    const childRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Cascade Child', content: '', parentId: parent.id }),
      headers: ownerHeaders,
      method: 'POST',
    })
    const child = await readNativeJson(childRes, IdAndSlugResponse)

    const grandchildRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Cascade Grandchild', content: '', parentId: child.id }),
      headers: ownerHeaders,
      method: 'POST',
    })
    const grandchild = await readNativeJson(grandchildRes, SlugResponse)

    const delRes = await fetchNativeApi(`http://localhost/api/wiki/${parent.slug}?cascade=true`, {
      headers: ownerHeaders,
      method: 'DELETE',
    })
    expect(delRes.status).toBe(200)
    await expect(delRes.json()).resolves.toStrictEqual({ deletedCount: 3, linkedByCount: 0, ok: true })

    await resetRateLimits()
    for (const s of [parent.slug, child.slug, grandchild.slug]) {
      const res = await fetchNativeApi(`http://localhost/api/wiki/${s}`, {
        headers: ownerHeaders,
      })
      expect(res.status).toBe(404)
    }
  })

  const uploadFileToPage = async function uploadFileToPage(
    token: string,
    slug: string,
    pageId: string,
  ): Promise<{ attachmentId: string; r2Key: string }> {
    const form = new FormData()
    form.append('file', new File(['attachment content'], 'doc.txt', { type: 'text/plain' }))
    form.append('entityType', 'wiki_page')
    form.append('entityId', pageId)
    const res = await fetchNativeApi('http://localhost/api/files', {
      body: form,
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Slug': slug },
      method: 'POST',
    })
    const { id } = await readNativeJson(res, IdResponse)
    const row = await env.DB.prepare('SELECT r2_key FROM attachments WHERE id = ?').bind(id).first<{ r2_key: string }>()
    return { attachmentId: id, r2Key: row!.r2_key }
  }

  test('handles DELETE :slug trashes the page, leaving its R2 attachment until purge (PROJ-426/496)', async () => {
    const owner = await seedFixture({ role: 'owner' })
    const ownerHeaders = authHeaders(owner.token, owner.workspace.slug)

    const pageRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '', title: 'Page With File' }),
      headers: ownerHeaders,
      method: 'POST',
    })
    const page = await readNativeJson(pageRes, IdAndSlugResponse)

    const { attachmentId, r2Key } = await uploadFileToPage(owner.token, owner.workspace.slug, page.id)
    await expect(env.R2.get(r2Key)).resolves.not.toBeNull()

    const delRes = await fetchNativeApi(`http://localhost/api/wiki/${page.slug}`, {
      headers: ownerHeaders,
      method: 'DELETE',
    })
    expect(delRes.status).toBe(200)

    /*
     * PROJ-496: R2 cleanup moved to purge time — a soft-deleted page's attachment
     * object/row must still exist (e.g. so undelete leaves the page fully intact).
     */
    await expect(env.R2.get(r2Key)).resolves.not.toBeNull()
    const row = await env.DB.prepare('SELECT id FROM attachments WHERE id = ?').bind(attachmentId).first()
    expect(row).not.toBeNull()
  })

  test('handles DELETE ?cascade=true trashes the subtree, leaving R2 attachments until purge (PROJ-426/496)', async () => {
    const owner = await seedFixture({ role: 'owner' })
    const ownerHeaders = authHeaders(owner.token, owner.workspace.slug)

    const parentRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '', title: 'Cascade Parent With File' }),
      headers: ownerHeaders,
      method: 'POST',
    })
    const parent = await readNativeJson(parentRes, IdAndSlugResponse)

    const childRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Cascade Child With File', content: '', parentId: parent.id }),
      headers: ownerHeaders,
      method: 'POST',
    })
    const child = await readNativeJson(childRes, IdAndSlugResponse)

    const parentFile = await uploadFileToPage(owner.token, owner.workspace.slug, parent.id)
    const childFile = await uploadFileToPage(owner.token, owner.workspace.slug, child.id)
    await expect(env.R2.get(parentFile.r2Key)).resolves.not.toBeNull()
    await expect(env.R2.get(childFile.r2Key)).resolves.not.toBeNull()

    const delRes = await fetchNativeApi(`http://localhost/api/wiki/${parent.slug}?cascade=true`, {
      headers: ownerHeaders,
      method: 'DELETE',
    })
    expect(delRes.status).toBe(200)

    await expect(env.R2.get(parentFile.r2Key)).resolves.not.toBeNull()
    await expect(env.R2.get(childFile.r2Key)).resolves.not.toBeNull()
  })

  test('handles DELETE /api/wiki/:slug returns 403 for viewer role', async () => {
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'secret', title: 'Protected Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const { env } = await import('./fixture-api.ts')
    const { seedUser, seedMember, seedToken } = await import('./helpers.ts')
    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first<{ id: string }>()
    const viewerUser = await seedUser(`viewer-wiki-${crypto.randomUUID().slice(0, 8)}@example.com`)
    await seedMember(ws!.id, viewerUser.id, 'viewer')
    const viewerToken = await seedToken(ws!.id, viewerUser.id)

    const delRes = await fetchNativeApi('http://localhost/api/wiki/protected-page', {
      headers: authHeaders(viewerToken, slug),
      method: 'DELETE',
    })
    expect(delRes.status).toBe(403)
  })
})

describe('wiki role guards', () => {
  test('viewer cannot create a wiki page (403)', async () => {
    const roles = await seedWorkspaceRoles()

    const res = await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.viewer.token, roles.workspace.slug),
        JSON.stringify({ content: 'test', title: 'Viewer Page' }),
      ),
    )
    expect(res.status).toBe(403)
  })

  test('viewer cannot update a wiki page (403)', async () => {
    const roles = await seedWorkspaceRoles()

    const createRes = await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.member.token, roles.workspace.slug),
        JSON.stringify({ content: 'original', title: 'Member Page' }),
      ),
    )
    const { slug: pageSlug } = await readNativeJson(createRes, SlugResponse)

    const updateRes = await fetchNativeApi(
      `http://localhost/api/wiki/${pageSlug}`,
      requestOptionsWithBody(
        'PUT',
        authHeaders(roles.viewer.token, roles.workspace.slug),
        JSON.stringify({ content: 'hacked' }),
      ),
    )
    expect(updateRes.status).toBe(403)
  })

  test('member cannot delete a wiki page (403)', async () => {
    const roles = await seedWorkspaceRoles()

    const createRes = await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.member.token, roles.workspace.slug),
        JSON.stringify({ content: 'content', title: 'Member Deletable' }),
      ),
    )
    const { slug: pageSlug } = await readNativeJson(createRes, SlugResponse)

    const deleteRes = await fetchNativeApi(`http://localhost/api/wiki/${pageSlug}`, {
      headers: authHeaders(roles.member.token, roles.workspace.slug),
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(403)
  })

  test('admin can delete a wiki page', async () => {
    const roles = await seedWorkspaceRoles()

    const createRes = await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.member.token, roles.workspace.slug),
        JSON.stringify({ content: 'content', title: 'Admin Target' }),
      ),
    )
    const { slug: pageSlug } = await readNativeJson(createRes, SlugResponse)

    const deleteRes = await fetchNativeApi(`http://localhost/api/wiki/${pageSlug}`, {
      headers: authHeaders(roles.owner.token, roles.workspace.slug),
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)
  })
})

// PROJ-483: slug uniqueness + rename redirects
describe('wiki slug uniqueness and redirects (PROJ-483)', () => {
  type TestData = Readonly<{
    slug: string
    token: string
    userId: string
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedFixture()
    const token = fixture.token
    const slug = fixture.workspace.slug
    const workspaceId = fixture.workspace.id
    const userId = fixture.user.id
    return { slug, token, userId, workspaceId }
  }

  test("handles POST /api/wiki rejects a title that slugifies to an existing page's slug (409)", async () => {
    const { slug, token } = await seedTestData()
    const first = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', title: 'Operations' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(first.status).toBe(201)

    const second = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v2', title: 'Operations' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(second.status).toBe(409)
  })

  test('handles POST /api/wiki rejects an explicit slug that collides with an existing page (409)', async () => {
    const { slug, token } = await seedTestData()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', title: 'Operations' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v2', slug: 'operations', title: 'Ops Handbook' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(409)
  })

  test("handles POST /api/wiki rejects the reserved slug 'view' (PROJ-487, 400)", async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', slug: 'view', title: 'View' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test("handles POST /api/wiki auto-slugs the title 'View' to 'view-page' (PROJ-811)", async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', title: 'View' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { slug: string }).slug).toBe('view-page')
  })

  test("handles PUT /api/wiki/:slug rejects renaming to the reserved slug 'view' (PROJ-487, 400)", async () => {
    const { slug, token } = await seedTestData()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'g', title: 'Gamma' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/gamma', {
      body: JSON.stringify({ slug: 'view' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(res.status).toBe(400)
  })

  test("handles POST /api/wiki rejects a slug containing '/' (PROJ-517, 400)", async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', slug: 'a/b', title: 'Nested' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test("handles PUT /api/wiki/:slug rejects renaming to a slug containing '/' (PROJ-517, 400)", async () => {
    const { slug, token } = await seedTestData()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'd', title: 'Delta' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/delta', {
      body: JSON.stringify({ slug: 'a/b' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(res.status).toBe(400)
  })

  test('handles POST /api/wiki uses an opaque slug for a non-Latin title (empty derived slug, PROJ-517 #5)', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', title: '測試' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const page = await readNativeJson(res, IdAndSlugResponse)
    expect(page.slug).toMatch(/^page-[0-9a-f]{8}$/u)

    const getRes = await fetchNativeApi(`http://localhost/api/wiki/${page.slug}`, {
      headers: authHeaders(token, slug),
    })
    const fetched = await readNativeJson(getRes, Schema.Struct({ title: Schema.String }))
    expect(fetched.title).toBe('測試')
  })

  test("handles POST /api/wiki uses an opaque slug when derived slug exceeds SlugSchema's 200-char max (PROJ-517)", async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'a'.repeat(300), content: 'v1' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const page = await readNativeJson(res, SlugResponse)
    expect(page.slug).toMatch(/^page-[0-9a-f]{8}$/u)
  })

  test("covers MCP create_wiki_page rejects a slug containing '/' (PROJ-517, REST/MCP parity)", async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const res = await mcpCall(
      workspaceId,
      'create_wiki_page',
      { content: 'v1', slug: 'a/b', title: 'Nested' },
      authHeaders(token, slug),
    )
    expect(isMcpError(res)).toBe(false)
    expect(toolError(res)?.code).toBe('validation')
  })

  test("covers MCP update_wiki_page rejects renaming to a slug containing '/' (PROJ-517, REST/MCP parity)", async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const created = mcpData(
      await mcpCall(workspaceId, 'create_wiki_page', { content: 'd', title: 'Delta MCP' }, authHeaders(token, slug)),
      SlugResponse,
    )

    const res = await mcpCall(
      workspaceId,
      'update_wiki_page',
      { slug: created.slug, newSlug: 'a/b' },
      authHeaders(token, slug),
    )
    expect(isMcpError(res)).toBe(false)
    expect(toolError(res)?.code).toBe('validation')
  })

  test('a slashy slug rewritten by the PROJ-517 backfill still resolves, and the old slug redirects (#1)', async () => {
    const { slug, token, userId, workspaceId } = await seedTestData()
    /*
     * Simulate a pre-PROJ-517 row that predates SlugSchema's no-slash rule by
     * inserting directly (SlugSchema would now reject this via the service layer).
     */
    const pageId = crypto.randomUUID()
    const now = currentEpochSeconds()
    await env.DB.prepare(
      `INSERT INTO wiki_pages (id, workspace_id, project_id, slug, title, content,
				parent_id, created_by_id, updated_by_id, created_at, updated_at)
			 VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
      .bind(pageId, workspaceId, 'operations/admin-allow-list', 'Admin Allow List', 'content', userId, userId, now, now)
      .run()

    /*
     * Apply the same rewrite migration 0050 performs, since the fixture DB's
     * migrations already ran in beforeAll before this row existed.
     */
    const redirectId = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO wiki_redirects (id, workspace_id, old_slug, page_id, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(redirectId, workspaceId, 'operations/admin-allow-list', pageId, now)
      .run()
    await env.DB.prepare(`UPDATE wiki_pages SET slug = ? WHERE id = ?`)
      .bind('operations-admin-allow-list', pageId)
      .run()

    const newRes = await fetchNativeApi('http://localhost/api/wiki/operations-admin-allow-list', {
      headers: authHeaders(token, slug),
    })
    expect(newRes.status).toBe(200)

    /*
     * Resolve via MCP's get_wiki_page, passing the old slug as a plain argument
     * (not a URL path segment) — sidesteps any router-level handling of an
     * encoded "/" and tests the redirect-fallback resolution itself.
     */
    const oldPage = mcpData(
      await mcpCall(workspaceId, 'get_wiki_page', { slug: 'operations/admin-allow-list' }, authHeaders(token, slug)),
      SlugResponse,
    )
    expect(oldPage.slug).toBe('operations-admin-allow-list')
  })

  test("handles POST /api/wiki rejects the reserved slug 'index' (PROJ-487, 400)", async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', slug: 'index', title: 'Index' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test("handles POST /api/wiki auto-slugs the title 'Index' to 'index-page' (PROJ-811)", async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', title: 'Index' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { slug: string }).slug).toBe('index-page')
  })

  test("handles PUT /api/wiki/:slug rejects renaming to the reserved slug 'index' (PROJ-487, 400)", async () => {
    const { slug, token } = await seedTestData()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'd', title: 'Delta' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/delta', {
      body: JSON.stringify({ slug: 'index' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(res.status).toBe(400)
  })

  test('handles PUT /api/wiki/:slug renaming the slug creates a redirect; the old slug still resolves', async () => {
    const { slug, token } = await seedTestData()
    const createRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', title: 'Roadmap' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const created = await readNativeJson(createRes, SlugResponse)
    expect(created.slug).toBe('roadmap')

    const updateRes = await fetchNativeApi('http://localhost/api/wiki/roadmap', {
      body: JSON.stringify({ slug: 'product-roadmap' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(updateRes.status).toBe(200)
    const updated = await readNativeJson(updateRes, Schema.Struct({ url: Schema.String }))
    expect(updated.url).toBe('/wiki/product-roadmap')

    const newRes = await fetchNativeApi('http://localhost/api/wiki/product-roadmap', {
      headers: authHeaders(token, slug),
    })
    expect(newRes.status).toBe(200)

    const oldRes = await fetchNativeApi('http://localhost/api/wiki/roadmap', {
      headers: authHeaders(token, slug),
    })
    expect(oldRes.status).toBe(200)
    const oldPage = await readNativeJson(oldRes, Schema.Struct({ slug: Schema.String, title: Schema.String }))
    expect(oldPage).toMatchObject({ slug: 'product-roadmap', title: 'Roadmap' })
  })

  test('handles PUT /api/wiki/:slug rejects renaming to a slug already used by another page (409)', async () => {
    const { slug, token } = await seedTestData()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'a', title: 'Alpha' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'b', title: 'Beta' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/beta', {
      body: JSON.stringify({ slug: 'alpha' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(res.status).toBe(409)
  })

  test('redirect chains collapse: renaming a page twice still resolves the original slug in one hop', async () => {
    const { slug, token } = await seedTestData()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', title: 'Docs' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    await fetchNativeApi('http://localhost/api/wiki/docs', {
      body: JSON.stringify({ slug: 'docs-v2' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    await fetchNativeApi('http://localhost/api/wiki/docs-v2', {
      body: JSON.stringify({ slug: 'docs-v3' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })

    const originalRes = await fetchNativeApi('http://localhost/api/wiki/docs', {
      headers: authHeaders(token, slug),
    })
    expect(originalRes.status).toBe(200)
    expect(((await originalRes.json()) as { slug: string }).slug).toBe('docs-v3')

    const intermediateRes = await fetchNativeApi('http://localhost/api/wiki/docs-v2', {
      headers: authHeaders(token, slug),
    })
    expect(intermediateRes.status).toBe(200)
    expect(((await intermediateRes.json()) as { slug: string }).slug).toBe('docs-v3')
  })

  test('getWikiPage prefers a live page over a stale redirect for a reused slug (never ambiguous)', async () => {
    const { slug, token } = await seedTestData()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'original', title: 'Old Name' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki/old-name', {
      body: JSON.stringify({ slug: 'new-name' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })

    // "old-name" is now only a redirect. A new page can legitimately claim it.
    const reclaimRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'reclaimed', slug: 'old-name', title: 'Reclaimed' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(reclaimRes.status).toBe(201)

    const res = await fetchNativeApi('http://localhost/api/wiki/old-name', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const page = await readNativeJson(res, Schema.Struct({ title: Schema.String }))
    expect(page.title).toBe('Reclaimed')
  })

  test('the same slug in two different workspaces does not conflict', async () => {
    const { slug, token } = await seedTestData()
    const other = await seedFixture()

    const first = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'workspace one', title: 'Shared Name' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(first.status).toBe(201)

    const second = await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(other.token, other.workspace.slug),
        JSON.stringify({ content: 'workspace two', title: 'Shared Name' }),
      ),
    )
    expect(second.status).toBe(201)
    const secondPage = await readNativeJson(second, SlugResponse)
    expect(secondPage.slug).toBe('shared-name')
  })

  test('a redirect created in one workspace does not resolve in another workspace', async () => {
    const { slug, token } = await seedTestData()
    const other = await seedFixture()

    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', title: 'Isolated' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki/isolated', {
      body: JSON.stringify({ slug: 'isolated-renamed' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })

    // "isolated" is now a redirect in the first workspace only.
    const crossWorkspaceRes = await fetchNativeApi('http://localhost/api/wiki/isolated', {
      headers: authHeaders(other.token, other.workspace.slug),
    })
    expect(crossWorkspaceRes.status).toBe(404)

    // A page in the other workspace is free to use "isolated" as its own live slug.
    const createRes = await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(other.token, other.workspace.slug),
        JSON.stringify({ content: 'other workspace', slug: 'isolated', title: 'Isolated' }),
      ),
    )
    expect(createRes.status).toBe(201)
  })

  test('covers MCP update_wiki_page newSlug renames the slug and old slug resolves via redirect (parity with REST)', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const created = mcpData(
      await mcpCall(workspaceId, 'create_wiki_page', { content: 'v1', title: 'Handbook' }, authHeaders(token, slug)),
      SlugResponse,
    )
    expect(created.slug).toBe('handbook')

    const updatedResult = mcpData(
      await mcpCall(
        workspaceId,
        'update_wiki_page',
        { newSlug: 'team-handbook', slug: 'handbook' },
        authHeaders(token, slug),
      ),
      Schema.Struct({ url: Schema.String }),
    )
    expect(updatedResult.url).toBe('/wiki/team-handbook')

    const oldPage = mcpData(
      await mcpCall(workspaceId, 'get_wiki_page', { slug: 'handbook' }, authHeaders(token, slug)),
      SlugResponse,
    )
    expect(oldPage.slug).toBe('team-handbook')
  })

  test('covers MCP create_wiki_page rejects a colliding slug with a ConflictError (conflict tool error)', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    await mcpCall(workspaceId, 'create_wiki_page', { title: 'Conflict Page' }, authHeaders(token, slug))
    const res = await mcpCall(workspaceId, 'create_wiki_page', { title: 'Conflict Page' }, authHeaders(token, slug))
    expect(isMcpError(res)).toBe(false)
    expect(toolError(res)?.code).toBe('conflict')
  })
})

/*
 * PROJ-488 (R6): YAML frontmatter parsed and denormalized into wiki_pages columns on
 * write, plus type/tags/status filtering on listWikiPages/searchWiki. REST/MCP parity
 * throughout — each behavior is exercised via both surfaces.
 */
describe('wiki frontmatter metadata (PROJ-488)', () => {
  const RUNBOOK_CONTENT = [
    '---',
    'type: runbook',
    'tags: [ops, oncall]',
    'status: current',
    'verified_at: 2026-01-01',
    'verified_by: alice@example.com',
    'owners: [alice, bob]',
    'verify_interval: 90',
    '---',
    '# Runbook body',
  ].join('\n')

  test('covers REST POST /api/wiki parses valid frontmatter into denormalized fields', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: RUNBOOK_CONTENT, title: 'Incident Runbook' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const created = await readNativeJson(
      res,
      Schema.Struct({
        owners: Schema.Array(Schema.String).pipe(Schema.mutable),
        status: Schema.String,
        tags: Schema.Array(Schema.String).pipe(Schema.mutable),
        type: Schema.String,
        verifiedBy: Schema.String,
        verifyInterval: Schema.Number,
      }),
    )
    expect(created.type).toBe('runbook')
    expect(created.tags).toStrictEqual(['ops', 'oncall'])
    expect(created).toMatchObject({ status: 'current', verifiedBy: 'alice@example.com' })
    expect(created.owners).toStrictEqual(['alice', 'bob'])
    expect(created.verifyInterval).toBe(90)

    const getRes = await fetchNativeApi('http://localhost/api/wiki/incident-runbook', {
      headers: authHeaders(token, slug),
    })
    const pageShape = Schema.Struct({
      status: Schema.String,
      tags: Schema.Union([Schema.Array(Schema.String).pipe(Schema.mutable), Schema.String]),
      type: Schema.String,
    })
    const page = await readNativeJson(getRes, pageShape)
    expect(page).toMatchObject({ status: 'current', type: 'runbook' })
    // Tags column comes back through drizzle's JSON mode as a real array on GET.
    expect(page.tags).toStrictEqual(['ops', 'oncall'])
  })

  test('covers MCP create_wiki_page parses valid frontmatter into denormalized fields (parity with REST)', async () => {
    const { slug, token, workspaceId } = await seedWorkspaceFixture()
    const result = mcpData(
      await mcpCall(
        workspaceId,
        'create_wiki_page',
        { content: RUNBOOK_CONTENT, title: 'Oncall Runbook' },
        authHeaders(token, slug),
      ),
      WikiFrontmatterResponse,
    )
    expect(result.type).toBe('runbook')
    expect(result.tags).toStrictEqual(['ops', 'oncall'])
    expect(result.status).toBe('current')
  })

  test('a page with no frontmatter gets empty/null metadata', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'just markdown, no frontmatter', title: 'Plain Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const created = await readNativeJson(
      res,
      Schema.Struct({
        status: Schema.Union([Schema.String, Schema.Null]),
        tags: Schema.Array(Schema.String).pipe(Schema.mutable),
        type: Schema.Union([Schema.String, Schema.Null]),
      }),
    )
    expect(created.type).toBeNull()
    expect(created.tags).toStrictEqual([])
    expect(created.status).toBeNull()
  })

  /*
   * PROJ-513: `type` is freeform per the PRD — a value outside the well-known
   * runbook/adr/spec/note set is accepted and stored as-is, not rejected.
   */
  test('covers REST POST /api/wiki accepts a `type` value outside the well-known set (PROJ-513)', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\ntype: whitepaper\n---\nbody',
        title: 'Freeform Type',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const created = await readNativeJson(res, Schema.Struct({ type: Schema.Union([Schema.String, Schema.Null]) }))
    expect(created.type).toBe('whitepaper')
  })

  test('covers MCP create_wiki_page accepts a `type` value outside the well-known set, parity with REST (PROJ-513)', async () => {
    const { slug, token, workspaceId } = await seedWorkspaceFixture()
    const created = mcpData(
      await mcpCall(
        workspaceId,
        'create_wiki_page',
        { content: '---\ntype: whitepaper\n---\nbody', title: 'Freeform Type Mcp' },
        authHeaders(token, slug),
      ),
      Schema.Struct({ type: Schema.Union([Schema.String, Schema.Null]) }),
    )
    expect(created.type).toBe('whitepaper')
  })

  /*
   * PROJ-513: the freeform value has to survive the whole round trip — stored on create,
   * then usable as a filter on both list and search, exactly like a well-known one.
   */
  test('filters list/search by a `type` value outside the well-known set (PROJ-513)', async () => {
    const { slug, token, workspaceId } = await seedWorkspaceFixture()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\ntype: whitepaper\n---\nlatency budget',
        title: 'Freeform Filter Whitepaper',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\ntype: adr\n---\nlatency budget',
        title: 'Freeform Filter Adr',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const listRes = await fetchNativeApi('http://localhost/api/wiki?type=whitepaper', {
      headers: authHeaders(token, slug),
    })
    const listed = await readNativeJson(listRes, TitleListResponse)
    expect(listed.map((r) => r.title)).toStrictEqual(['Freeform Filter Whitepaper'])

    const searchRes = await fetchNativeApi('http://localhost/api/wiki/search?q=latency&type=whitepaper', {
      headers: authHeaders(token, slug),
    })
    const found = await readNativeJson(searchRes, TitleListResponse)
    expect(found.map((r) => r.title)).toStrictEqual(['Freeform Filter Whitepaper'])

    const mcpListed = mcpData(
      await mcpCall(workspaceId, 'list_wiki_pages', { type: 'whitepaper' }, authHeaders(token, slug)),
      TitleListResponse,
    )
    expect(mcpListed.map((r) => r.title)).toStrictEqual(['Freeform Filter Whitepaper'])
  })

  test('rejects an invalid `status` enum value with a structured error', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\nstatus: archived\n---\nbody',
        title: 'Bad Status',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('rejects malformed YAML in the frontmatter block with a structured error, not a silent drop', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\ntags: [unterminated\n---\nbody',
        title: 'Bad Yaml',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('rejects an unrecognized frontmatter key rather than silently ignoring it', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\nstauts: current\n---\nbody',
        title: 'Typo Key',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('rejects tags with the wrong type (a string instead of an array)', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\ntags: ops\n---\nbody',
        title: 'Bad Tags',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test("rejects a frontmatter block that isn't a YAML mapping", async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\n- one\n- two\n---\nbody',
        title: 'List Frontmatter',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test("rejects a verified_at that isn't a parseable date", async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\nverified_at: last tuesday\n---\nbody',
        title: 'Bad Verified At',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('rejects a verified_at that is neither a date nor a number', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\nverified_at: true\n---\nbody',
        title: 'Boolean Verified At',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('accepts a verified_at given as unix seconds', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\nverified_at: 1700000000\n---\nbody',
        title: 'Unix Verified At',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const created = await readNativeJson(res, Schema.Struct({ verifiedAt: Schema.Number }))
    expect(created.verifiedAt).toBe(1_700_000_000)
  })

  test('update_wiki_page reparses frontmatter when content changes', async () => {
    const { slug, token, workspaceId } = await seedWorkspaceFixture()
    const created = mcpData(
      await mcpCall(
        workspaceId,
        'create_wiki_page',
        { content: RUNBOOK_CONTENT, title: 'Evolving Doc' },
        authHeaders(token, slug),
      ),
      SlugResponse,
    )

    await mcpCall(
      workspaceId,
      'update_wiki_page',
      { slug: created.slug, content: '---\ntype: adr\nstatus: deprecated\n---\nnew body' },
      authHeaders(token, slug),
    )

    const page = mcpData(
      await mcpCall(workspaceId, 'get_wiki_page', { slug: created.slug }, authHeaders(token, slug)),
      WikiFrontmatterResponse,
    )
    expect(page.type).toBe('adr')
    expect(page.status).toBe('deprecated')
    expect(page.tags).toStrictEqual([])
  })

  test('update_wiki_page leaves existing frontmatter metadata unchanged when content is omitted', async () => {
    const { slug, token, workspaceId } = await seedWorkspaceFixture()
    const created = mcpData(
      await mcpCall(
        workspaceId,
        'create_wiki_page',
        { content: RUNBOOK_CONTENT, title: 'Stable Doc' },
        authHeaders(token, slug),
      ),
      SlugResponse,
    )

    await mcpCall(
      workspaceId,
      'update_wiki_page',
      { slug: created.slug, title: 'Stable Doc (renamed title)' },
      authHeaders(token, slug),
    )

    const page = mcpData(
      await mcpCall(workspaceId, 'get_wiki_page', { slug: created.slug }, authHeaders(token, slug)),
      WikiFrontmatterResponse,
    )
    expect(page.type).toBe('runbook')
    expect(page.status).toBe('current')
    expect(page.tags).toStrictEqual(['ops', 'oncall'])
  })

  test('update_wiki_page rejects invalid frontmatter on a content edit', async () => {
    const { slug, token, workspaceId } = await seedWorkspaceFixture()
    const created = mcpData(
      await mcpCall(
        workspaceId,
        'create_wiki_page',
        { content: RUNBOOK_CONTENT, title: 'Will Fail Update' },
        authHeaders(token, slug),
      ),
      SlugResponse,
    )
    const res = await mcpCall(
      workspaceId,
      'update_wiki_page',
      /*
       * PROJ-513: `type` is freeform now, so use an invalid `status` (still a closed
       * enum) to exercise the same "invalid frontmatter on update" path.
       */
      { slug: created.slug, content: '---\nstatus: not-a-real-status\n---\nbody' },
      authHeaders(token, slug),
    )
    expect(isMcpError(res)).toBe(false)
    expect(toolError(res)?.code).toBe('validation')
  })

  test('covers REST GET /api/wiki filters by type and status', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: RUNBOOK_CONTENT, title: 'Filter Runbook' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\ntype: adr\nstatus: draft\n---\nbody',
        title: 'Filter Adr',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const byType = await fetchNativeApi('http://localhost/api/wiki?type=adr', {
      headers: authHeaders(token, slug),
    })
    const byTypeResults = await readNativeJson(byType, TitleListResponse)
    expect(byTypeResults.map((r) => r.title)).toStrictEqual(['Filter Adr'])

    const byStatus = await fetchNativeApi('http://localhost/api/wiki?status=current', {
      headers: authHeaders(token, slug),
    })
    const byStatusResults = await readNativeJson(byStatus, TitleListResponse)
    expect(byStatusResults.map((r) => r.title)).toStrictEqual(['Filter Runbook'])
  })

  test('covers REST GET /api/wiki?tags= filters by any-of tag match', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '---\ntags: [ops]\n---\nbody', title: 'Tagged Ops' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\ntags: [frontend]\n---\nbody',
        title: 'Tagged Frontend',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'no frontmatter here', title: 'Untagged' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki?tags=ops,frontend', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(res, TitleListResponse)
    expect(results.map((result) => result.title).sort()).toStrictEqual(['Tagged Frontend', 'Tagged Ops'])
  })

  test('covers MCP list_wiki_pages filters by tags (any-of), parity with REST', async () => {
    const { slug, token, workspaceId } = await seedWorkspaceFixture()
    await mcpCall(
      workspaceId,
      'create_wiki_page',
      { content: '---\ntags: [ops]\n---\nbody', title: 'Mcp Tagged Ops' },
      authHeaders(token, slug),
    )
    await mcpCall(
      workspaceId,
      'create_wiki_page',
      { content: 'no frontmatter', title: 'Mcp Untagged' },
      authHeaders(token, slug),
    )

    const result = mcpData(
      await mcpCall(workspaceId, 'list_wiki_pages', { tags: ['ops'] }, authHeaders(token, slug)),
      TitleListResponse,
    )
    expect(result.map((r) => r.title)).toStrictEqual(['Mcp Tagged Ops'])
  })

  test('covers REST GET /api/wiki/search filters by type/status/tags on top of the FTS match', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\ntype: runbook\nstatus: current\ntags: [deploy]\n---\ndeploy steps',
        title: 'Deploy Runbook',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: '---\ntype: adr\nstatus: draft\ntags: [deploy]\n---\ndeploy decision',
        title: 'Deploy Adr',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi(
      'http://localhost/api/wiki/search?q=deploy&type=runbook&status=current&tags=deploy',
      {
        headers: authHeaders(token, slug),
      },
    )
    expect(res.status).toBe(200)
    const results = await readNativeJson(res, TitleListResponse)
    expect(results.map((result) => result.title)).toStrictEqual(['Deploy Runbook'])
  })

  test('search results return tags/owners as arrays, same shape as list and get', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: RUNBOOK_CONTENT, title: 'Shape Runbook' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/search?q=Runbook', {
      headers: authHeaders(token, slug),
    })
    const resShape = Schema.Array(
      Schema.Struct({
        owners: Schema.Array(Schema.String).pipe(Schema.mutable),
        tags: Schema.Array(Schema.String).pipe(Schema.mutable),
      }),
    ).pipe(Schema.mutable)
    const [hit] = await readNativeJson(res, resShape)
    expect(hit.tags).toStrictEqual(['ops', 'oncall'])
    expect(hit.owners).toStrictEqual(['alice', 'bob'])

    const listRes = await fetchNativeApi('http://localhost/api/wiki?type=runbook', {
      headers: authHeaders(token, slug),
    })
    const listResShape = Schema.Array(
      Schema.Struct({
        owners: Schema.Array(Schema.String).pipe(Schema.mutable),
        tags: Schema.Array(Schema.String).pipe(Schema.mutable),
      }),
    ).pipe(Schema.mutable)
    const [listed] = await readNativeJson(listRes, listResShape)
    expect(hit.tags).toStrictEqual(listed.tags)
    expect(hit.owners).toStrictEqual(listed.owners)
  })

  test('covers MCP search_wiki filters by type, parity with REST', async () => {
    const { slug, token, workspaceId } = await seedWorkspaceFixture()
    await mcpCall(
      workspaceId,
      'create_wiki_page',
      { content: '---\ntype: runbook\n---\nwidget steps', title: 'Widget Runbook' },
      authHeaders(token, slug),
    )
    await mcpCall(
      workspaceId,
      'create_wiki_page',
      { content: '---\ntype: spec\n---\nwidget spec', title: 'Widget Spec' },
      authHeaders(token, slug),
    )

    const result = mcpData(
      await mcpCall(workspaceId, 'search_wiki', { query: 'widget', type: 'spec' }, authHeaders(token, slug)),
      TitleItemsResponse,
    )
    expect(result.items.map((item) => item.title)).toStrictEqual(['Widget Spec'])
  })
})

/*
 * PROJ-509: list_wiki_revisions/get_wiki_revision/delete_wiki_page resolve via
 * id-or-slug + redirect fallback, matching get_wiki_page/update_wiki_page/
 * get_wiki_backlinks — a renamed page's old slug must keep working for every entry
 * point, not just get_wiki_page (PROJ-484's optimistic-locking workflow fetches
 * baseRevisionId via list_wiki_revisions using whatever reference the caller holds).
 */
describe('wiki revisions/delete resolve by old slug after rename (PROJ-509)', () => {
  test('covers REST: GET /:slug/revisions resolves via an old (pre-rename) slug', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    const createRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', title: 'Runbook' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(createRes.status).toBe(201)

    const editRes = await fetchNativeApi('http://localhost/api/wiki/runbook', {
      body: JSON.stringify({ content: 'v2' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(editRes.status).toBe(200)

    const renameRes = await fetchNativeApi('http://localhost/api/wiki/runbook', {
      body: JSON.stringify({ slug: 'operations-runbook' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(renameRes.status).toBe(200)
    await resetRateLimits()

    /*
     * "runbook" is now only a redirect — the old slug must still resolve here, same
     * as GET /:slug (getWikiPage).
     */
    const revRes = await fetchNativeApi('http://localhost/api/wiki/runbook/revisions', {
      headers: authHeaders(token, slug),
    })
    expect(revRes.status).toBe(200)
    const revisions = await readNativeJson(
      revRes,
      Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })).pipe(Schema.mutable),
    )
    expect(revisions).toHaveLength(1)
    expect(revisions[0].title).toBe('Runbook')
  })

  test('covers REST: GET /:slug/revisions/:revisionId resolves via an old (pre-rename) slug', async () => {
    const { slug, token } = await seedWorkspaceFixture()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'v1', title: 'Playbook' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki/playbook', {
      body: JSON.stringify({ content: 'v2' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    const revRes = await fetchNativeApi('http://localhost/api/wiki/playbook/revisions', {
      headers: authHeaders(token, slug),
    })
    const [revision] = await readNativeJson(revRes, IdListResponse)

    await fetchNativeApi('http://localhost/api/wiki/playbook', {
      body: JSON.stringify({ slug: 'team-playbook' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    await resetRateLimits()

    const detailRes = await fetchNativeApi(`http://localhost/api/wiki/playbook/revisions/${revision.id}`, {
      headers: authHeaders(token, slug),
    })
    expect(detailRes.status).toBe(200)
    const detail = await readNativeJson(detailRes, Schema.Struct({ content: Schema.String, id: Schema.String }))
    expect(detail.id).toBe(revision.id)
    expect(detail.content).toBe('v1')
  })

  test('covers MCP: list_wiki_revisions and get_wiki_revision resolve via an old (pre-rename) slug', async () => {
    const { slug, token, workspaceId } = await seedWorkspaceFixture()
    const created = mcpData(
      await mcpCall(workspaceId, 'create_wiki_page', { content: 'v1', title: 'Charter' }, authHeaders(token, slug)),
      SlugResponse,
    )
    await mcpCall(workspaceId, 'update_wiki_page', { slug: created.slug, content: 'v2' }, authHeaders(token, slug))
    await resetRateLimits()
    await mcpCall(
      workspaceId,
      'update_wiki_page',
      { slug: created.slug, newSlug: 'team-charter' },
      authHeaders(token, slug),
    )
    await resetRateLimits()

    const revisions = mcpData(
      await mcpCall(workspaceId, 'list_wiki_revisions', { slug: created.slug }, authHeaders(token, slug)),
      Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })).pipe(Schema.mutable),
    )
    expect(revisions).toHaveLength(1)
    expect(revisions[0].title).toBe('Charter')

    const revision = mcpData(
      await mcpCall(
        workspaceId,
        'get_wiki_revision',
        { slug: created.slug, revisionId: revisions[0].id },
        authHeaders(token, slug),
      ),
      Schema.Struct({ content: Schema.String, id: Schema.String }),
    )
    expect(revision.content).toBe('v1')
  })

  test('covers REST: DELETE /:slug resolves via an old (pre-rename) slug', async () => {
    await seedWorkspaceFixture()
    // Deleting a workspace-level page requires admin/owner (services/wiki.ts).
    const owner = await seedFixture({ role: 'owner' })
    await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(owner.token, owner.workspace.slug),
        JSON.stringify({ content: 'v1', title: 'Draft Notes' }),
      ),
    )
    await fetchNativeApi(
      'http://localhost/api/wiki/draft-notes',
      requestOptionsWithBody(
        'PUT',
        authHeaders(owner.token, owner.workspace.slug),
        JSON.stringify({ slug: 'archived-notes' }),
      ),
    )
    await resetRateLimits()

    /*
     * "draft-notes" is now only a redirect — deleting by the old slug should resolve
     * to the same (renamed) page rather than 404ing.
     */
    const deleteRes = await fetchNativeApi('http://localhost/api/wiki/draft-notes', {
      headers: authHeaders(owner.token, owner.workspace.slug),
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)
    const body = await readNativeJson(deleteRes, Schema.Struct({ deletedCount: Schema.Number, ok: Schema.Boolean }))
    expect(body.ok).toBe(true)
    expect(body.deletedCount).toBe(1)

    const getRes = await fetchNativeApi('http://localhost/api/wiki/archived-notes', {
      headers: authHeaders(owner.token, owner.workspace.slug),
    })
    expect(getRes.status).toBe(404)
  })
})

interface WikiWorkspaceFixture {
  slug: string
  token: string
  workspaceId: string
}

// PROJ-484: optimistic locking (baseRevisionId + conflict diff) on wiki writes
describe('wiki optimistic locking (PROJ-484)', () => {
  /*
   * The test env's RATE_LIMIT_API_MAX is 5 req/window (vite.config.ts), and these
   * tests each fire more than that against one token — reset the counter before every
   * request (same escape hatch as PROJ-238's nesting-depth test above).
   */
  const req = async function req(url: string, opts?: RequestInit): Promise<Response> {
    return resetRateLimitAndFetch(url, opts)
  }

  const seedScenarioFixture = async function seedScenarioFixture(): Promise<
    WikiWorkspaceFixture & {
      getRevisions: (
        pageSlug: string,
      ) => Promise<{ id: string; title: string; summary: string | null; created_at: number }[]>
      mcp: <T>(name: string, args: unknown) => Promise<JsonRpcError | JsonRpcResult<T>>
    }
  > {
    const { token, slug, workspaceId }: WikiWorkspaceFixture = await seedWorkspaceFixture()

    const mcp = async function mcp<T>(name: string, args: unknown): Promise<JsonRpcError | JsonRpcResult<T>> {
      return resetRateLimitAndMcpCall<T>(workspaceId, token, slug, name, args)
    }

    const getRevisions = async function getRevisions(
      pageSlug: string,
    ): Promise<{ id: string; title: string; summary: string | null; created_at: number }[]> {
      const res = await req(`http://localhost/api/wiki/${pageSlug}/revisions`, {
        headers: authHeaders(token, slug),
      })
      const resShape = Schema.Array(
        Schema.Struct({
          created_at: Schema.Number,
          id: Schema.String,
          summary: Schema.Union([Schema.String, Schema.Null]),
          title: Schema.String,
        }),
      ).pipe(Schema.mutable)
      return readNativeJson(res, resShape)
    }
    return { getRevisions, mcp, slug, token, workspaceId }
  }

  test('covers REST: update with no baseRevisionId still succeeds (transitional last-write-wins)', async () => {
    const { slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Transitional', content: 'v1' }),
    })

    const res = await req('http://localhost/api/wiki/transitional', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2' }),
    })
    expect(res.status).toBe(200)

    const pageRes = await req('http://localhost/api/wiki/transitional', {
      headers: authHeaders(token, slug),
    })
    expect(((await pageRes.json()) as { content: string }).content).toBe('v2')
  })

  test('covers REST: update succeeds when baseRevisionId matches the current latest revision', async () => {
    const { getRevisions, slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Locked Doc', content: 'v1' }),
    })
    // First edit (no base yet) creates the first revision, capturing "v1".
    await req('http://localhost/api/wiki/locked-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2' }),
    })
    const [latest] = await getRevisions('locked-doc')

    const res = await req('http://localhost/api/wiki/locked-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v3', baseRevisionId: latest.id }),
    })
    expect(res.status).toBe(200)

    const pageRes = await req('http://localhost/api/wiki/locked-doc', {
      headers: authHeaders(token, slug),
    })
    expect(((await pageRes.json()) as { content: string }).content).toBe('v3')
  })

  test('covers REST: update is rejected with a structured conflict when baseRevisionId is stale', async () => {
    const { getRevisions, slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Contested Doc', content: 'v1' }),
    })
    await req('http://localhost/api/wiki/contested-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2' }),
    })
    const [staleRevision] = await getRevisions('contested-doc')

    // Someone else edits again, advancing the latest revision past staleRevision.
    await req('http://localhost/api/wiki/contested-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v3' }),
    })
    const [currentLatest] = await getRevisions('contested-doc')
    expect(currentLatest.id).not.toBe(staleRevision.id)

    const res = await req('http://localhost/api/wiki/contested-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v4 (stale attempt)', baseRevisionId: staleRevision.id }),
    })
    expect(res.status).toBe(409)
    const body = await readNativeJson(
      res,
      Schema.Struct({ currentRevisionId: Schema.String, diff: Schema.String, error: Schema.String }),
    )
    expect(body.currentRevisionId).toBe(currentLatest.id)
    expect(typeof body.diff).toBe('string')
    // staleRevision snapshots the pre-edit content of the FIRST edit ("v1"), i.e. the
    // content the caller actually had once that edit landed is the NEXT revision's
    // snapshot ("v2"). The diff base is therefore "v2", not staleRevision's own "v1".
    expect(body.diff).toContain('v2')
    expect(body.diff).toContain('v3')

    // The stale write never applied.
    const pageRes = await req('http://localhost/api/wiki/contested-doc', {
      headers: authHeaders(token, slug),
    })
    expect(((await pageRes.json()) as { content: string }).content).toBe('v3')
  })

  test('covers REST: revision rows get a title snapshot', async () => {
    const { getRevisions, slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Snapshot Title', content: 'v1' }),
    })
    await req('http://localhost/api/wiki/snapshot-title', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2' }),
    })

    const [revision] = await getRevisions('snapshot-title')
    expect(revision.title).toBe('Snapshot Title')
  })

  test('covers REST: summary is stored and returned when provided', async () => {
    const { getRevisions, slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Summarized Doc', content: 'v1' }),
    })
    await req('http://localhost/api/wiki/summarized-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2', summary: 'Fixed a typo' }),
    })

    const [revision] = await getRevisions('summarized-doc')
    expect(revision.summary).toBe('Fixed a typo')
  })

  test("covers REST: update is rejected with a validation error when baseRevisionId doesn't belong to the page", async () => {
    const { slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Garbage Base Doc', content: 'v1' }),
    })
    const res = await req('http://localhost/api/wiki/garbage-base-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2', baseRevisionId: crypto.randomUUID() }),
    })
    expect(res.status).toBe(400)
  })

  test('covers MCP: update_wiki_page — matching baseRevisionId succeeds, stale is rejected with a conflict', async () => {
    const { mcp } = await seedScenarioFixture()
    const created = mcpData(await mcp('create_wiki_page', { title: 'MCP Locked Doc', content: 'v1' }), SlugResponse)

    await mcp('update_wiki_page', { slug: created.slug, content: 'v2' })
    const revisionsAfterFirstEdit = mcpData(await mcp('list_wiki_revisions', { slug: created.slug }), IdListResponse)
    const [staleRevision] = revisionsAfterFirstEdit

    // Matching baseRevisionId succeeds.
    const okResult = await mcp('update_wiki_page', {
      slug: created.slug,
      content: 'v3',
      baseRevisionId: staleRevision.id,
      summary: 'v3 edit',
    })
    expect(isMcpError(okResult)).toBe(false)

    const revisionsAfterSecondEdit = mcpData(
      await mcp('list_wiki_revisions', { slug: created.slug }),
      Schema.Array(Schema.Struct({ id: Schema.String, summary: Schema.Union([Schema.String, Schema.Null]) })).pipe(
        Schema.mutable,
      ),
    )
    const [currentLatest] = revisionsAfterSecondEdit
    expect(currentLatest.id).not.toBe(staleRevision.id)
    expect(currentLatest.summary).toBe('v3 edit')

    // Stale baseRevisionId is rejected with a structured conflict.
    const conflictResult = await mcp('update_wiki_page', {
      slug: created.slug,
      content: 'v4 (stale attempt)',
      baseRevisionId: staleRevision.id,
    })
    expect(isMcpError(conflictResult)).toBe(false)
    const conflictErr = toolError(conflictResult)
    expect(conflictErr?.code).toBe('conflict')
    if (conflictErr) {
      const data = conflictErr.details as { currentRevisionId: string; diff: string }
      expect(data.currentRevisionId).toBe(currentLatest.id)
      // staleRevision snapshots the pre-edit content of the FIRST edit ("v1"); the
      // content the caller actually had is the NEXT revision's snapshot ("v2"), which
      // is the correct diff base — not staleRevision's own "v1".
      expect(data.diff).toContain('v2')
      expect(data.diff).toContain('v3')
    }
  })
})

/*
 * PROJ-492 (R10): revision diff endpoint + restore-via-update_wiki_page. Restore is
 * deliberately NOT a dedicated endpoint — it's a client-side convenience that reads an
 * old revision's content and re-submits it through update_wiki_page/PUT with a
 * baseRevisionId, so it gets normal optimistic-locking/frontmatter/FTS/link-reindex
 * treatment for free (see PR description for the design rationale).
 */
describe('wiki revision diff (PROJ-492)', () => {
  const req = async function req(url: string, opts?: RequestInit): Promise<Response> {
    return resetRateLimitAndFetch(url, opts)
  }

  const seedScenarioFixture = async function seedScenarioFixture(): Promise<
    WikiWorkspaceFixture & {
      getRevisions: (pageSlug: string) => Promise<{ id: string; created_at: number }[]>
      mcp: <T>(name: string, args: unknown) => Promise<JsonRpcError | JsonRpcResult<T>>
    }
  > {
    const { token, slug, workspaceId }: WikiWorkspaceFixture = await seedWorkspaceFixture()

    const mcp = async function mcp<T>(name: string, args: unknown): Promise<JsonRpcError | JsonRpcResult<T>> {
      return resetRateLimitAndMcpCall<T>(workspaceId, token, slug, name, args)
    }

    const getRevisions = async function getRevisions(pageSlug: string): Promise<{ id: string; created_at: number }[]> {
      const res = await req(`http://localhost/api/wiki/${pageSlug}/revisions`, {
        headers: authHeaders(token, slug),
      })
      return readNativeJson(
        res,
        Schema.Array(Schema.Struct({ created_at: Schema.Number, id: Schema.String })).pipe(Schema.mutable),
      )
    }
    return { getRevisions, mcp, slug, token, workspaceId }
  }

  test('covers REST: diff against current defaults when `against` is omitted', async () => {
    const { getRevisions, slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Diffable Doc', content: 'line one\nline two' }),
    })
    await req('http://localhost/api/wiki/diffable-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'line one\nline THREE' }),
    })
    const [latest] = await getRevisions('diffable-doc')

    const res = await req(`http://localhost/api/wiki/diffable-doc/revisions/${latest.id}/diff`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(
      res,
      Schema.Struct({ diff: Schema.String, from: Schema.String, to: Schema.String }),
    )
    expect(body.from).toBe(latest.id)
    expect(body.to).toBe('current')
    expect(body.diff).toContain('-line two')
    expect(body.diff).toContain('+line THREE')
  })

  test('covers REST: diff between two explicit revisions', async () => {
    const { getRevisions, slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Multi Rev Doc', content: 'v1' }),
    })
    await req('http://localhost/api/wiki/multi-rev-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2' }),
    })
    await req('http://localhost/api/wiki/multi-rev-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v3' }),
    })
    const [v2Revision, v1Revision] = await getRevisions('multi-rev-doc')

    const res = await req(
      `http://localhost/api/wiki/multi-rev-doc/revisions/${v1Revision.id}/diff?against=${v2Revision.id}`,
      { headers: authHeaders(token, slug) },
    )
    expect(res.status).toBe(200)
    const body = await readNativeJson(res, Schema.Struct({ diff: Schema.String }))
    expect(body.diff).toContain('-v1')
    expect(body.diff).toContain('+v2')
  })

  test('covers REST: identical revisions diff to an empty string', async () => {
    const { getRevisions, slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Unchanged Doc', content: 'same' }),
    })
    await req('http://localhost/api/wiki/unchanged-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'same' }),
    })
    const [latest] = await getRevisions('unchanged-doc')

    const res = await req(`http://localhost/api/wiki/unchanged-doc/revisions/${latest.id}/diff?against=current`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { diff: string }).diff).toBe('')
  })

  test('covers REST: an unknown `against` revision id 404s', async () => {
    const { getRevisions, slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Unknown Against Doc', content: 'v1' }),
    })
    await req('http://localhost/api/wiki/unknown-against-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2' }),
    })
    const [latest] = await getRevisions('unknown-against-doc')

    const res = await req(
      `http://localhost/api/wiki/unknown-against-doc/revisions/${latest.id}/diff?against=${crypto.randomUUID()}`,
      { headers: authHeaders(token, slug) },
    )
    expect(res.status).toBe(404)
  })

  test('covers REST: an unknown revisionId 404s', async () => {
    const { slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'No Such Revision Doc', content: 'v1' }),
    })

    const res = await req(`http://localhost/api/wiki/no-such-revision-doc/revisions/${crypto.randomUUID()}/diff`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(404)
  })

  test('covers MCP: get_wiki_revision_diff parity with REST', async () => {
    const { mcp } = await seedScenarioFixture()
    const created = mcpData(await mcp('create_wiki_page', { title: 'MCP Diff Doc', content: 'alpha' }), SlugResponse)
    await mcp('update_wiki_page', { slug: created.slug, content: 'beta' })
    const [latest] = mcpData(await mcp('list_wiki_revisions', { slug: created.slug }), IdListResponse)

    const result = mcpData(
      await mcp('get_wiki_revision_diff', { slug: created.slug, revisionId: latest.id }),
      Schema.Struct({ diff: Schema.String, from: Schema.String, to: Schema.String }),
    )
    expect(result.to).toBe('current')
    expect(result.diff).toContain('-alpha')
    expect(result.diff).toContain('+beta')
  })

  test('restore is a plain update_wiki_page call with old content — new revision, never rewrites history', async () => {
    const { getRevisions, slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Restorable Doc', content: 'original content' }),
    })
    await req('http://localhost/api/wiki/restorable-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'mistaken edit' }),
    })
    const [latest] = await getRevisions('restorable-doc')

    // Fetch the old revision's content (what the restore UI does) and resubmit it.
    const revRes = await req(`http://localhost/api/wiki/restorable-doc/revisions/${latest.id}`, {
      headers: authHeaders(token, slug),
    })
    const oldRevision = await readNativeJson(revRes, Schema.Struct({ content: Schema.String }))
    expect(oldRevision.content).toBe('original content')

    const restoreRes = await req('http://localhost/api/wiki/restorable-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        content: oldRevision.content,
        baseRevisionId: latest.id,
        summary: `Restored from revision ${latest.id}`,
      }),
    })
    expect(restoreRes.status).toBe(200)

    const pageRes = await req('http://localhost/api/wiki/restorable-doc', {
      headers: authHeaders(token, slug),
    })
    expect(((await pageRes.json()) as { content: string }).content).toBe('original content')

    /*
     * Restoring created a NEW (third) revision snapshotting the pre-restore "mistaken
     * edit" content — it never rewrote or deleted the original "original content"
     * revision, which is still present in history.
     */
    const revisions = await getRevisions('restorable-doc')
    expect(revisions).toHaveLength(2)
    expect(revisions[0].id).not.toBe(latest.id)
    expect(revisions.map((revision) => revision.id)).toContain(latest.id)
  })

  test('restore with a baseRevisionId stale from open history is a 409, not a silent overwrite', async () => {
    const { getRevisions, slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Raced Restore Doc', content: 'original content' }),
    })
    await req('http://localhost/api/wiki/raced-restore-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'mistaken edit' }),
    })
    // What the restore UI froze when the history panel loaded.
    const [staleLatest] = await getRevisions('raced-restore-doc')

    // Someone else saves before the user clicks Restore.
    await req('http://localhost/api/wiki/raced-restore-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: "a colleague's edit" }),
    })

    const restoreRes = await req('http://localhost/api/wiki/raced-restore-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        content: 'original content',
        baseRevisionId: staleLatest.id,
        summary: 'Restored from an old revision',
      }),
    })
    expect(restoreRes.status).toBe(409)
    const conflict = await readNativeJson(
      restoreRes,
      Schema.Struct({ currentRevisionId: Schema.String, diff: Schema.String }),
    )
    expect(conflict.currentRevisionId).not.toBe(staleLatest.id)

    // The colleague's edit survives untouched and no restore revision was written.
    const pageRes = await req('http://localhost/api/wiki/raced-restore-doc', {
      headers: authHeaders(token, slug),
    })
    expect(((await pageRes.json()) as { content: string }).content).toBe("a colleague's edit")
    expect(await getRevisions('raced-restore-doc')).toHaveLength(2)
  })

  test('restoring a revision whose frontmatter no longer validates fails cleanly — 400, no partial write', async () => {
    const { getRevisions, slug, token } = await seedScenarioFixture()
    await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Legacy Frontmatter Doc', content: 'first body' }),
    })
    await req('http://localhost/api/wiki/legacy-frontmatter-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'second body' }),
    })
    const [latest] = await getRevisions('legacy-frontmatter-doc')

    /*
     * Simulate a snapshot taken before R6's frontmatter validation existed, carrying a
     * `status` value outside today's closed enum. Written straight to the revision row
     * because the API (correctly) refuses to create such content in the first place.
     */
    await env.DB.prepare('UPDATE wiki_revisions SET content = ? WHERE id = ?')
      .bind('---\nstatus: archived\n---\n\nlegacy body', latest.id)
      .run()

    const revRes = await req(`http://localhost/api/wiki/legacy-frontmatter-doc/revisions/${latest.id}`, {
      headers: authHeaders(token, slug),
    })
    const oldRevision = await readNativeJson(revRes, Schema.Struct({ content: Schema.String }))

    const restoreRes = await req('http://localhost/api/wiki/legacy-frontmatter-doc', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        content: oldRevision.content,
        baseRevisionId: latest.id,
        summary: 'Restored from a legacy revision',
      }),
    })
    expect(restoreRes.status).toBe(400)

    // The live page is untouched and no half-written revision was left behind.
    const pageRes = await req('http://localhost/api/wiki/legacy-frontmatter-doc', {
      headers: authHeaders(token, slug),
    })
    expect(((await pageRes.json()) as { content: string }).content).toBe('second body')
    expect(await getRevisions('legacy-frontmatter-doc')).toHaveLength(1)
  })
})

/*
 * PROJ-490: section-addressed patch operations (R8). Disjoint-section writes must
 * never conflict — that's the headline behavior a naive whole-page baseRevisionId
 * check would break.
 */
describe('wiki patch operations (PROJ-490)', () => {
  let token: string, slug: string, workspaceId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId } = await seedWorkspaceFixture())
  })

  // Same rate-limit escape hatch as the PROJ-484 describe block above.
  const req = async function req(url: string, opts?: RequestInit): Promise<Response> {
    return resetRateLimitAndFetch(url, opts)
  }

  const mcp = async function mcp<T>(name: string, args: unknown): Promise<JsonRpcError | JsonRpcResult<T>> {
    return resetRateLimitAndMcpCall<T>(workspaceId, token, slug, name, args)
  }

  const createPage = async function createPage(
    pageSlug: string,
    title: string,
    content: string,
  ): Promise<{ id: string; slug: string }> {
    const res = await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title, content, slug: pageSlug }),
    })
    expect(res.status).toBe(201)
    return readNativeJson(res, IdAndSlugResponse)
  }

  const getPage = async function getPage(pageSlug: string): Promise<{ content: string }> {
    const res = await req(`http://localhost/api/wiki/${pageSlug}`, {
      headers: authHeaders(token, slug),
    })
    return readNativeJson(res, Schema.Struct({ content: Schema.String }))
  }

  const TWO_SECTIONS = '## Alpha\nAlpha body.\n\n## Beta\nBeta body.\n'

  test('covers REST: append_to_section adds text at the end of the target section only', async () => {
    await createPage('patch-append', 'Patch Append', TWO_SECTIONS)
    const res = await req('http://localhost/api/wiki/patch-append', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Alpha',
        text: 'Extra alpha line.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(200)
    const page = await getPage('patch-append')
    expect(page.content).toContain('Alpha body.\n\nExtra alpha line.')
    expect(page.content).toContain('## Beta\nBeta body.')
  })

  test('covers REST: replace_section replaces the section body, keeping the heading', async () => {
    await createPage('patch-replace', 'Patch Replace', TWO_SECTIONS)
    const res = await req('http://localhost/api/wiki/patch-replace', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'replace_section',
        heading: 'Alpha',
        text: 'Replaced alpha body.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(200)
    const page = await getPage('patch-replace')
    expect(page.content).toContain('## Alpha\nReplaced alpha body.')
    expect(page.content).not.toContain('Alpha body.\n')
    expect(page.content).toContain('## Beta\nBeta body.')
  })

  test('covers REST: insert_after_heading inserts content directly under the heading, before the existing body', async () => {
    await createPage('patch-insert', 'Patch Insert', TWO_SECTIONS)
    const res = await req('http://localhost/api/wiki/patch-insert', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'insert_after_heading',
        heading: 'Alpha',
        text: 'Inserted line.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(200)
    const page = await getPage('patch-insert')
    const inserted = page.content.indexOf('Inserted line.')
    const body = page.content.indexOf('Alpha body.')
    expect(inserted).toBeGreaterThan(-1)
    expect(inserted).toBeLessThan(body)
  })

  test('covers REST: append_to_page appends at the very end regardless of section structure', async () => {
    await createPage('patch-append-page', 'Patch Append Page', TWO_SECTIONS)
    const res = await req('http://localhost/api/wiki/patch-append-page', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_page',
        text: '## Gamma\nGamma body.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(200)
    const page = await getPage('patch-append-page')
    expect(page.content.trim().endsWith('## Gamma\nGamma body.')).toBe(true)
  })

  test('covers REST: patch creates a revision, restorable via list_wiki_revisions', async () => {
    await createPage('patch-revision', 'Patch Revision', TWO_SECTIONS)
    await req('http://localhost/api/wiki/patch-revision', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Alpha',
        text: 'More alpha.',
        baseRevisionId: JSON_NULL,
        summary: 'added alpha detail',
      }),
    })
    const revRes = await req('http://localhost/api/wiki/patch-revision/revisions', {
      headers: authHeaders(token, slug),
    })
    const revisionsShape = Schema.Array(
      Schema.Struct({ id: Schema.String, summary: Schema.Union([Schema.String, Schema.Null]) }),
    ).pipe(Schema.mutable)
    const revisions = await readNativeJson(revRes, revisionsShape)
    expect(revisions).toHaveLength(1)
    expect(revisions[0].summary).toBe('added alpha detail')

    const snapshotRes = await req(`http://localhost/api/wiki/patch-revision/revisions/${revisions[0].id}`, {
      headers: authHeaders(token, slug),
    })
    const snapshot = await readNativeJson(snapshotRes, Schema.Struct({ content: Schema.String }))
    expect(snapshot.content).toBe(TWO_SECTIONS)
  })

  test('covers REST: unknown heading is rejected with a structured error listing current headings', async () => {
    await createPage('patch-missing-heading', 'Patch Missing Heading', TWO_SECTIONS)
    const res = await req('http://localhost/api/wiki/patch-missing-heading', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Gamma',
        text: 'x',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(404)
    const body = await readNativeJson(
      res,
      Schema.Struct({ currentHeadings: Schema.Array(Schema.String).pipe(Schema.mutable), error: Schema.String }),
    )
    expect(body.currentHeadings).toStrictEqual(['Alpha', 'Beta'])
  })

  test('covers REST: disjoint-section writes never conflict — two patches vs. a stale baseRevisionId both succeed', async () => {
    await createPage('patch-disjoint', 'Patch Disjoint', TWO_SECTIONS)
    const revRes = await req('http://localhost/api/wiki/patch-disjoint/revisions', {
      headers: authHeaders(token, slug),
    })
    // No revisions yet (page just created) — base is null.
    expect((await revRes.json()) as unknown[]).toHaveLength(0)

    // Agent A patches Alpha.
    const resA = await req('http://localhost/api/wiki/patch-disjoint', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Alpha',
        text: 'From agent A.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(resA.status).toBe(200)

    /*
     * Agent B still holds the same stale baseRevisionId (null — pre-A's edit) but
     * targets the disjoint Beta section. This must succeed, not conflict, even
     * though the page's overall revision has advanced since A's write.
     */
    const resB = await req('http://localhost/api/wiki/patch-disjoint', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Beta',
        text: 'From agent B.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(resB.status).toBe(200)

    const page = await getPage('patch-disjoint')
    expect(page.content).toContain('Alpha body.\n\nFrom agent A.')
    expect(page.content).toContain('Beta body.\n\nFrom agent B.')
  })

  test('covers REST: a same-section conflict is rejected with a structured diff', async () => {
    await createPage('patch-conflict', 'Patch Conflict', TWO_SECTIONS)

    // Agent A patches Alpha from the null base.
    await req('http://localhost/api/wiki/patch-conflict', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Alpha',
        text: 'From agent A.',
        baseRevisionId: JSON_NULL,
      }),
    })

    /*
     * Agent B still holds the stale null base but targets the SAME Alpha section —
     * this must conflict.
     */
    const res = await req('http://localhost/api/wiki/patch-conflict', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Alpha',
        text: 'From agent B.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(409)
    const body = await readNativeJson(
      res,
      Schema.Struct({ currentRevisionId: Schema.String, diff: Schema.String, error: Schema.String }),
    )
    expect(typeof body.currentRevisionId).toBe('string')
    expect(body.diff).toContain('From agent A.')
  })

  test('covers REST: a section deleted since baseRevisionId surfaces as a not-found error, not a silent conflict', async () => {
    await createPage('patch-deleted-section', 'Patch Deleted Section', TWO_SECTIONS)
    const revRes = await req('http://localhost/api/wiki/patch-deleted-section/revisions', {
      headers: authHeaders(token, slug),
    })
    expect((await revRes.json()) as unknown[]).toHaveLength(0)

    // Someone replaces the whole page, removing the Beta heading entirely.
    await req('http://localhost/api/wiki/patch-deleted-section', {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: '## Alpha\nAlpha body.\n' }),
    })

    const res = await req('http://localhost/api/wiki/patch-deleted-section', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Beta',
        text: 'x',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(404)
    const body = await readNativeJson(
      res,
      Schema.Struct({ currentHeadings: Schema.Array(Schema.String).pipe(Schema.mutable) }),
    )
    expect(body.currentHeadings).toStrictEqual(['Alpha'])
  })

  test('covers REST: patch preserves existing YAML frontmatter untouched', async () => {
    const content = '---\ntype: runbook\nstatus: current\n---\n\n## Alpha\nAlpha body.\n'
    await createPage('patch-frontmatter', 'Patch Frontmatter', content)
    const res = await req('http://localhost/api/wiki/patch-frontmatter', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Alpha',
        text: 'More.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(200)
    const getRes = await req('http://localhost/api/wiki/patch-frontmatter', {
      headers: authHeaders(token, slug),
    })
    const page = await readNativeJson(
      getRes,
      Schema.Struct({ content: Schema.String, status: Schema.String, type: Schema.String }),
    )
    expect(page.content).toContain('type: runbook')
    expect(page.type).toBe('runbook')
    expect(page.status).toBe('current')
  })

  test('covers REST: viewer role cannot patch a workspace-level page', async () => {
    const roles = await seedWorkspaceRoles()
    await resetRateLimits()
    const createRes = await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(roles.owner.token, roles.workspace.slug),
        JSON.stringify({ content: TWO_SECTIONS, slug: 'patch-viewer', title: 'Patch Viewer' }),
      ),
    )
    expect(createRes.status).toBe(201)

    await resetRateLimits()
    const res = await fetchNativeApi(
      'http://localhost/api/wiki/patch-viewer',
      requestOptionsWithBody(
        'PATCH',
        authHeaders(roles.viewer.token, roles.workspace.slug),
        JSON.stringify({
          baseRevisionId: JSON_NULL,
          heading: 'Alpha',
          op: 'append_to_section',
          text: 'x',
        }),
      ),
    )
    expect(res.status).toBe(403)
  })

  test("covers REST: baseRevisionId that doesn't belong to the page is rejected with a validation error", async () => {
    await createPage('patch-garbage-base', 'Patch Garbage Base', TWO_SECTIONS)
    const res = await req('http://localhost/api/wiki/patch-garbage-base', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Alpha',
        text: 'x',
        baseRevisionId: crypto.randomUUID(),
      }),
    })
    expect(res.status).toBe(400)
  })

  /*
   * PROJ-524: append_to_page skips the *conflict* check for baseRevisionId (append is
   * commutative), but still must validate the id belongs to the page — same as the
   * section-addressed ops above — so a caller confused about which page it's targeting
   * gets a signal instead of silent acceptance.
   */
  test("covers REST: append_to_page rejects a baseRevisionId that doesn't belong to the page", async () => {
    await createPage('patch-append-garbage-base', 'Patch Append Garbage Base', TWO_SECTIONS)
    const res = await req('http://localhost/api/wiki/patch-append-garbage-base', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_page',
        text: 'Gamma body.',
        baseRevisionId: crypto.randomUUID(),
      }),
    })
    expect(res.status).toBe(400)
  })

  test('covers REST: append_to_page accepts a stale baseRevisionId belonging to the page (staleness ignored here)', async () => {
    await createPage('patch-append-stale-base', 'Patch Append Stale Base', TWO_SECTIONS)
    const firstRes = await req('http://localhost/api/wiki/patch-append-stale-base', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Alpha',
        text: 'First edit.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(firstRes.status).toBe(200)
    const revisions = (await (
      await req('http://localhost/api/wiki/patch-append-stale-base/revisions', {
        headers: authHeaders(token, slug),
      })
    ).json()) as { id: string }[]

    const res = await req('http://localhost/api/wiki/patch-append-stale-base', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_page',
        text: 'Appended after stale base.',
        baseRevisionId: revisions[0].id,
      }),
    })
    expect(res.status).toBe(200)
    const page = await getPage('patch-append-stale-base')
    expect(page.content.trim().endsWith('Appended after stale base.')).toBe(true)
  })

  test('covers REST: set_frontmatter adds a frontmatter block to a page that had none', async () => {
    await createPage('patch-frontmatter-new', 'Patch Frontmatter New', TWO_SECTIONS)
    const res = await req('http://localhost/api/wiki/patch-frontmatter-new', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'set_frontmatter',
        values: { status: 'current' },
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(200)
    const page = (await (
      await req('http://localhost/api/wiki/patch-frontmatter-new', {
        headers: authHeaders(token, slug),
      })
    ).json()) as { content: string; status: string }
    expect(page.status).toBe('current')
    expect(page.content).toMatch(/^---\nstatus: current\n---\n/u)
    expect(page.content).toContain(TWO_SECTIONS.trim())
  })

  test('covers REST: set_frontmatter preserves other existing frontmatter keys', async () => {
    await createPage(
      'patch-frontmatter-preserve',
      'Patch Frontmatter Preserve',
      `---\ntype: runbook\ntags:\n  - ops\nstatus: draft\n---\n${TWO_SECTIONS}`,
    )
    const res = await req('http://localhost/api/wiki/patch-frontmatter-preserve', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'set_frontmatter',
        values: { status: 'deprecated' },
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(200)
    const page = (await (
      await req('http://localhost/api/wiki/patch-frontmatter-preserve', {
        headers: authHeaders(token, slug),
      })
    ).json()) as { type: string; tags: string[]; status: string }
    expect(page.status).toBe('deprecated')
    expect(page.type).toBe('runbook')
    expect(page.tags).toStrictEqual(['ops'])
  })

  test('covers REST: set_frontmatter with a null value removes that key', async () => {
    await createPage(
      'patch-frontmatter-remove',
      'Patch Frontmatter Remove',
      `---\ntype: runbook\nstatus: draft\n---\n${TWO_SECTIONS}`,
    )
    const res = await req('http://localhost/api/wiki/patch-frontmatter-remove', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'set_frontmatter',
        values: { type: JSON_NULL },
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(200)
    const page = (await (
      await req('http://localhost/api/wiki/patch-frontmatter-remove', {
        headers: authHeaders(token, slug),
      })
    ).json()) as { type: string | null; status: string }
    expect(page.type).toBeNull()
    expect(page.status).toBe('draft')
  })

  test('covers REST: set_frontmatter rejects an invalid value with a structured validation error', async () => {
    await createPage('patch-frontmatter-invalid', 'Patch Frontmatter Invalid', TWO_SECTIONS)
    const res = await req('http://localhost/api/wiki/patch-frontmatter-invalid', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'set_frontmatter',
        values: { status: 'not-a-real-status' },
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(400)
    const bodyShape = Schema.Struct({
      error: Schema.Struct({
        fieldErrors: Schema.Record(Schema.String, Schema.Array(Schema.String).pipe(Schema.mutable)),
      }),
    })
    const body = await readNativeJson(res, bodyShape)
    expect(body.error.fieldErrors.values?.length).toBeGreaterThan(0)
  })

  test('covers REST: set_frontmatter rejects an empty values map', async () => {
    await createPage('patch-frontmatter-empty', 'Patch Frontmatter Empty', TWO_SECTIONS)
    const res = await req('http://localhost/api/wiki/patch-frontmatter-empty', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ op: 'set_frontmatter', values: {}, baseRevisionId: JSON_NULL }),
    })
    expect(res.status).toBe(400)
  })

  test('covers REST: set_frontmatter flips status to deprecated in one call and search demotes it', async () => {
    await createPage('patch-frontmatter-demote', 'Patch Frontmatter Demote', `${TWO_SECTIONS}\nuniquedemotekeyword`)
    await req('http://localhost/api/wiki/patch-frontmatter-demote', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'set_frontmatter',
        values: { status: 'deprecated' },
        baseRevisionId: JSON_NULL,
      }),
    })
    await createPage('patch-frontmatter-current', 'Patch Frontmatter Current', 'uniquedemotekeyword')

    const searchRes = await req('http://localhost/api/wiki/search?q=uniquedemotekeyword', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(searchRes, TitleListResponse)
    expect(results.map((result) => result.title)).toStrictEqual([
      'Patch Frontmatter Current',
      'Patch Frontmatter Demote',
    ])
  })

  test('covers REST: set_frontmatter accepts a stale baseRevisionId belonging to the page', async () => {
    await createPage('patch-frontmatter-stale-base', 'Patch Frontmatter Stale Base', TWO_SECTIONS)
    await req('http://localhost/api/wiki/patch-frontmatter-stale-base', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Alpha',
        text: 'First edit.',
        baseRevisionId: JSON_NULL,
      }),
    })
    const revisions = (await (
      await req('http://localhost/api/wiki/patch-frontmatter-stale-base/revisions', {
        headers: authHeaders(token, slug),
      })
    ).json()) as { id: string }[]

    const res = await req('http://localhost/api/wiki/patch-frontmatter-stale-base', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'set_frontmatter',
        values: { status: 'current' },
        baseRevisionId: revisions[0].id,
      }),
    })
    expect(res.status).toBe(200)
  })

  test("covers REST: set_frontmatter rejects a baseRevisionId that doesn't belong to the page", async () => {
    await createPage('patch-frontmatter-garbage-base', 'Patch Frontmatter Garbage Base', TWO_SECTIONS)
    const res = await req('http://localhost/api/wiki/patch-frontmatter-garbage-base', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'set_frontmatter',
        values: { status: 'current' },
        baseRevisionId: crypto.randomUUID(),
      }),
    })
    expect(res.status).toBe(400)
  })

  test('covers MCP: set_frontmatter parity — sets a key, preserves others, over MCP', async () => {
    const created = mcpData(
      await mcp('create_wiki_page', {
        title: 'MCP Frontmatter Doc',
        content: `---\ntype: runbook\n---\n${TWO_SECTIONS}`,
      }),
      SlugResponse,
    )

    const ok = await mcp('patch_wiki_page', {
      slug: created.slug,
      op: 'set_frontmatter',
      values: { status: 'deprecated' },
      baseRevisionId: null,
    })
    expect(isMcpError(ok)).toBe(false)

    const invalid = await mcp('patch_wiki_page', {
      slug: created.slug,
      op: 'set_frontmatter',
      values: { status: 'not-a-real-status' },
      baseRevisionId: null,
    })
    expect(isMcpError(invalid)).toBe(false)
    expect(toolError(invalid)?.code).toBe('validation')

    const page = mcpData(
      await mcp('get_wiki_page', { slug: created.slug }),
      Schema.Struct({ status: Schema.String, type: Schema.String }),
    )
    expect(page.type).toBe('runbook')
    expect(page.status).toBe('deprecated')
  })

  test("covers MCP: patch_wiki_page parity — disjoint sections don't conflict, same section does", async () => {
    const created = mcpData(
      await mcp('create_wiki_page', { title: 'MCP Patch Doc', content: TWO_SECTIONS }),
      SlugResponse,
    )

    const okA = await mcp('patch_wiki_page', {
      slug: created.slug,
      op: 'append_to_section',
      heading: 'Alpha',
      text: 'From MCP agent A.',
      baseRevisionId: null,
    })
    expect(isMcpError(okA)).toBe(false)

    const okB = await mcp('patch_wiki_page', {
      slug: created.slug,
      op: 'append_to_section',
      heading: 'Beta',
      text: 'From MCP agent B.',
      baseRevisionId: null,
    })
    expect(isMcpError(okB)).toBe(false)

    const conflict = await mcp('patch_wiki_page', {
      slug: created.slug,
      op: 'append_to_section',
      heading: 'Alpha',
      text: 'From MCP agent C.',
      baseRevisionId: null,
    })
    expect(isMcpError(conflict)).toBe(false)
    const conflictErr = toolError(conflict)
    expect(conflictErr?.code).toBe('conflict')
    expect(typeof conflictErr?.details?.currentRevisionId).toBe('string')

    const missingHeading = await mcp('patch_wiki_page', {
      slug: created.slug,
      op: 'replace_section',
      heading: 'Nope',
      text: 'x',
      baseRevisionId: null,
    })
    expect(isMcpError(missingHeading)).toBe(false)
    const missingErr = toolError(missingHeading)
    expect(missingErr?.code).toBe('not_found')
    expect(missingErr?.details?.currentHeadings).toStrictEqual(['Alpha', 'Beta'])
  })

  /*
   * PROJ-523: the sibling ambiguous-heading case is a ValidationError, not a
   * NotFoundError — before PROJ-508's error.data plumbing it collapsed to a bare
   * "Invalid params" over MCP, dropping the duplicate-heading detail REST callers
   * got via body.error.formErrors. Twin of the REST test below.
   */
  test('covers MCP: patch_wiki_page rejects an ambiguous heading with formErrors as the tool error message', async () => {
    const created = mcpData(
      await mcp('create_wiki_page', {
        title: 'MCP Patch Ambiguous',
        content: '# Notes\nOne.\n\n## Other\nx\n\n## Notes\nTwo.\n',
      }),
      SlugResponse,
    )

    const result = await mcp('patch_wiki_page', {
      slug: created.slug,
      op: 'replace_section',
      heading: 'Notes',
      text: 'Replaced.',
      baseRevisionId: null,
    })
    expect(isMcpError(result)).toBe(false)
    const err = toolError(result)
    expect(err?.code).toBe('validation')
    expect(err?.message).toContain('ambiguous')
    expect(err?.fields?.heading).toStrictEqual(['h1', 'h2'])
  })

  /*
   * PROJ-490: `#` lines only start a section in ordinary block context. A shell
   * comment in a fenced code block is the most common line in a runbook — treating
   * it as a heading would end the enclosing section mid-fence and a replace would
   * eat the opening fence, leaving an orphaned closing one.
   */
  test('covers REST: a `#` line inside a fenced code block is not a heading', async () => {
    const content = '## Setup\n\n```bash\n# install deps\npnpm i\n```\n\n## Usage\nUse it.\n'
    await createPage('patch-fenced', 'Patch Fenced', content)

    const missing = await req('http://localhost/api/wiki/patch-fenced', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'install deps',
        text: 'x',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(missing.status).toBe(404)
    const body = await readNativeJson(
      missing,
      Schema.Struct({ currentHeadings: Schema.Array(Schema.String).pipe(Schema.mutable) }),
    )
    expect(body.currentHeadings).toStrictEqual(['Setup', 'Usage'])

    const res = await req('http://localhost/api/wiki/patch-fenced', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'replace_section',
        heading: 'Setup',
        text: 'Replaced.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(200)
    const page = await getPage('patch-fenced')
    /*
     * The whole fenced block belonged to Setup, so it goes with the replaced body —
     * intact, not shredded into an orphan closing fence.
     */
    expect(page.content).not.toContain('pnpm i')
    expect(page.content).not.toContain('```')
    expect(page.content).toContain('## Setup\nReplaced.')
    expect(page.content).toContain('## Usage\nUse it.')
  })

  test('covers REST: a `#` line inside the YAML frontmatter block is not a heading', async () => {
    const content = '---\ntype: runbook\n# a yaml comment\nstatus: current\n---\n\n## Alpha\nAlpha body.\n'
    await createPage('patch-fm-comment', 'Patch FM Comment', content)
    const res = await req('http://localhost/api/wiki/patch-fm-comment', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'a yaml comment',
        text: 'x',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(404)
    const body = await readNativeJson(
      res,
      Schema.Struct({ currentHeadings: Schema.Array(Schema.String).pipe(Schema.mutable) }),
    )
    expect(body.currentHeadings).toStrictEqual(['Alpha'])
  })

  test('covers REST: a heading appearing twice is rejected as ambiguous rather than silently patching the first', async () => {
    const content = '# Notes\nOne.\n\n## Other\nx\n\n## Notes\nTwo.\n'
    await createPage('patch-ambiguous', 'Patch Ambiguous', content)
    const res = await req('http://localhost/api/wiki/patch-ambiguous', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'replace_section',
        heading: 'Notes',
        text: 'Replaced.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(400)
    const bodyShape = Schema.Struct({
      error: Schema.Struct({
        fieldErrors: Schema.Record(Schema.String, Schema.Array(Schema.String).pipe(Schema.mutable)),
        formErrors: Schema.Array(Schema.String).pipe(Schema.mutable),
      }),
    })
    const body = await readNativeJson(res, bodyShape)
    expect(body.error.formErrors.join(' ')).toContain('ambiguous')
    expect(body.error.fieldErrors.heading).toStrictEqual(['h1', 'h2'])
    // Nothing was written.
    const result = await getPage('patch-ambiguous')
    expect(result.content).toBe(content)
  })

  test('covers REST: repeated insert_after_heading does not accumulate blank lines', async () => {
    await createPage('patch-blanklines', 'Patch Blank Lines', TWO_SECTIONS)
    for (const text of ['First.', 'Second.']) {
      const revRes = await req('http://localhost/api/wiki/patch-blanklines/revisions', {
        headers: authHeaders(token, slug),
      })
      const revisions = await readNativeJson(revRes, IdListResponse)
      const res = await req('http://localhost/api/wiki/patch-blanklines', {
        method: 'PATCH',
        headers: authHeaders(token, slug),
        body: JSON.stringify({
          op: 'insert_after_heading',
          heading: 'Alpha',
          text,
          baseRevisionId: revisions[0]?.id ?? null,
        }),
      })
      expect(res.status).toBe(200)
    }
    const page = await getPage('patch-blanklines')
    expect(page.content).not.toContain('\n\n\n')
    expect(page.content).toContain('## Alpha\nSecond.\n\nFirst.\n\nAlpha body.')
  })

  test('covers REST: patch does not stamp verified_at as a side effect', async () => {
    const content = '---\ntype: runbook\n---\n\n## Alpha\nAlpha body.\n'
    await createPage('patch-no-verify', 'Patch No Verify', content)
    const res = await req('http://localhost/api/wiki/patch-no-verify', {
      method: 'PATCH',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        op: 'append_to_section',
        heading: 'Alpha',
        text: 'More.',
        baseRevisionId: JSON_NULL,
      }),
    })
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT verified_at, verified_by FROM wiki_pages WHERE slug = ?')
      .bind('patch-no-verify')
      .first<{ verified_at: number | null; verified_by: string | null }>()
    expect(row?.verified_at).toBeNull()
    expect(row?.verified_by).toBeNull()
  })
})

/*
 * PROJ-483: exercises the dedup UPDATE statement from 0041_wiki_slug_unique.sql in
 * isolation. The migration itself runs before any tests seed data (test/setup.ts's
 * beforeAll), so by the time tests execute the unique index is already enforcing —
 * there is no way to get duplicate wiki_pages rows through the running app to
 * re-verify the migration end-to-end. Running the identical dedup SQL against a
 * scratch table shaped like the pre-migration wiki_pages table verifies the
 * algorithm's correctness directly instead.
 */
describe('wiki slug dedup algorithm (0041_wiki_slug_unique.sql)', () => {
  const DEDUP_SQL = `WITH ranked AS (
		SELECT id, ROW_NUMBER() OVER (
			PARTITION BY workspace_id, slug ORDER BY created_at, id
		) AS rn
		FROM dedup_scratch
	)
	UPDATE dedup_scratch
	SET slug = dedup_scratch.slug || '-' || substr(dedup_scratch.id, 1, 8)
	WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`

  const withScratchTable = async function withScratchTable(fn: () => Promise<void>): Promise<void> {
    await env.DB.prepare(
      `CREATE TABLE dedup_scratch (
				id TEXT PRIMARY KEY,
				workspace_id TEXT NOT NULL,
				slug TEXT NOT NULL,
				created_at INTEGER NOT NULL
			)`,
    ).run()
    try {
      await fn()
    } finally {
      await env.DB.prepare('DROP TABLE dedup_scratch').run()
    }
  }

  test("keeps the oldest page's slug and appends an id-derived suffix to newer duplicates", async () => {
    await withScratchTable(async () => {
      await env.DB.prepare(
        'INSERT INTO dedup_scratch (id, workspace_id, slug, created_at) VALUES ' +
          "('p1', 'ws1', 'operations', 100), ('p2', 'ws1', 'operations', 200), " +
          "('p3', 'ws1', 'operations', 300), ('p4', 'ws1', 'other', 100)",
      ).run()

      await env.DB.prepare(DEDUP_SQL).run()

      const { results } = await env.DB.prepare('SELECT id, slug FROM dedup_scratch ORDER BY id').all<{
        id: string
        slug: string
      }>()
      expect(results).toStrictEqual([
        { id: 'p1', slug: 'operations' },
        { id: 'p2', slug: 'operations-p2' },
        { id: 'p3', slug: 'operations-p3' },
        { id: 'p4', slug: 'other' },
      ])
    })
  })

  test("doesn't collide with a pre-existing slug that looks like a row-number suffix", async () => {
    /*
     * Regression case: a plain `-2` / `-3` row-number suffix would collide with an
     * unrelated page that already happens to be named e.g. "operations-2", aborting
     * the UNIQUE INDEX creation that follows this UPDATE. An id-derived suffix can't
     * collide with a pre-existing slug this way.
     */
    await withScratchTable(async () => {
      await env.DB.prepare(
        'INSERT INTO dedup_scratch (id, workspace_id, slug, created_at) VALUES ' +
          "('p1', 'ws1', 'operations', 100), ('p2', 'ws1', 'operations', 200), " +
          "('p3', 'ws1', 'operations-2', 50)",
      ).run()

      await env.DB.prepare(DEDUP_SQL).run()

      const { results } = await env.DB.prepare('SELECT id, slug FROM dedup_scratch ORDER BY id').all<{
        id: string
        slug: string
      }>()
      const slugs = results.map((result) => result.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
      expect(results.find((result) => result.id === 'p1')?.slug).toBe('operations')
      expect(results.find((result) => result.id === 'p3')?.slug).toBe('operations-2')
    })
  })
})

describe('wiki link graph and backlinks (PROJ-485)', () => {
  let token: string
  let slug: string

  beforeEach(async () => {
    const fixture = await seedFixture()
    token = fixture.token
    slug = fixture.workspace.slug
  })

  const createPage = async function createPage(title: string, content: string): Promise<{ id: string; slug: string }> {
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content, title }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    return readNativeJson(res, IdAndSlugResponse)
  }

  test('[[Target]] and [[Target|label]] both resolve a backlink to the target page', async () => {
    const target = await createPage('Runbook', 'how to page')
    await createPage('Alpha', 'see [[Runbook]] for details')
    await createPage('Beta', 'see [[Runbook|the runbook]] for details')

    const res = await fetchNativeApi(`http://localhost/api/wiki/${target.slug}/backlinks`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const backlinks = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ slug: Schema.String, title: Schema.String })).pipe(Schema.mutable),
    )
    expect(backlinks.map((b) => b.slug).sort()).toStrictEqual(['alpha', 'beta'])
  })

  test('a same-workspace wiki URL link resolves a backlink', async () => {
    const target = await createPage('Handbook', 'contents')
    await createPage('Gamma', `[link](/wiki/${target.slug})`)

    const res = await fetchNativeApi(`http://localhost/api/wiki/${target.slug}/backlinks`, {
      headers: authHeaders(token, slug),
    })
    const backlinks = await readNativeJson(res, SlugListResponse)
    expect(backlinks.map((b) => b.slug)).toStrictEqual(['gamma'])
  })

  test("covers PROJ-517/512: a multi-segment /wiki/ URL is never indexed against the first segment's page", async () => {
    const operations = await createPage('Operations', 'contents')
    await createPage('Runbook', `[Runbook](/wiki/${operations.slug}/admin-allow-list)`)

    const res = await fetchNativeApi(`http://localhost/api/wiki/${operations.slug}/backlinks`, {
      headers: authHeaders(token, slug),
    })
    const backlinks = await readNativeJson(res, SlugListResponse)
    expect(backlinks).toStrictEqual([])
  })

  test('an absolute cross-host URL is never indexed as a same-workspace link', async () => {
    const target = await createPage('Epsilon', 'contents')
    await createPage(
      'Zeta',
      `[external](https://example.com/wiki/${target.slug}) and [also](//other-host/wiki/${target.slug})`,
    )

    const res = await fetchNativeApi(`http://localhost/api/wiki/${target.slug}/backlinks`, {
      headers: authHeaders(token, slug),
    })
    const backlinks = await readNativeJson(res, SlugListResponse)
    expect(backlinks).toStrictEqual([])
  })

  test("covers PROJ-510: a malformed %-escape in a link URL doesn't crash the write; other links still index", async () => {
    const runbook = await createPage('Runbook Eta', 'how to page')
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: 'see [[Runbook Eta]] and [bad](/wiki?slug=100%) for details',
        title: 'Theta',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)

    const backlinksRes = await fetchNativeApi(`http://localhost/api/wiki/${runbook.slug}/backlinks`, {
      headers: authHeaders(token, slug),
    })
    const backlinks = await readNativeJson(backlinksRes, SlugListResponse)
    expect(backlinks.map((b) => b.slug)).toStrictEqual(['theta'])
  })

  test('an unresolved [[Target]] is stored as a broken link, not a backlink', async () => {
    await createPage('Delta', 'see [[Nonexistent Page]] for details')

    const brokenRes = await fetchNativeApi('http://localhost/api/wiki/broken-links', {
      headers: authHeaders(token, slug),
    })
    const broken = await readNativeJson(
      brokenRes,
      Schema.Array(Schema.Struct({ sourceSlug: Schema.String, targetTitle: Schema.String })).pipe(Schema.mutable),
    )
    expect(broken).toContainEqual(expect.objectContaining({ sourceSlug: 'delta', targetTitle: 'Nonexistent Page' }))
  })

  test('get_backlinks (MCP) returns the same result as REST', async () => {
    const fixture = await seedFixture()
    const target = await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(fixture.token, fixture.workspace.slug),
        JSON.stringify({ content: 'x', title: 'MCP Target' }),
      ),
    ).then((response) => response.json() as Promise<{ slug: string }>)
    await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(fixture.token, fixture.workspace.slug),
        JSON.stringify({ content: '[[MCP Target]]', title: 'MCP Source' }),
      ),
    )

    const result = await mcpCall<{ content: { text: string }[] }>(
      fixture.workspace.id,
      'get_backlinks',
      { slug: target.slug },
      authHeaders(fixture.token, fixture.workspace.slug),
    )
    const backlinks = mcpData(result, SlugListResponse)
    expect(backlinks).toStrictEqual([expect.objectContaining({ slug: 'mcp-source' })])
  })

  test('list_broken_wiki_links (MCP) matches REST', async () => {
    const fixture = await seedFixture()
    await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(fixture.token, fixture.workspace.slug),
        JSON.stringify({ content: '[[Missing Target]]', title: 'Epsilon' }),
      ),
    )

    const result = await mcpCall<{ content: { text: string }[] }>(
      fixture.workspace.id,
      'list_broken_wiki_links',
      {},
      authHeaders(fixture.token, fixture.workspace.slug),
    )
    const broken = mcpData(result, Schema.Array(Schema.Struct({ targetTitle: Schema.String })).pipe(Schema.mutable))
    expect(broken).toContainEqual(expect.objectContaining({ targetTitle: 'Missing Target' }))
  })

  test("renaming the target page's slug doesn't break an existing backlink (id-backed)", async () => {
    const target = await createPage('Original Name', 'content')
    await createPage('Linker', 'see [[Original Name]]')

    await fetchNativeApi(`http://localhost/api/wiki/${target.slug}`, {
      body: JSON.stringify({ slug: 'renamed-slug' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/renamed-slug/backlinks', {
      headers: authHeaders(token, slug),
    })
    const backlinks = await readNativeJson(res, SlugListResponse)
    expect(backlinks.map((b) => b.slug)).toStrictEqual(['linker'])
  })

  test('editing content to remove a link removes the backlink; a new link adds one', async () => {
    const target = await createPage('Stable Target', 'x')
    const linker = await createPage('Changing Source', 'see [[Stable Target]]')

    let res = await fetchNativeApi(`http://localhost/api/wiki/${target.slug}/backlinks`, {
      headers: authHeaders(token, slug),
    })
    expect((await res.json()) as unknown[]).toHaveLength(1)

    await fetchNativeApi(`http://localhost/api/wiki/${linker.slug}`, {
      body: JSON.stringify({ content: 'no more links here' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })

    res = await fetchNativeApi(`http://localhost/api/wiki/${target.slug}/backlinks`, {
      headers: authHeaders(token, slug),
    })
    await expect(res.json()).resolves.toStrictEqual([])
  })

  test('a title-only update (no content change) leaves the link graph untouched', async () => {
    const target = await createPage('Untouched Target', 'x')
    const linker = await createPage('Title Change Source', 'see [[Untouched Target]]')

    await fetchNativeApi(`http://localhost/api/wiki/${linker.slug}`, {
      body: JSON.stringify({ title: 'Renamed Title Only' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })

    const res = await fetchNativeApi(`http://localhost/api/wiki/${target.slug}/backlinks`, {
      headers: authHeaders(token, slug),
    })
    const backlinks = await readNativeJson(res, SlugListResponse)
    expect(backlinks.map((b) => b.slug)).toStrictEqual(['title-change-source'])
  })

  test('handles DELETE surfaces linkedByCount as a non-blocking warning and still deletes the page', async () => {
    const owner = await seedFixture({ role: 'owner' })
    const target = await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(owner.token, owner.workspace.slug),
        JSON.stringify({ content: 'x', title: 'Linked Target' }),
      ),
    ).then((response) => response.json() as Promise<{ slug: string }>)
    await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(owner.token, owner.workspace.slug),
        JSON.stringify({ content: '[[Linked Target]]', title: 'Linker One' }),
      ),
    )

    const res = await fetchNativeApi(`http://localhost/api/wiki/${target.slug}`, {
      headers: authHeaders(owner.token, owner.workspace.slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(res, Schema.Struct({ linkedByCount: Schema.Number, ok: Schema.Boolean }))
    expect(body.linkedByCount).toBe(1)

    const getRes = await fetchNativeApi(`http://localhost/api/wiki/${target.slug}`, {
      headers: authHeaders(owner.token, owner.workspace.slug),
    })
    expect(getRes.status).toBe(404)

    /*
     * The now-deleted target turns the surviving linker's outgoing link into a broken
     * link (target_page_id set null) rather than silently vanishing.
     */
    const brokenRes = await fetchNativeApi('http://localhost/api/wiki/broken-links', {
      headers: authHeaders(owner.token, owner.workspace.slug),
    })
    const broken = await readNativeJson(
      brokenRes,
      Schema.Array(Schema.Struct({ targetTitle: Schema.String })).pipe(Schema.mutable),
    )
    expect(broken).toContainEqual(expect.objectContaining({ targetTitle: 'Linked Target' }))
  })

  test('cascade-deleting a subtree cleans up outgoing links for every deleted page', async () => {
    const owner = await seedFixture({ role: 'owner' })
    const parentRes = await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(owner.token, owner.workspace.slug),
        JSON.stringify({ content: '[[Nonexistent A]]', title: 'Cascade Parent' }),
      ),
    )
    const parent = await readNativeJson(parentRes, IdAndSlugResponse)
    await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(owner.token, owner.workspace.slug),
        JSON.stringify({
          title: 'Cascade Child',
          content: '[[Nonexistent B]]',
          parentId: parent.id,
        }),
      ),
    )

    await fetchNativeApi(`http://localhost/api/wiki/${parent.slug}?cascade=true`, {
      headers: authHeaders(owner.token, owner.workspace.slug),
      method: 'DELETE',
    })

    const brokenRes = await fetchNativeApi('http://localhost/api/wiki/broken-links', {
      headers: authHeaders(owner.token, owner.workspace.slug),
    })
    const broken = await readNativeJson(
      brokenRes,
      Schema.Array(Schema.Struct({ targetTitle: Schema.String })).pipe(Schema.mutable),
    )
    expect(broken.some((b) => b.targetTitle === 'Nonexistent A')).toBe(false)
    expect(broken.some((b) => b.targetTitle === 'Nonexistent B')).toBe(false)
  })

  test('backlinks and broken links never cross workspace boundaries', async () => {
    const workspaceA = await seedFixture()
    const workspaceB = await seedFixture()

    await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(workspaceA.token, workspaceA.workspace.slug),
        JSON.stringify({ content: 'x', title: 'Shared Title' }),
      ),
    )
    await fetchNativeApi(
      'http://localhost/api/wiki',
      requestOptionsWithBody(
        'POST',
        authHeaders(workspaceB.token, workspaceB.workspace.slug),
        JSON.stringify({ content: 'see [[Shared Title]]', title: 'B Source' }),
      ),
    )

    /*
     * Workspace B's link can only resolve against workspace B's own pages, so it's
     * unresolved there (no "Shared Title" page exists in B) — never leaking a match
     * against workspace A's page of the same title.
     */
    const brokenB = await fetchNativeApi('http://localhost/api/wiki/broken-links', {
      headers: authHeaders(workspaceB.token, workspaceB.workspace.slug),
    })
    expect(((await brokenB.json()) as { targetTitle: string }[]).some((b) => b.targetTitle === 'Shared Title')).toBe(
      true,
    )

    const sharedA = await fetchNativeApi('http://localhost/api/wiki/shared-title', {
      headers: authHeaders(workspaceA.token, workspaceA.workspace.slug),
    })
    const target = await readNativeJson(sharedA, IdResponse)
    const backlinksA = await fetchNativeApi(`http://localhost/api/wiki/${target.id}/backlinks`, {
      headers: authHeaders(workspaceA.token, workspaceA.workspace.slug),
    })
    await expect(backlinksA.json()).resolves.toStrictEqual([])
  })

  test('backfill_wiki_links (MCP, owner-only) recomputes links for pre-existing content', async () => {
    const owner = await seedFixture({ role: 'owner' })
    /*
     * Seed pages directly at the DB layer, bypassing reindexWikiLinks, to simulate
     * pre-PROJ-485 content that predates the link graph.
     */
    const now = currentEpochSeconds()
    await env.DB.prepare(
      'INSERT INTO wiki_pages (id, workspace_id, slug, title, content, created_by_id, ' +
        'updated_by_id, created_at, updated_at) ' +
        "VALUES ('legacy-target', ?, 'legacy-target', 'Legacy Target', 'x', ?, ?, ?, ?)",
    )
      .bind(owner.workspace.id, owner.user.id, owner.user.id, now, now)
      .run()
    await env.DB.prepare(
      'INSERT INTO wiki_pages (id, workspace_id, slug, title, content, created_by_id, ' +
        'updated_by_id, created_at, updated_at) ' +
        "VALUES ('legacy-source', ?, 'legacy-source', 'Legacy Source', '[[Legacy Target]]', ?, ?, ?, ?)",
    )
      .bind(owner.workspace.id, owner.user.id, owner.user.id, now, now)
      .run()

    const preBacklinks = await fetchNativeApi('http://localhost/api/wiki/legacy-target/backlinks', {
      headers: authHeaders(owner.token, owner.workspace.slug),
    })
    await expect(preBacklinks.json()).resolves.toStrictEqual([])

    const result = await mcpCall<{ content: { text: string }[] }>(
      owner.workspace.id,
      'backfill_wiki_links',
      {},
      authHeaders(owner.token, owner.workspace.slug),
    )
    const backfillResult = mcpData(result, Schema.Struct({ pagesProcessed: Schema.Number }))
    expect(backfillResult.pagesProcessed).toBeGreaterThanOrEqual(2)

    const postBacklinks = await fetchNativeApi('http://localhost/api/wiki/legacy-target/backlinks', {
      headers: authHeaders(owner.token, owner.workspace.slug),
    })
    const backlinks = await readNativeJson(postBacklinks, SlugListResponse)
    expect(backlinks.map((b) => b.slug)).toStrictEqual(['legacy-source'])
  })

  test('backfill_wiki_links is rejected for a non-admin member', async () => {
    const member = await seedFixture({ role: 'member' })
    const result = await mcpCall(
      member.workspace.id,
      'backfill_wiki_links',
      {},
      authHeaders(member.token, member.workspace.slug),
    )
    expect(isMcpError(result)).toBe(false)
    expect(toolError(result)?.code).toBe('forbidden')
  })
})

describe('wiki write atomicity (PROJ-511)', () => {
  type TestData = Readonly<{
    slug: string
    token: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedFixture()
    const token = fixture.token
    const slug = fixture.workspace.slug
    return { slug, token }
  }

  test("a slug race during create leaves wiki_links with only the winner's link, never a partial write", async () => {
    const { slug, token } = await seedTestData()
    // createWikiPage's assertSlugAvailable-then-insert isn't atomic (services/wiki.ts):
    // two concurrent creates with the same title/slug can both pass the availability
    // check, so one loses to a UNIQUE constraint failure inside the ctx.db.batch() call
    // itself. PROJ-511 batches the page insert, its wiki_fts row, and its wiki_links
    // rows together, so the loser's batch must fail as a whole — never leaving a
    // dangling wiki_links row for a page insert that didn't happen.
    const [resA, resB] = await Promise.all([
      fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({
          content: 'see [[Race Target Alpha]]',
          title: 'Atomicity Race Page',
        }),
        headers: authHeaders(token, slug),
        method: 'POST',
      }),
      fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({ content: 'see [[Race Target Beta]]', title: 'Atomicity Race Page' }),
        headers: authHeaders(token, slug),
        method: 'POST',
      }),
    ])
    const statuses = [resA.status, resB.status].toSorted((left, right) =>
      globalThis.String(left) < globalThis.String(right)
        ? -1
        : globalThis.String(left) > globalThis.String(right)
          ? 1
          : 0,
    )
    expect(statuses).toStrictEqual([201, 409])

    const brokenRes = await fetchNativeApi('http://localhost/api/wiki/broken-links', {
      headers: authHeaders(token, slug),
    })
    const broken = await readNativeJson(
      brokenRes,
      Schema.Array(Schema.Struct({ targetTitle: Schema.String })).pipe(Schema.mutable),
    )
    expect(broken).toHaveLength(1)
    expect(['Race Target Alpha', 'Race Target Beta']).toContain(broken[0].targetTitle)
  })

  test("a failed rename (slug conflict) leaves the page's content, wiki_links, and wiki_fts untouched", async () => {
    const { slug, token } = await seedTestData()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'how to page', title: 'Atomic Runbook' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'x', title: 'Atomic Existing' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const sourceRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'see [[Atomic Runbook]]', title: 'Atomic Source' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const source = await readNativeJson(sourceRes, SlugResponse)

    await resetRateLimits()
    const updateRes = await fetchNativeApi(`http://localhost/api/wiki/${source.slug}`, {
      body: JSON.stringify({ content: 'no longer links anywhere', slug: 'atomic-existing' }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })
    expect(updateRes.status).toBe(409)

    await resetRateLimits()
    const pageRes = await fetchNativeApi(`http://localhost/api/wiki/${source.slug}`, {
      headers: authHeaders(token, slug),
    })
    await expect(pageRes.json()).resolves.toStrictEqual(expect.objectContaining({ content: 'see [[Atomic Runbook]]' }))

    await resetRateLimits()
    const backlinksRes = await fetchNativeApi('http://localhost/api/wiki/atomic-runbook/backlinks', {
      headers: authHeaders(token, slug),
    })
    const backlinks = await readNativeJson(backlinksRes, SlugListResponse)
    expect(backlinks.map((b) => b.slug)).toStrictEqual(['atomic-source'])

    await resetRateLimits()
    const searchRes = await fetchNativeApi('http://localhost/api/wiki/search?q=links+anywhere', {
      headers: authHeaders(token, slug),
    })
    await expect(searchRes.json()).resolves.toStrictEqual([])
  })
})

// PROJ-489 (R7): verification stamps + computed staleness surfacing.
describe('computeFreshness (PROJ-489)', () => {
  test('returns null when the page has neither verify_interval nor status', () => {
    expect(computeFreshness({ verifiedAt: null, verifyInterval: null, status: null })).toBeNull()
  })

  test("returns 'unverified' when verify_interval is set but verified_at is null", () => {
    expect(computeFreshness({ verifiedAt: null, verifyInterval: 30, status: null, now: 1_000_000 })).toStrictEqual({
      staleSince: null,
      state: 'unverified',
    })
  })

  test("returns 'fresh' when verify_interval hasn't elapsed since verified_at", () => {
    const now = 1_000_000
    const verifiedAt = now - 10 * 86_400 // 10 days ago
    expect(computeFreshness({ verifiedAt, verifyInterval: 30, status: null, now })).toStrictEqual({
      staleSince: null,
      state: 'fresh',
    })
  })

  test("returns 'stale' with staleSince once verify_interval has elapsed since verified_at", () => {
    const now = 1_000_000
    const verifiedAt = now - 40 * 86_400 // 40 days ago
    const dueAt = verifiedAt + 30 * 86_400
    expect(computeFreshness({ verifiedAt, verifyInterval: 30, status: null, now })).toStrictEqual({
      staleSince: dueAt,
      state: 'stale',
    })
  })

  test('treats an explicit status: stale as stale regardless of verify_interval', () => {
    expect(computeFreshness({ verifiedAt: null, verifyInterval: null, status: 'stale', now: 1_000_000 })).toStrictEqual(
      {
        staleSince: null,
        state: 'stale',
      },
    )
  })

  test("treats an explicit status: deprecated as stale even when verify_interval hasn't elapsed yet", () => {
    const now = 1_000_000
    const verifiedAt = now - 1 * 86_400 // Verified yesterday
    expect(computeFreshness({ verifiedAt, verifyInterval: 365, status: 'deprecated', now })).toStrictEqual({
      staleSince: null,
      state: 'stale',
    })
  })

  test('treats status: current with no verify_interval as fresh', () => {
    expect(
      computeFreshness({
        verifiedAt: null,
        verifyInterval: null,
        status: 'current',
        now: 1_000_000,
      }),
    ).toStrictEqual({ staleSince: null, state: 'fresh' })
  })
})

describe('wiki freshness model (PROJ-489)', () => {
  type TestData = Readonly<{
    slug: string
    token: string
    userEmail: string
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedFixture()
    const token = fixture.token
    const slug = fixture.workspace.slug
    const workspaceId = fixture.workspace.id
    const userEmail = fixture.user.email
    return { slug, token, userEmail, workspaceId }
  }

  const today = (): string => new Date().toISOString().slice(0, 10)

  const overdueContent = function overdueContent(intervalDays = 30): string {
    return ['---', `verify_interval: ${intervalDays}`, 'verified_at: 2020-01-01', '---', '# Overdue page'].join('\n')
  }

  const freshContent = function freshContent(intervalDays = 365): string {
    return ['---', `verify_interval: ${intervalDays}`, `verified_at: ${today()}`, '---', '# Fresh page'].join('\n')
  }

  const unverifiedContent = function unverifiedContent(intervalDays = 30): string {
    return ['---', `verify_interval: ${intervalDays}`, '---', '# Never verified page'].join('\n')
  }

  const explicitStatusContent = function explicitStatusContent(status: 'stale' | 'deprecated'): string {
    return ['---', `status: ${status}`, '---', '# Explicitly flagged page'].join('\n')
  }

  test('covers REST GET /api/wiki/:slug returns computed freshness in the page header', async () => {
    const { slug, token } = await seedTestData()
    const createRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Overdue Runbook', content: overdueContent() }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const created = await readNativeJson(createRes, SlugResponse)

    const res = await fetchNativeApi(`http://localhost/api/wiki/${created.slug}`, {
      headers: authHeaders(token, slug),
    })
    const pageShape = Schema.Struct({
      freshness: Schema.Struct({ staleSince: Schema.Union([Schema.Number, Schema.Null]), state: Schema.String }),
    })
    const page = await readNativeJson(res, pageShape)
    expect(page.freshness.state).toBe('stale')
    expect(page.freshness.staleSince).not.toBeNull()
  })

  test("covers REST POST /api/wiki/:slug/verify stamps verified_at/verified_by using the CALLING user's identity", async () => {
    const { slug, token, userEmail } = await seedTestData()
    const createRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Needs Verification', content: overdueContent() }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const created = await readNativeJson(createRes, SlugResponse)

    const verifyRes = await fetchNativeApi(`http://localhost/api/wiki/${created.slug}/verify`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(verifyRes.status).toBe(200)
    const verified = await readNativeJson(
      verifyRes,
      Schema.Struct({
        freshness: Schema.Struct({ state: Schema.String }),
        verifiedAt: Schema.Number,
        verifiedBy: Schema.String,
      }),
    )
    expect(verified.verifiedBy).toBe(userEmail)
    // The page was overdue (verified_at 2020-01-01); verifying it now resets the clock.
    expect(verified.freshness.state).toBe('fresh')

    /*
     * The stamp is written into the page's frontmatter (not just the denormalized
     * columns), so a subsequent read reflects it without needing an unrelated edit.
     */
    const pageRes = await fetchNativeApi(`http://localhost/api/wiki/${created.slug}`, {
      headers: authHeaders(token, slug),
    })
    const page = await readNativeJson(pageRes, Schema.Struct({ content: Schema.String, verified_by: Schema.String }))
    expect(page.verified_by).toBe(userEmail)
    expect(page.content).toContain(`verified_by: ${userEmail}`)
  })

  test('verify_wiki_page records a revision, same as any other content edit', async () => {
    const { slug, token } = await seedTestData()
    const createRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Revision Check', content: overdueContent() }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const created = await readNativeJson(createRes, SlugResponse)

    const before = await fetchNativeApi(`http://localhost/api/wiki/${created.slug}/revisions`, {
      headers: authHeaders(token, slug),
    })
    const beforeRevisions = await readNativeJson(before, JsonListResponse)

    await fetchNativeApi(`http://localhost/api/wiki/${created.slug}/verify`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const after = await fetchNativeApi(`http://localhost/api/wiki/${created.slug}/revisions`, {
      headers: authHeaders(token, slug),
    })
    const afterRevisions = await readNativeJson(after, JsonListResponse)
    expect(afterRevisions).toHaveLength(beforeRevisions.length + 1)
  })

  /*
   * PROJ-489: verifying rewrites the whole content (frontmatter stamp + body), so it must
   * stamp the CURRENT content — a stale read would silently revert the edit before it.
   */
  test('handles POST /api/wiki/:slug/verify stamps on top of the latest content, never a stale snapshot', async () => {
    const { slug, token, userEmail } = await seedTestData()
    const createRes = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Edited Then Verified', content: overdueContent() }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const created = await readNativeJson(createRes, SlugResponse)

    await fetchNativeApi(`http://localhost/api/wiki/${created.slug}`, {
      body: JSON.stringify({ content: `${overdueContent()}\n\nBrand new paragraph.` }),
      headers: authHeaders(token, slug),
      method: 'PUT',
    })

    await fetchNativeApi(`http://localhost/api/wiki/${created.slug}/verify`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const pageRes = await fetchNativeApi(`http://localhost/api/wiki/${created.slug}`, {
      headers: authHeaders(token, slug),
    })
    const page = await readNativeJson(pageRes, Schema.Struct({ content: Schema.String, verified_by: Schema.String }))
    expect(page.content).toContain('Brand new paragraph.')
    expect(page.verified_by).toBe(userEmail)
  })

  test('handles POST /api/wiki/:slug/verify is rejected for a viewer', async () => {
    await seedTestData()
    const roles = await seedWorkspaceRoles()
    const requestOptions = requestOptionsWithBody(
      'POST',
      authHeaders(roles.owner.token, roles.workspace.slug),
      JSON.stringify({ title: 'Viewer Guard', content: overdueContent() }),
    )
    const createRes = await fetchNativeApi('http://localhost/api/wiki', requestOptions)
    const created = await readNativeJson(createRes, SlugResponse)

    const res = await fetchNativeApi(`http://localhost/api/wiki/${created.slug}/verify`, {
      headers: authHeaders(roles.viewer.token, roles.workspace.slug),
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })

  test('covers MCP verify_wiki_page stamps verified_at/verified_by, parity with REST', async () => {
    const { slug, token, userEmail, workspaceId } = await seedTestData()
    const created = mcpData(
      await mcpCall(
        workspaceId,
        'create_wiki_page',
        { title: 'MCP Verify Target', content: overdueContent() },
        authHeaders(token, slug),
      ),
      SlugResponse,
    )

    const result = mcpData(
      await mcpCall(workspaceId, 'verify_wiki_page', { slug: created.slug }, authHeaders(token, slug)),
      Schema.Struct({ freshness: Schema.Struct({ state: Schema.String }), verifiedBy: Schema.String }),
    )
    expect(result.verifiedBy).toBe(userEmail)
    expect(result.freshness.state).toBe('fresh')
  })

  test('handles GET /api/wiki/search demotes a computed-stale page below a fresh page matching the same query', async () => {
    const { slug, token } = await seedTestData()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        title: 'Stale Deploy Guide',
        content: `${overdueContent()}\ndeploy keyword`,
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        title: 'Fresh Deploy Guide',
        content: `${freshContent()}\ndeploy keyword`,
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/search?q=deploy', {
      headers: authHeaders(token, slug),
    })
    const resultsShape = Schema.Array(
      Schema.Struct({
        freshness: Schema.Union([Schema.Struct({ state: Schema.String }), Schema.Null]),
        title: Schema.String,
      }),
    ).pipe(Schema.mutable)
    const results = await readNativeJson(res, resultsShape)
    expect(results.map((result) => result.title)).toStrictEqual(['Fresh Deploy Guide', 'Stale Deploy Guide'])
    expect(results[0].freshness?.state).toBe('fresh')
    expect(results[1].freshness?.state).toBe('stale')
  })

  test('handles GET /api/wiki/search demotes an explicitly status: deprecated page too', async () => {
    const { slug, token } = await seedTestData()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        title: 'Deprecated Onboarding',
        content: `${explicitStatusContent('deprecated')}\nonboardingkeyword`,
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'onboardingkeyword', title: 'Current Onboarding' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/search?q=onboardingkeyword', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(res, TitleListResponse)
    expect(results.map((result) => result.title)).toStrictEqual(['Current Onboarding', 'Deprecated Onboarding'])
  })

  /*
   * PROJ-515: decided to NOT demote "unverified" (verify_interval declared, never
   * verified) in search ranking — only in list_stale_pages (the maintenance queue).
   * A freshly authored page that opts into verification tracking shouldn't rank worse
   * than a legacy page with no frontmatter at all just for declaring an interval.
   */
  test('handles GET /api/wiki/search does NOT demote an unverified page below a page with no freshness signal', async () => {
    const { slug, token } = await seedTestData()
    /*
     * If "unverified" were still in the demotion tier, this page would sort AFTER
     * "No Signal" below regardless of relevance, the same way a stale/deprecated page
     * is forced below a fresh one in the tests above. Giving it the stronger (title)
     * match proves the opposite: bm25 alone decides the order now.
     */
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        title: 'Securitypolicykeyword Runbook',
        content: unverifiedContent(),
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: 'buried mention of securitypolicykeyword in the body',
        title: 'No Signal Page',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/search?q=securitypolicykeyword', {
      headers: authHeaders(token, slug),
    })
    const resultsShape = Schema.Array(
      Schema.Struct({
        freshness: Schema.Union([Schema.Struct({ state: Schema.String }), Schema.Null]),
        title: Schema.String,
      }),
    ).pipe(Schema.mutable)
    const results = await readNativeJson(res, resultsShape)
    expect(results.map((result) => result.title)).toStrictEqual(['Securitypolicykeyword Runbook', 'No Signal Page'])
    expect(results[0].freshness?.state).toBe('unverified')
  })

  test('handles GET /api/wiki/stale-pages lists computed-stale, unverified, deprecated pages, excluding fresh', async () => {
    const { slug, token } = await seedTestData()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Overdue Page', content: overdueContent() }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Never Verified Page', content: unverifiedContent() }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        title: 'Explicitly Stale Page',
        content: explicitStatusContent('stale'),
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ title: 'Fresh Page', content: freshContent() }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: 'plain markdown', title: 'No Signal Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    // PROJ-489: 5 creates already used up this token's test-env rate limit
    // (vite.config.ts RATE_LIMIT_API_MAX=5) — reset before the read below.
    await resetRateLimits()
    const res = await fetchNativeApi('http://localhost/api/wiki/stale-pages', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const results = await readNativeJson(res, TitleListResponse)
    const titles = results.map((result) => result.title).sort()
    expect(titles).toStrictEqual(['Explicitly Stale Page', 'Never Verified Page', 'Overdue Page'])
  })

  test('covers MCP list_stale_pages returns the same result shape as REST', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    await mcpCall(
      workspaceId,
      'create_wiki_page',
      { title: 'MCP Overdue Page', content: overdueContent() },
      authHeaders(token, slug),
    )
    await mcpCall(
      workspaceId,
      'create_wiki_page',
      { title: 'MCP Fresh Page', content: freshContent() },
      authHeaders(token, slug),
    )

    const result = mcpData(
      await mcpCall(workspaceId, 'list_stale_pages', {}, authHeaders(token, slug)),
      TitleListResponse,
    )
    expect(result.map((r) => r.title)).toContain('MCP Overdue Page')
    expect(result.map((r) => r.title)).not.toContain('MCP Fresh Page')
  })
})

/*
 * PROJ-491 (R9): workspace-level page templates — `template: true` frontmatter,
 * create_wiki_page's templateSlug, and the list_wiki_templates picker. REST/MCP parity
 * throughout, same as the other frontmatter-driven features above.
 */
describe('wiki page templates (PROJ-491)', () => {
  const TEMPLATE_CONTENT = [
    '---',
    'type: runbook',
    'status: draft',
    'template: true',
    '---',
    '# Runbook: [Title]',
    '',
    '## Steps',
  ].join('\n')

  const seedScenarioFixture = async function seedScenarioFixture(): Promise<
    WikiWorkspaceFixture & { createTemplate: () => Promise<{ id: string; slug: string; isTemplate: boolean }> }
  > {
    const { token, slug, workspaceId }: WikiWorkspaceFixture = await seedWorkspaceFixture()

    const createTemplate = async function createTemplate(): Promise<{ id: string; slug: string; isTemplate: boolean }> {
      const res = await fetchNativeApi('http://localhost/api/wiki', {
        body: JSON.stringify({ content: TEMPLATE_CONTENT, title: 'Runbook Template' }),
        headers: authHeaders(token, slug),
        method: 'POST',
      })
      expect(res.status).toBe(201)
      return readNativeJson(res, Schema.Struct({ id: Schema.String, isTemplate: Schema.Boolean, slug: Schema.String }))
    }
    return { createTemplate, slug, token, workspaceId }
  }

  test('covers REST: frontmatter template:true denormalizes into isTemplate on create', async () => {
    const { createTemplate, slug, token } = await seedScenarioFixture()
    const created = await createTemplate()
    expect(created.isTemplate).toBe(true)

    const getRes = await fetchNativeApi(`http://localhost/api/wiki/${created.slug}`, {
      headers: authHeaders(token, slug),
    })
    const page = await readNativeJson(getRes, Schema.Struct({ is_template: Schema.Boolean }))
    expect(page.is_template).toBe(true)
  })

  test('covers REST: create_wiki_page with templateSlug seeds content and strips template:true', async () => {
    const { createTemplate, slug, token } = await seedScenarioFixture()
    await createTemplate()

    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ templateSlug: 'runbook-template', title: 'Deploy Runbook' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const created = await readNativeJson(
      res,
      Schema.Struct({ isTemplate: Schema.Boolean, slug: Schema.String, type: Schema.String }),
    )
    /*
     * The seeded page keeps the template's other frontmatter (type) but is not itself
     * a template — only the `template` key is stripped.
     */
    expect(created).toMatchObject({ isTemplate: false, type: 'runbook' })

    const getRes = await fetchNativeApi(`http://localhost/api/wiki/${created.slug}`, {
      headers: authHeaders(token, slug),
    })
    const page = await readNativeJson(getRes, Schema.Struct({ content: Schema.String, is_template: Schema.Boolean }))
    expect(page.content).toContain('## Steps')
    expect(page.content).not.toContain('template: true')
    expect(page.is_template).toBe(false)
  })

  test('covers MCP: create_wiki_page with templateSlug has parity with REST', async () => {
    const { createTemplate, slug, token, workspaceId } = await seedScenarioFixture()
    await createTemplate()

    const result = mcpData(
      await mcpCall(
        workspaceId,
        'create_wiki_page',
        { templateSlug: 'runbook-template', title: 'MCP Deploy Runbook' },
        authHeaders(token, slug),
      ),
      Schema.Struct({ isTemplate: Schema.Boolean, type: Schema.String }),
    )
    expect(result.isTemplate).toBe(false)
    expect(result.type).toBe('runbook')
  })

  test('rejects templateSlug that does not resolve to any page (not a silent blank fallback)', async () => {
    const { slug, token } = await seedScenarioFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ templateSlug: 'does-not-exist', title: 'Orphan Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test("rejects templateSlug pointing at a page that isn't flagged template:true", async () => {
    const { slug, token } = await seedScenarioFixture()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '# Just a page', title: 'Ordinary Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ templateSlug: 'ordinary-page', title: 'Bad Seed' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('rejects content and templateSlug provided together', async () => {
    const { createTemplate, slug, token } = await seedScenarioFixture()
    await createTemplate()

    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({
        content: 'some content',
        templateSlug: 'runbook-template',
        title: 'Ambiguous Page',
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('search_wiki excludes template pages by default', async () => {
    const { createTemplate, slug, token } = await seedScenarioFixture()
    await createTemplate()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '# Runbook body content', title: 'Runbook For Deploys' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/search?q=Runbook', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(res, TitleListResponse)
    expect(results.map((result) => result.title)).toContain('Runbook For Deploys')
    expect(results.map((result) => result.title)).not.toContain('Runbook Template')
  })

  /*
   * PROJ-525: listWikiPages/GET /api/wiki previously had no is_template exclusion,
   * unlike search_wiki and listStaleWikiPages above — so a type=runbook filter listed
   * "Runbook Template" alongside real runbook pages.
   */
  test('handles GET /api/wiki excludes template pages by default, matching search_wiki/list_stale_pages', async () => {
    const { createTemplate, slug, token } = await seedScenarioFixture()
    await createTemplate()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '# Not a template', title: 'Ordinary Runbook' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const defaultRes = await fetchNativeApi('http://localhost/api/wiki', {
      headers: authHeaders(token, slug),
    })
    const defaultResults = await readNativeJson(defaultRes, TitleListResponse)
    expect(defaultResults.map((r) => r.title)).toContain('Ordinary Runbook')
    expect(defaultResults.map((r) => r.title)).not.toContain('Runbook Template')

    const includedRes = await fetchNativeApi('http://localhost/api/wiki?includeTemplates=true', {
      headers: authHeaders(token, slug),
    })
    const includedResults = await readNativeJson(includedRes, TitleListResponse)
    expect(includedResults.map((r) => r.title)).toContain('Runbook Template')
  })

  test('list_stale_pages excludes template pages even with an overdue verify_interval', async () => {
    const { slug, token } = await seedScenarioFixture()
    const overdueTemplateContent = [
      '---',
      'template: true',
      'verify_interval: 30',
      'verified_at: 2020-01-01',
      '---',
      '# Stale-looking template',
    ].join('\n')
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: overdueTemplateContent, title: 'Overdue Template' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/stale-pages', {
      headers: authHeaders(token, slug),
    })
    const results = await readNativeJson(res, TitleListResponse)
    expect(results.map((result) => result.title)).not.toContain('Overdue Template')
  })

  test('covers REST GET /api/wiki/templates lists only template-flagged pages', async () => {
    const { createTemplate, slug, token } = await seedScenarioFixture()
    await createTemplate()
    await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '# Not a template', title: 'Regular Page' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })

    const res = await fetchNativeApi('http://localhost/api/wiki/templates', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const results = await readNativeJson(res, TitleListResponse)
    expect(results.map((result) => result.title)).toStrictEqual(['Runbook Template'])
  })

  test("rejects a page slugged 'templates' — it would be shadowed by GET /api/wiki/templates", async () => {
    const { slug, token } = await seedScenarioFixture()
    const res = await fetchNativeApi('http://localhost/api/wiki', {
      body: JSON.stringify({ content: '', slug: 'templates', title: 'Templates' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  test('covers MCP list_wiki_templates has parity with REST', async () => {
    const { createTemplate, slug, token, workspaceId } = await seedScenarioFixture()
    await createTemplate()

    const result = mcpData(
      await mcpCall(workspaceId, 'list_wiki_templates', {}, authHeaders(token, slug)),
      TitleListResponse,
    )
    expect(result.map((r) => r.title)).toStrictEqual(['Runbook Template'])
  })
})

/*
 * PROJ-491 (R9): createWorkspace seeds the three built-in templates under a "Templates"
 * parent page — exercised against the real service (not the seedWorkspace test helper,
 * which bypasses createWorkspace entirely) so this only runs where it matters.
 */
describe('wiki built-in template seeding on workspace creation (PROJ-491)', () => {
  test('seeds a Templates parent page plus runbook/adr/spec templates', async () => {
    const fixture = await seedFixture({ role: 'owner' })
    const ownerHeaders = authHeaders(await seedUserToken(fixture.user.id), fixture.workspace.slug)
    const newSlug = `seed-test-${crypto.randomUUID().slice(0, 8)}`

    const created = mcpData(
      await mcpCall(fixture.workspace.id, 'create_workspace', { name: 'Seed Test', slug: newSlug }, ownerHeaders),
      IdAndSlugResponse,
    )

    const newToken = await seedToken(created.id, fixture.user.id)
    const newHeaders = authHeaders(newToken, created.slug)

    const listRes = await fetchNativeApi('http://localhost/api/wiki/templates', {
      headers: newHeaders,
    })
    expect(listRes.status).toBe(200)
    const templatesShape = Schema.Array(
      Schema.Struct({ title: Schema.String, type: Schema.Union([Schema.String, Schema.Null]) }),
    ).pipe(Schema.mutable)
    const templates = await readNativeJson(listRes, templatesShape)
    expect(templates.map((template) => template.title).sort()).toStrictEqual([
      'ADR Template',
      'Runbook Template',
      'Spec Template',
    ])

    const treeRes = await fetchNativeApi('http://localhost/api/wiki/tree', { headers: newHeaders })
    const treeShape = Schema.Array(
      Schema.Struct({
        children: Schema.Array(Schema.Unknown).pipe(Schema.mutable),
        slug: Schema.String,
        title: Schema.String,
      }),
    ).pipe(Schema.mutable)
    const tree = await readNativeJson(treeRes, treeShape)
    const templatesNode = tree.find((n) => n.title === 'Templates')
    expect(templatesNode?.children.length).toBe(3)

    /*
     * The seeded parent must stay reachable by slug: GET /api/wiki/templates is the
     * template-list endpoint, so a parent slugged "templates" would be shadowed by it
     * and the page would never render.
     */
    const parentRes = await fetchNativeApi(`http://localhost/api/wiki/${templatesNode?.slug}`, {
      headers: newHeaders,
    })
    expect(parentRes.status).toBe(200)
    expect(((await parentRes.json()) as { title: string }).title).toBe('Templates')
  })

  /*
   * PROJ-522: the seeded "Templates" parent is a real, non-template, browsable page —
   * unlike the three template pages under it (deliberately search-excluded) it needs a
   * wiki_fts mirror row like every other write path maintains, or it's invisible to
   * search_wiki until someone happens to edit it.
   */
  test('the seeded Templates parent page is findable via search_wiki', async () => {
    const fixture = await seedFixture({ role: 'owner' })
    const ownerHeaders = authHeaders(await seedUserToken(fixture.user.id), fixture.workspace.slug)
    const newSlug = `seed-fts-test-${crypto.randomUUID().slice(0, 8)}`

    const created = mcpData(
      await mcpCall(fixture.workspace.id, 'create_workspace', { name: 'Seed FTS Test', slug: newSlug }, ownerHeaders),
      IdAndSlugResponse,
    )
    const newToken = await seedToken(created.id, fixture.user.id)
    const newHeaders = authHeaders(newToken, created.slug)

    const searchRes = await fetchNativeApi('http://localhost/api/wiki/search?q=Templates', {
      headers: newHeaders,
    })
    expect(searchRes.status).toBe(200)
    const results = await readNativeJson(searchRes, TitleListResponse)
    expect(results.map((result) => result.title)).toContain('Templates')
  })
})

/*
 * PROJ-493 (R11): watch/unwatch per page or subtree, per-user notifications, and the
 * list_wiki_changes delta feed.
 */
describe('wiki watchers + list_wiki_changes (PROJ-493)', () => {
  let token: string
  let userId: string
  let slug: string
  let workspaceId: string

  beforeEach(async () => {
    /*
     * Admin: several tests (cascade delete, delta-delete) delete workspace-level
     * pages, which requireWikiDelete restricts to admin/owner.
     */
    const fixture = await seedFixture({ role: 'admin' })
    token = fixture.token
    userId = fixture.user.id
    slug = fixture.workspace.slug
    workspaceId = fixture.workspace.id
  })

  const req = async function req(url: string, opts?: RequestInit): Promise<Response> {
    return resetRateLimitAndFetch(url, opts)
  }

  const createPage = async function createPage(
    pageSlug: string,
    title: string,
    content = '',
  ): Promise<{ id: string; slug: string }> {
    const res = await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title, content, slug: pageSlug }),
    })
    expect(res.status).toBe(201)
    return readNativeJson(res, IdAndSlugResponse)
  }

  const createChildPage = async function createChildPage(
    pageSlug: string,
    title: string,
    content: string,
    parentId: string,
  ): Promise<{ id: string; slug: string }> {
    const res = await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title, content, slug: pageSlug, parentId }),
    })
    expect(res.status).toBe(201)
    return readNativeJson(res, IdAndSlugResponse)
  }

  const seedWatcher = async function seedWatcher(role = 'member') {
    const user = await seedUser(`watcher-${crypto.randomUUID().slice(0, 8)}@example.com`)
    await seedMember(workspaceId, user.id, role)
    const watcherToken = await seedToken(workspaceId, user.id)
    return { user, token: watcherToken }
  }

  const notifications = async function notifications(watcherToken: string, query = '') {
    const res = await req(`http://localhost/api/wiki/notifications${query}`, {
      headers: authHeaders(watcherToken, slug),
    })
    expect(res.status).toBe(200)
    return (await res.json()) as {
      id: string
      pageId: string
      slug: string
      title: string
      action: string
      actorId: string | null
    }[]
  }

  test('covers REST: watch/unwatch a page, watching again upserts the subtree flag instead of duplicating', async () => {
    const page = await createPage('watch-me', 'Watch Me', 'content')

    const watchRes = await req(`http://localhost/api/wiki/${page.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ subtree: false }),
    })
    expect(watchRes.status).toBe(200)

    let watches = (await (
      await req('http://localhost/api/wiki/watches', { headers: authHeaders(token, slug) })
    ).json()) as { pageId: string; subtree: boolean }[]
    const initial = watches.filter((watch) => watch.pageId === page.id)
    expect(initial).toHaveLength(1)
    expect(initial[0]).toMatchObject({ pageId: page.id, subtree: false })

    // Watching the same page again with a different subtree flag upserts, not duplicates.
    await req(`http://localhost/api/wiki/${page.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ subtree: true }),
    })
    watches = (await (
      await req('http://localhost/api/wiki/watches', { headers: authHeaders(token, slug) })
    ).json()) as { pageId: string; subtree: boolean }[]
    expect(watches.filter((watch) => watch.pageId === page.id)).toHaveLength(1)
    expect(watches.find((watch) => watch.pageId === page.id)?.subtree).toBe(true)

    const unwatchRes = await req(`http://localhost/api/wiki/${page.slug}/watch`, {
      method: 'DELETE',
      headers: authHeaders(token, slug),
    })
    expect(unwatchRes.status).toBe(200)
    watches = (await (
      await req('http://localhost/api/wiki/watches', { headers: authHeaders(token, slug) })
    ).json()) as { pageId: string; subtree: boolean }[]
    expect(watches.some((watch) => watch.pageId === page.id)).toBe(false)
  })

  test('a direct watcher is notified when someone else edits the page, never for their own edit', async () => {
    const page = await createPage('direct-watch', 'Direct Watch', 'content')
    const watcher = await seedWatcher()
    await req(`http://localhost/api/wiki/${page.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({}),
    })

    await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({ content: 'self edit' }),
    })
    await expect(notifications(watcher.token)).resolves.toStrictEqual([])

    await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'other edit' }),
    })
    const notifs = await notifications(watcher.token)
    expect(notifs).toHaveLength(1)
    expect(notifs[0]).toMatchObject({ action: 'updated', pageId: page.id, actorId: userId })
  })

  test('unwatching stops further notifications', async () => {
    const page = await createPage('unwatch-stop', 'Unwatch Stop', 'content')
    const watcher = await seedWatcher()
    await req(`http://localhost/api/wiki/${page.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({}),
    })
    await req(`http://localhost/api/wiki/${page.slug}/watch`, {
      method: 'DELETE',
      headers: authHeaders(watcher.token, slug),
    })
    await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'after unwatch' }),
    })
    await expect(notifications(watcher.token)).resolves.toStrictEqual([])
  })

  test('subtree watch covers a page created now under it AND a later edit to that descendant', async () => {
    const parent = await createPage('parent-page', 'Parent Page', 'content')
    const watcher = await seedWatcher()
    await req(`http://localhost/api/wiki/${parent.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({ subtree: true }),
    })

    const child = await createChildPage('child-page', 'Child Page', 'child', parent.id)
    let notifs = await notifications(watcher.token)
    expect(notifs.some((n) => n.action === 'created' && n.pageId === child.id)).toBe(true)

    await req(`http://localhost/api/wiki/${child.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'child v2' }),
    })
    notifs = await notifications(watcher.token)
    expect(notifs.filter((n) => n.pageId === child.id)).toHaveLength(2)
  })

  test("a direct-only (non-subtree) watch on the parent does NOT notify for a descendant's changes", async () => {
    const parent = await createPage('parent-narrow', 'Parent Narrow', 'content')
    const watcher = await seedWatcher()
    await req(`http://localhost/api/wiki/${parent.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({ subtree: false }),
    })
    await createChildPage('child-narrow', 'Child Narrow', 'child', parent.id)
    await expect(notifications(watcher.token)).resolves.toStrictEqual([])
  })

  test('template pages never generate watcher notifications', async () => {
    const page = await createPage('watch-template', 'Watch Template', '---\ntemplate: true\n---\nbody')
    const watcher = await seedWatcher()
    await req(`http://localhost/api/wiki/${page.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({}),
    })
    await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: '---\ntemplate: true\n---\nedited' }),
    })
    await expect(notifications(watcher.token)).resolves.toStrictEqual([])
  })

  test("a cascade delete generates a single 'deleted' notification for the root, not one per descendant", async () => {
    const parent = await createPage('cascade-parent', 'Cascade Parent', 'content')
    await createChildPage('cascade-child', 'Cascade Child', 'child', parent.id)
    const watcher = await seedWatcher()
    await req(`http://localhost/api/wiki/${parent.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({ subtree: true }),
    })

    const delRes = await req(`http://localhost/api/wiki/${parent.slug}?cascade=true`, {
      method: 'DELETE',
      headers: authHeaders(token, slug),
    })
    expect(delRes.status).toBe(200)

    const notifs = await notifications(watcher.token)
    const deleteNotifs = notifs.filter((n) => n.action === 'deleted')
    expect(deleteNotifs).toHaveLength(1)
    expect(deleteNotifs[0]).toMatchObject({ pageId: parent.id, slug: 'cascade-parent' })
  })

  test('a cascade delete notifies someone watching a DESCENDANT directly, and clears their watch row', async () => {
    const parent = await createPage('cascade-root', 'Cascade Root', 'content')
    const child = await createChildPage('cascade-kid', 'Cascade Kid', 'child', parent.id)
    const watcher = await seedWatcher()
    await req(`http://localhost/api/wiki/${child.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({}),
    })

    const delRes = await req(`http://localhost/api/wiki/${parent.slug}?cascade=true`, {
      method: 'DELETE',
      headers: authHeaders(token, slug),
    })
    expect(delRes.status).toBe(200)

    const deleteNotifs = (await notifications(watcher.token)).filter((n) => n.action === 'deleted')
    expect(deleteNotifs).toHaveLength(1)
    expect(deleteNotifs[0]).toMatchObject({ pageId: child.id, slug: 'cascade-kid' })

    /*
     * PROJ-496: the watch row itself is no longer cleared at delete time (that moved
     * to purge, along with R2/wiki_links/wiki_drafts cleanup) — but the trashed page
     * still drops out of the caller's watch LIST (listWikiWatches filters deleted_at).
     */
    const watchesRes = await req('http://localhost/api/wiki/watches', {
      headers: authHeaders(watcher.token, slug),
    })
    await expect(watchesRes.json()).resolves.toStrictEqual([])
    const stillThere = await env.DB.prepare('SELECT COUNT(*) AS c FROM wiki_watchers WHERE page_id = ?')
      .bind(child.id)
      .first<{ c: number }>()
    expect(stillThere?.c).toBe(1)
  })

  test('a cascade undelete notifies someone watching a DESCENDANT (PROJ-496: symmetric with cascade delete)', async () => {
    const parent = await createPage('cascade-restore-root', 'Cascade Restore Root', 'content')
    const child = await createChildPage('cascade-restore-kid', 'Cascade Restore Kid', 'child', parent.id)
    const watcher = await seedWatcher()
    await req(`http://localhost/api/wiki/${child.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({}),
    })

    const delRes = await req(`http://localhost/api/wiki/${parent.slug}?cascade=true`, {
      method: 'DELETE',
      headers: authHeaders(token, slug),
    })
    expect(delRes.status).toBe(200)

    const undeleteRes = await req(`http://localhost/api/wiki/trash/${parent.id}/undelete`, {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(undeleteRes.status).toBe(200)

    const restoreNotifs = (await notifications(watcher.token)).filter((n) => n.action === 'updated')
    expect(restoreNotifs).toHaveLength(1)
    expect(restoreNotifs[0]).toMatchObject({ pageId: child.id, slug: 'cascade-restore-kid' })
  })

  test('unreadOnly=false / watchedOnly=false are honored as false, not coerced true', async () => {
    const page = await createPage('bool-param', 'Bool Param', 'content')
    const watcher = await seedWatcher()
    await req(`http://localhost/api/wiki/${page.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({}),
    })
    const t0 = currentEpochSeconds() - 1
    await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2' }),
    })
    await req('http://localhost/api/wiki/notifications/read', {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({ all: true }),
    })

    expect(await notifications(watcher.token, '?unreadOnly=true')).toHaveLength(0)
    expect(await notifications(watcher.token, '?unreadOnly=false')).toHaveLength(1)

    // The watcher watches nothing but `page`; watchedOnly=false must not narrow.
    await createPage('bool-unwatched', 'Bool Unwatched', 'other')
    const res = await req(`http://localhost/api/wiki/changes?since=${t0}&watchedOnly=false`, {
      headers: authHeaders(watcher.token, slug),
    })
    const bodyShape = Schema.Struct({
      changes: Schema.Array(Schema.Struct({ slug: Schema.Union([Schema.String, Schema.Null]) })).pipe(Schema.mutable),
    })
    const body = await readNativeJson(res, bodyShape)
    expect(body.changes.map((change) => change.slug)).toContain('bool-unwatched')
  })

  test('mark_wiki_notifications_read: by explicit ids, then all:true', async () => {
    const page = await createPage('read-flag', 'Read Flag', 'content')
    const watcher = await seedWatcher()
    await req(`http://localhost/api/wiki/${page.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({}),
    })
    await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2' }),
    })
    await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v3' }),
    })

    const unread = await notifications(watcher.token, '?unreadOnly=true')
    expect(unread).toHaveLength(2)

    await req('http://localhost/api/wiki/notifications/read', {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({ ids: [unread[0].id] }),
    })
    expect(await notifications(watcher.token, '?unreadOnly=true')).toHaveLength(1)

    await req('http://localhost/api/wiki/notifications/read', {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({ all: true }),
    })
    expect(await notifications(watcher.token, '?unreadOnly=true')).toHaveLength(0)
  })

  test("list_wiki_changes: since is exclusive, nextSince advances, default scope isn't watched-only", async () => {
    const t0 = currentEpochSeconds() - 1
    const page = await createPage('delta-doc', 'Delta Doc', 'content')

    const res = await req(`http://localhost/api/wiki/changes?since=${t0}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const bodyShape = Schema.Struct({
      changes: Schema.Array(Schema.Struct({ action: Schema.String, pageId: Schema.String })).pipe(Schema.mutable),
      nextSince: Schema.Number,
    })
    const body = await readNativeJson(res, bodyShape)
    expect(body.changes.some((change) => change.pageId === page.id && change.action === 'created')).toBe(true)
    expect(body.nextSince).toBeGreaterThanOrEqual(t0)

    const empty = (await (
      await req(`http://localhost/api/wiki/changes?since=${body.nextSince}`, {
        headers: authHeaders(token, slug),
      })
    ).json()) as { changes: unknown[] }
    expect(empty.changes).toStrictEqual([])
  })

  /*
   * PROJ-869: list_wiki_changes used to select the full activity `diff` for EVERY row
   * (created/updated/deleted alike), even though only 'deleted' events read it — so a
   * batch of up to 500 rows could pull the full new content of every changed page out of
   * D1 into the Worker's memory. That never showed up in the HTTP response itself (a
   * WikiChangeEvent never serializes `diff`), so the regression test has to look at what
   * comes back from D1, not at the JSON sent to the client: it wraps ctx.db to record
   * every row D1 hands back during a real listWikiChanges call and asserts a
   * deliberately huge 'updated'-row diff never appears in any of them.
   */
  test("list_wiki_changes never pulls a non-deleted row's full diff out of D1 (PROJ-869)", async () => {
    const page = await createPage('delta-size', 'Delta Size', 'seed')
    const bigContent = 'x'.repeat(50_000)
    const t0 = currentEpochSeconds() - 1
    /*
     * Simulate an 'updated' activity row still carrying a large diff (either legacy
     * data predating the 0064 migration, or a future regression that reintroduces
     * storing full content) — the row-fetch guard must exclude it regardless of how it
     * got there.
     */
    await env.DB.prepare(
      `INSERT INTO activity (id, workspace_id, entity_type, entity_id, actor_id, action, diff, created_at)
			 VALUES (?, ?, 'wiki_page', ?, ?, 'updated', ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        workspaceId,
        page.id,
        userId,
        JSON.stringify({ content: bigContent }),
        currentEpochSeconds(),
      )
      .run()

    const captured: unknown[] = []
    const wrappedDb = wrapD1CapturingReads(env.DB, captured)

    await listWikiChanges(
      { db: wrappedDb, kv: env.KV, r2: env.R2, workspaceId, userId, role: 'admin' },
      { since: t0, limit: 50 },
    )

    const capturedText = JSON.stringify(captured)
    expect(captured.length).toBeGreaterThan(0)
    expect(capturedText.length).toBeGreaterThan(0)
    expect(capturedText).not.toContain(bigContent)
  })

  test("list_wiki_changes reports a deleted page's slug/title even though the row is gone", async () => {
    const t0 = currentEpochSeconds() - 1
    const page = await createPage('delta-delete', 'Delta Delete', 'content')
    await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'DELETE',
      headers: authHeaders(token, slug),
    })

    const body = (await (
      await req(`http://localhost/api/wiki/changes?since=${t0}`, {
        headers: authHeaders(token, slug),
      })
    ).json()) as { changes: { action: string; slug: string | null; title: string | null }[] }
    const deleteEvent = body.changes.find((change) => change.action === 'deleted')
    expect(deleteEvent).toMatchObject({ slug: 'delta-delete', title: 'Delta Delete' })
  })

  /*
   * PROJ-526: a cascade delete only records one activity row (for the root), so a
   * poller building a local mirror needs the descendant ids surfaced on that one event
   * to evict them too — otherwise they never get told the descendants also vanished.
   */
  test("list_wiki_changes surfaces deletedPageIds on a cascade delete's root event", async () => {
    const t0 = currentEpochSeconds() - 1
    const parent = await createPage('delta-cascade-parent', 'Delta Cascade Parent', 'content')
    const child = await createChildPage('delta-cascade-child', 'Delta Cascade Child', 'child', parent.id)

    const delRes = await req(`http://localhost/api/wiki/${parent.slug}?cascade=true`, {
      method: 'DELETE',
      headers: authHeaders(token, slug),
    })
    expect(delRes.status).toBe(200)

    const body = (await (
      await req(`http://localhost/api/wiki/changes?since=${t0}`, {
        headers: authHeaders(token, slug),
      })
    ).json()) as {
      changes: { action: string; pageId: string; deletedPageIds: string[] | null }[]
    }
    const deleteEvent = body.changes.find((change) => change.action === 'deleted' && change.pageId === parent.id)
    expect(deleteEvent?.deletedPageIds?.sort()).toStrictEqual([child.id, parent.id].toSorted())

    // Non-cascade events (e.g. the earlier "created" events) carry no deletedPageIds.
    const createdEvent = body.changes.find((change) => change.action === 'created' && change.pageId === parent.id)
    expect(createdEvent?.deletedPageIds ?? null).toBeNull()
  })

  test("list_wiki_changes hides changes to a project-scoped page the caller can't see", async () => {
    const project = await seedProject(workspaceId, `PRJ${crypto.randomUUID().slice(0, 4)}`)
    await seedGroupGrant(workspaceId, userId, project.id)
    const t0 = currentEpochSeconds() - 1

    const created = await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        title: 'Restricted',
        content: 'secret',
        projectId: project.id,
        slug: 'restricted-delta',
      }),
    })
    expect(created.status).toBe(201)

    // A workspace viewer with no grant on `project` shouldn't see this change.
    const outsider = await seedWatcher('viewer')
    const body = (await (
      await req(`http://localhost/api/wiki/changes?since=${t0}`, {
        headers: authHeaders(outsider.token, slug),
      })
    ).json()) as { changes: { slug: string | null }[] }
    expect(body.changes.some((change) => change.slug === 'restricted-delta')).toBe(false)

    // The grantee (the creator) does see it.
    const ownBody = (await (
      await req(`http://localhost/api/wiki/changes?since=${t0}`, {
        headers: authHeaders(token, slug),
      })
    ).json()) as { changes: { slug: string | null }[] }
    expect(ownBody.changes.some((change) => change.slug === 'restricted-delta')).toBe(true)
  })

  test('list_wiki_changes watchedOnly=true narrows to watched pages, including via a subtree watch', async () => {
    const parent = await createPage('watched-scope-parent', 'Watched Scope Parent', 'content')
    const other = await createPage('unwatched-scope', 'Unwatched Scope', 'content')
    const watcher = await seedWatcher()
    await req(`http://localhost/api/wiki/${parent.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(watcher.token, slug),
      body: JSON.stringify({ subtree: true }),
    })

    const child = await createChildPage('watched-scope-child', 'Watched Scope Child', 'child', parent.id)
    await req(`http://localhost/api/wiki/${other.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2' }),
    })

    const body = (await (
      await req('http://localhost/api/wiki/changes?since=0&watchedOnly=true', {
        headers: authHeaders(watcher.token, slug),
      })
    ).json()) as { changes: { pageId: string }[] }
    const pageIds = body.changes.map((change) => change.pageId)
    expect(pageIds).toContain(child.id)
    expect(pageIds).not.toContain(other.id)
  })

  test('covers MCP: watch_wiki_page / list_wiki_watches / list_wiki_changes mirror the REST behavior', async () => {
    /*
     * Several MCP calls back-to-back would otherwise trip the same per-token rate
     * limit that req() clears for REST calls above.
     */
    const mcp = async function mcp<T>(name: string, args: unknown): Promise<JsonRpcError | JsonRpcResult<T>> {
      await resetRateLimits()
      return mcpCall<T>(workspaceId, name, args, authHeaders(token, slug))
    }

    /*
     * Captured before createPage — since is exclusive and page creation's own
     * activity row must land after this cutoff, not before it (a slow full-suite
     * run can otherwise push several real seconds between here and list_wiki_changes).
     */
    const t0 = currentEpochSeconds() - 1
    const page = await createPage('mcp-watch', 'MCP Watch', 'content')

    const watchRes = await mcp('watch_wiki_page', { slug: page.slug })
    expect(isMcpError(watchRes)).toBe(false)

    const watches = mcpData(await mcp('list_wiki_watches', {}), WikiPageLinks)
    expect(watches.some((watch) => watch.pageId === page.id)).toBe(true)

    const unwatchRes = await mcp('unwatch_wiki_page', { slug: page.slug })
    expect(isMcpError(unwatchRes)).toBe(false)
    const watchesAfter = mcpData(await mcp('list_wiki_watches', {}), WikiPageLinks)
    expect(watchesAfter.some((w) => w.pageId === page.id)).toBe(false)

    const changes = mcpData(
      await mcp('list_wiki_changes', { since: t0 }),
      Schema.Struct({
        items: Schema.Array(Schema.Struct({ action: Schema.String, pageId: Schema.String })).pipe(Schema.mutable),
        next: Schema.String,
      }),
    )
    expect(changes.items.some((item) => item.pageId === page.id && item.action === 'created')).toBe(true)
  })
})

describe('wiki server-side drafts (PROJ-495)', () => {
  let token: string
  let slug: string
  let workspaceId: string

  beforeEach(async () => {
    const fixture = await seedFixture({ role: 'admin' })
    token = fixture.token
    slug = fixture.workspace.slug
    workspaceId = fixture.workspace.id
  })

  const req = async function req(url: string, opts?: RequestInit): Promise<Response> {
    return resetRateLimitAndFetch(url, opts)
  }

  const createPage = async function createPage(
    pageSlug: string,
    title: string,
    content = '',
  ): Promise<{ id: string; slug: string }> {
    const res = await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title, content, slug: pageSlug }),
    })
    expect(res.status).toBe(201)
    return readNativeJson(res, IdAndSlugResponse)
  }

  test('covers REST: no draft returns null, saving upserts, discarding clears it', async () => {
    const page = await createPage('draft-page', 'Draft Page', 'original content')

    const empty = await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      headers: authHeaders(token, slug),
    })
    expect(empty.status).toBe(200)
    await expect(empty.json()).resolves.toBeNull()

    const saveRes = await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Draft Page', content: 'draft v1', baseRevisionId: JSON_NULL }),
    })
    expect(saveRes.status).toBe(200)

    let getRes = await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      headers: authHeaders(token, slug),
    })
    await expect(getRes.json()).resolves.toMatchObject({ content: 'draft v1', title: 'Draft Page' })

    // Saving again upserts in place — no accumulation of draft rows.
    await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Draft Page', content: 'draft v2', baseRevisionId: JSON_NULL }),
    })
    getRes = await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      headers: authHeaders(token, slug),
    })
    await expect(getRes.json()).resolves.toMatchObject({ content: 'draft v2' })

    const discardRes = await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      method: 'DELETE',
      headers: authHeaders(token, slug),
    })
    expect(discardRes.status).toBe(200)
    getRes = await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      headers: authHeaders(token, slug),
    })
    await expect(getRes.json()).resolves.toBeNull()
  })

  test("drafts are per-user — one user's draft is invisible to another", async () => {
    const page = await createPage('draft-per-user', 'Draft Per User', 'content')
    const other = await seedUser(`other-${crypto.randomUUID().slice(0, 8)}@example.com`)
    await seedMember(workspaceId, other.id, 'admin')
    const otherToken = await seedToken(workspaceId, other.id)

    await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Draft Per User', content: 'mine', baseRevisionId: JSON_NULL }),
    })

    const otherGet = await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      headers: authHeaders(otherToken, slug),
    })
    await expect(otherGet.json()).resolves.toBeNull()
  })

  test("publishing the draft's content via the normal update path works; discarding after publish clears it", async () => {
    const page = await createPage('draft-publish', 'Draft Publish', 'v0')
    const pageRes = await req(`http://localhost/api/wiki/${page.slug}`, {
      headers: authHeaders(token, slug),
    })
    const pageBody = await readNativeJson(pageRes, Schema.Struct({ updated_at: Schema.Number }))

    const revRes = await req(`http://localhost/api/wiki/${page.slug}/revisions`, {
      headers: authHeaders(token, slug),
    })
    const revisions = await readNativeJson(revRes, IdListResponse)
    const baseRevisionId = revisions[0]?.id ?? null

    await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Draft Publish', content: 'draft content', baseRevisionId }),
    })

    /*
     * Publish reuses the EXISTING conflict-checked update path — not a separate
     * draft-publish endpoint — with the draft's own baseRevisionId.
     */
    const publishRes = await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'draft content', baseRevisionId }),
    })
    expect(publishRes.status).toBe(200)
    expect(pageBody.updated_at).toBeDefined()

    const discardRes = await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      method: 'DELETE',
      headers: authHeaders(token, slug),
    })
    expect(discardRes.status).toBe(200)
    const getRes = await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      headers: authHeaders(token, slug),
    })
    await expect(getRes.json()).resolves.toBeNull()
  })

  test('a stale baseRevisionId on publish still hits the normal 409 — no separate draft conflict mechanism', async () => {
    const page = await createPage('draft-conflict', 'Draft Conflict', 'v0')

    /*
     * Establish a first revision, and capture its id the way startEdit() would —
     * this is the baseRevisionId the draft freezes and later resubmits on publish.
     */
    await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v1' }),
    })
    const revRes = await req(`http://localhost/api/wiki/${page.slug}/revisions`, {
      headers: authHeaders(token, slug),
    })
    const revisions = await readNativeJson(revRes, IdListResponse)
    const draftBaseRevisionId = revisions[0]?.id
    expect(draftBaseRevisionId).toBeTruthy()

    // Save a draft frozen at that revision, exactly as the client's autosave would.
    await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        title: 'Draft Conflict',
        content: 'in-progress draft edit',
        baseRevisionId: draftBaseRevisionId,
      }),
    })

    /*
     * Someone else's edit advances the page's latest revision past what the draft
     * was based on.
     */
    await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: "someone else's edit" }),
    })

    /*
     * Publish resubmits the DRAFT's own (now-stale) baseRevisionId — exactly what
     * useWikiEditing's save() sends after a restoreDraft() — and must hit the same
     * 409 conflict path as any other stale edit.
     */
    const publishRes = await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'stale draft content', baseRevisionId: draftBaseRevisionId }),
    })
    expect(publishRes.status).toBe(409)
  })

  test('trashing a page (cascade or not) leaves its draft rows in place until purge (PROJ-496)', async () => {
    const parent = await createPage('draft-delete-parent', 'Draft Delete Parent', 'content')
    const child = (await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        title: 'Draft Delete Child',
        content: 'content',
        slug: 'draft-delete-child',
        parentId: parent.id,
      }),
    }).then((response) => response.json())) as { id: string; slug: string }

    await req(`http://localhost/api/wiki/${parent.slug}/draft`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({
        title: 'Draft Delete Parent',
        content: 'draft',
        baseRevisionId: JSON_NULL,
      }),
    })
    await req(`http://localhost/api/wiki/${child.slug}/draft`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Draft Delete Child', content: 'draft', baseRevisionId: JSON_NULL }),
    })

    const rows = await env.DB.prepare('SELECT page_id FROM wiki_drafts WHERE workspace_id = ?').bind(workspaceId).all()
    expect(rows.results).toHaveLength(2)

    const delRes = await req(`http://localhost/api/wiki/${parent.slug}?cascade=true`, {
      method: 'DELETE',
      headers: authHeaders(token, slug),
    })
    expect(delRes.status).toBe(200)

    /*
     * PROJ-496: draft cleanup moved to purge time — trashing the page (even cascaded)
     * leaves the draft rows untouched.
     */
    const rowsAfterDelete = await env.DB.prepare('SELECT page_id FROM wiki_drafts WHERE workspace_id = ?')
      .bind(workspaceId)
      .all()
    expect(rowsAfterDelete.results).toHaveLength(2)

    // Backdate past the 30-day retention window and purge.
    await env.DB.prepare('UPDATE wiki_pages SET deleted_at = ? WHERE workspace_id = ? AND deleted_at IS NOT NULL')
      .bind(currentEpochSeconds() - 31 * 24 * 60 * 60, workspaceId)
      .run()
    const purgeRes = await req('http://localhost/api/wiki/purge-trash', {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(purgeRes.status).toBe(200)

    const rowsAfterPurge = await env.DB.prepare('SELECT page_id FROM wiki_drafts WHERE workspace_id = ?')
      .bind(workspaceId)
      .all()
    expect(rowsAfterPurge.results).toHaveLength(0)
  })

  test('validation: title and content are required on save', async () => {
    const page = await createPage('draft-validation', 'Draft Validation', 'content')
    const res = await req(`http://localhost/api/wiki/${page.slug}/draft`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: '' }),
    })
    expect(res.status).toBe(400)
  })

  test('covers MCP: save_wiki_draft / get_wiki_draft / discard_wiki_draft mirror the REST behavior', async () => {
    const mcp = async function mcp<T>(name: string, args: unknown): Promise<JsonRpcError | JsonRpcResult<T>> {
      await resetRateLimits()
      return mcpCall<T>(workspaceId, name, args, authHeaders(token, slug))
    }
    const page = await createPage('mcp-draft', 'MCP Draft', 'content')

    const saveRes = await mcp('save_wiki_draft', {
      slug: page.slug,
      title: 'MCP Draft',
      content: 'mcp draft content',
      baseRevisionId: null,
    })
    expect(isMcpError(saveRes)).toBe(false)

    const draft = mcpData(await mcp('get_wiki_draft', { slug: page.slug }), OptionalWikiDraftResponse)
    expect(draft).toMatchObject({ content: 'mcp draft content' })

    const discardRes = await mcp('discard_wiki_draft', { slug: page.slug })
    expect(isMcpError(discardRes)).toBe(false)

    const afterDiscard = mcpData(await mcp('get_wiki_draft', { slug: page.slug }), OptionalWikiDraftResponse)
    expect(afterDiscard).toBeNull()
  })
})

describe('wiki trash (PROJ-496)', () => {
  let token: string
  let slug: string
  let workspaceId: string

  beforeEach(async () => {
    /*
     * Admin: deleteWikiPage/undeleteWikiPage/purgeExpiredWikiPages on a workspace-level
     * page all require admin/owner (requireWikiDelete / isWorkspaceAdmin).
     */
    const fixture = await seedFixture({ role: 'admin' })
    token = fixture.token
    slug = fixture.workspace.slug
    workspaceId = fixture.workspace.id
  })

  const req = async function req(url: string, opts?: RequestInit): Promise<Response> {
    return resetRateLimitAndFetch(url, opts)
  }

  const createPage = async function createPage(
    title: string,
    content: string,
    opts?: Record<string, unknown>,
  ): Promise<{ id: string; slug: string }> {
    const res = await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title, content, ...opts }),
    })
    expect(res.status).toBe(201)
    return readNativeJson(res, IdAndSlugResponse)
  }

  const trashPage = async function trashPage(pageSlug: string, cascade = false): Promise<void> {
    const res = await req(`http://localhost/api/wiki/${pageSlug}${cascade ? '?cascade=true' : ''}`, {
      method: 'DELETE',
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
  }

  const backdateTrash = function backdateTrash(
    seconds = 31 * 24 * 60 * 60,
  ): Promise<D1Result<Record<string, unknown>>> {
    return env.DB.prepare('UPDATE wiki_pages SET deleted_at = ? WHERE workspace_id = ? AND deleted_at IS NOT NULL')
      .bind(currentEpochSeconds() - seconds, workspaceId)
      .run()
  }

  test('a trashed page disappears from the list, tree, search, stale-pages, and templates endpoints', async () => {
    const page = await createPage('Trash List Page', 'trash-list-searchterm')
    await trashPage(page.slug)

    const listRes = await req('http://localhost/api/wiki', { headers: authHeaders(token, slug) })
    expect(((await listRes.json()) as { id: string }[]).some((p) => p.id === page.id)).toBe(false)

    const treeRes = await req('http://localhost/api/wiki/tree', {
      headers: authHeaders(token, slug),
    })
    type TreeNode = { id: string; children: TreeNode[] }
    const flatten = (nodes: Readonly<TreeNode[]>): string[] =>
      nodes.flatMap((node) => [node.id, ...flatten(node.children ?? [])])
    expect(flatten((await treeRes.json()) as TreeNode[])).not.toContain(page.id)

    const searchRes = await req('http://localhost/api/wiki/search?q=trash-list-searchterm', {
      headers: authHeaders(token, slug),
    })
    await expect(searchRes.json()).resolves.toStrictEqual([])

    const templatePage = await createPage('Trash Template Page', ['---', 'template: true', '---', 'content'].join('\n'))
    await trashPage(templatePage.slug)
    const templatesRes = await req('http://localhost/api/wiki/templates', {
      headers: authHeaders(token, slug),
    })
    expect(((await templatesRes.json()) as { id: string }[]).some((p) => p.id === templatePage.id)).toBe(false)
  })

  test('handles GET /api/wiki/:slug and GET /api/wiki/:id both 404 for a trashed page', async () => {
    const page = await createPage('Trash Get Page', 'content')
    await trashPage(page.slug)

    const bySlug = await req(`http://localhost/api/wiki/${page.slug}`, {
      headers: authHeaders(token, slug),
    })
    expect(bySlug.status).toBe(404)

    const byId = await req(`http://localhost/api/wiki/${page.id}`, {
      headers: authHeaders(token, slug),
    })
    expect(byId.status).toBe(404)
  })

  test('a trashed source page no longer counts as a backlink', async () => {
    const target = await createPage('Trash Backlink Target', 'target content')
    const source = await createPage('Trash Backlink Source', 'see [[Trash Backlink Target]]')

    let backlinksRes = await req(`http://localhost/api/wiki/${target.slug}/backlinks`, {
      headers: authHeaders(token, slug),
    })
    expect((await backlinksRes.json()) as { slug: string }[]).toStrictEqual([
      expect.objectContaining({ slug: source.slug, title: 'Trash Backlink Source' }),
    ])

    await trashPage(source.slug)
    backlinksRes = await req(`http://localhost/api/wiki/${target.slug}/backlinks`, {
      headers: authHeaders(token, slug),
    })
    await expect(backlinksRes.json()).resolves.toStrictEqual([])
  })

  test('a redirect pointing at a trashed page 404s instead of resolving', async () => {
    const page = await createPage('Trash Redirect Target', 'content')
    const renameRes = await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ slug: 'trash-redirect-target-renamed' }),
    })
    expect(renameRes.status).toBe(200)

    // The OLD slug is now just a redirect; it must still resolve to the live page...
    const stillLive = await req(`http://localhost/api/wiki/${page.slug}`, {
      headers: authHeaders(token, slug),
    })
    expect(stillLive.status).toBe(200)

    /*
     * ...but once the page (now at the new slug) is trashed, the redirect must 404
     * rather than resolving to a page that no longer exists in any live read path.
     */
    await trashPage('trash-redirect-target-renamed')
    const afterTrash = await req(`http://localhost/api/wiki/${page.slug}`, {
      headers: authHeaders(token, slug),
    })
    expect(afterTrash.status).toBe(404)
  })

  test('cascade trash moves the whole subtree as one unit: same deleted_at, all 404 via the API', async () => {
    const parent = await createPage('Trash Cascade Parent', 'content')
    const child = await createPage('Trash Cascade Child', 'content', { parentId: parent.id })
    const grandchild = await createPage('Trash Cascade Grandchild', 'content', {
      parentId: child.id,
    })

    await trashPage(parent.slug, true)

    const rows = await env.DB.prepare('SELECT id, deleted_at FROM wiki_pages WHERE id IN (?, ?, ?)')
      .bind(parent.id, child.id, grandchild.id)
      .all<{ id: string; deleted_at: number | null }>()
    expect(rows.results).toHaveLength(3)
    const deletedAts = new Set(rows.results.map((result) => result.deleted_at))
    expect(deletedAts.size).toBe(1)
    expect(rows.results.every((result) => Predicate.isNotNullish(result.deleted_at))).toBe(true)

    for (const p of [parent, child, grandchild]) {
      const res = await req(`http://localhost/api/wiki/${p.slug}`, {
        headers: authHeaders(token, slug),
      })
      expect(res.status).toBe(404)
    }
  })

  test('handles GET /api/wiki/trash lists trashed pages with a purgeAfter timestamp, and excludes live pages', async () => {
    const live = await createPage('Trash List Live', 'content')
    const trashed = await createPage('Trash List Trashed', 'content')
    await trashPage(trashed.slug)

    const res = await req('http://localhost/api/wiki/trash', { headers: authHeaders(token, slug) })
    expect(res.status).toBe(200)
    const rows = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ deleted_at: Schema.Number, id: Schema.String, purgeAfter: Schema.Number })).pipe(
        Schema.mutable,
      ),
    )
    expect(rows.some((selectedRow) => selectedRow.id === live.id)).toBe(false)
    const row = rows.find((selectedRow) => selectedRow.id === trashed.id)
    expect(row).toBeDefined()
    expect(row?.purgeAfter).toBe(row!.deleted_at + 30 * 24 * 60 * 60)
  })

  test('handles POST /api/wiki/trash/:id/undelete restores a trashed page: it becomes visible again', async () => {
    const page = await createPage('Trash Undelete Page', 'content')
    await trashPage(page.slug)

    const undeleteRes = await req(`http://localhost/api/wiki/trash/${page.id}/undelete`, {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(undeleteRes.status).toBe(200)
    await expect(undeleteRes.json()).resolves.toMatchObject({ ok: true, id: page.id, slug: page.slug })

    const getRes = await req(`http://localhost/api/wiki/${page.slug}`, {
      headers: authHeaders(token, slug),
    })
    expect(getRes.status).toBe(200)
  })

  test("undelete rejects a slug that's since been taken by a new live page (409 conflict)", async () => {
    const page = await createPage('Trash Conflict Page', 'content')
    await trashPage(page.slug)

    // A brand-new page can now legitimately claim the freed-up slug.
    const reclaimed = await createPage('Trash Conflict Reclaimed', 'content', {
      slug: page.slug,
    })
    expect(reclaimed.slug).toBe(page.slug)

    const undeleteRes = await req(`http://localhost/api/wiki/trash/${page.id}/undelete`, {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(undeleteRes.status).toBe(409)
  })

  test("undelete 404s for an unknown id and 400s for a page that isn't actually trashed", async () => {
    const unknownRes = await req(`http://localhost/api/wiki/trash/${crypto.randomUUID()}/undelete`, {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(unknownRes.status).toBe(404)

    const live = await createPage('Trash Not Trashed Page', 'content')
    const notTrashedRes = await req(`http://localhost/api/wiki/trash/${live.id}/undelete`, {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(notTrashedRes.status).toBe(400)
  })

  test('handles POST /api/wiki/purge-trash requires an admin/owner', async () => {
    const memberUser = await seedUser(`trash-member-${crypto.randomUUID().slice(0, 8)}@example.com`)
    await seedMember(workspaceId, memberUser.id, 'member')
    const memberToken = await seedToken(workspaceId, memberUser.id)

    const res = await req('http://localhost/api/wiki/purge-trash', {
      method: 'POST',
      headers: authHeaders(memberToken, slug),
    })
    expect(res.status).toBe(403)
  })

  test('purge removes only pages trashed >30 days ago, cleaning up every dependent table + R2', async () => {
    const oldPage = await createPage('Trash Purge Old', 'purge-old-searchterm')
    await createPage('Trash Purge Old Target', 'content')
    await req(`http://localhost/api/wiki/${oldPage.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'see [[Trash Purge Old Target]]' }),
    })
    const oldForm = new FormData()
    oldForm.append('file', new File(['old'], 'old.txt', { type: 'text/plain' }))
    oldForm.append('entityType', 'wiki_page')
    oldForm.append('entityId', oldPage.id)
    const oldUploadRes = await req('http://localhost/api/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Slug': slug },
      body: oldForm,
    })
    const { id: oldAttachmentId } = await readNativeJson(oldUploadRes, IdResponse)
    const resolvedValue = await env.DB.prepare('SELECT r2_key FROM attachments WHERE id = ?')
      .bind(oldAttachmentId)
      .first<{ r2_key: string }>()
    const oldR2Key = resolvedValue?.r2_key
    await req(`http://localhost/api/wiki/${oldPage.slug}/watch`, {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify({}),
    })
    await req(`http://localhost/api/wiki/${oldPage.slug}/draft`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: oldPage.slug, content: 'draft', baseRevisionId: JSON_NULL }),
    })
    await req(`http://localhost/api/wiki/${oldPage.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ slug: 'trash-purge-old-renamed' }),
    })

    const recentPage = await createPage('Trash Purge Recent', 'content')

    await trashPage('trash-purge-old-renamed')
    await trashPage(recentPage.slug)

    // Only the OLD page's trash timestamp is backdated past the retention window.
    await env.DB.prepare('UPDATE wiki_pages SET deleted_at = ? WHERE id = ?')
      .bind(currentEpochSeconds() - 31 * 24 * 60 * 60, oldPage.id)
      .run()

    const purgeRes = await req('http://localhost/api/wiki/purge-trash', {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(purgeRes.status).toBe(200)
    const purged = await readNativeJson(
      purgeRes,
      Schema.Struct({ purgedCount: Schema.Number, purgedIds: Schema.Array(Schema.String).pipe(Schema.mutable) }),
    )
    expect(purged.purgedCount).toBe(1)
    expect(purged.purgedIds).toStrictEqual([oldPage.id])

    await expect(env.DB.prepare('SELECT id FROM wiki_pages WHERE id = ?').bind(oldPage.id).first()).resolves.toBeNull()
    await expect(
      env.DB.prepare('SELECT id FROM attachments WHERE id = ?').bind(oldAttachmentId).first(),
    ).resolves.toBeNull()
    if (Predicate.isNotNullish(oldR2Key) && String.isNonEmpty(oldR2Key)) {
      await expect(env.R2.get(oldR2Key)).resolves.toBeNull()
    }
    await expect(
      env.DB.prepare('SELECT page_id FROM wiki_fts WHERE page_id = ?').bind(oldPage.id).first(),
    ).resolves.toBeNull()
    await expect(
      env.DB.prepare('SELECT id FROM wiki_links WHERE source_page_id = ?').bind(oldPage.id).first(),
    ).resolves.toBeNull()
    await expect(
      env.DB.prepare('SELECT page_id FROM wiki_watchers WHERE page_id = ?').bind(oldPage.id).first(),
    ).resolves.toBeNull()
    await expect(
      env.DB.prepare('SELECT page_id FROM wiki_drafts WHERE page_id = ?').bind(oldPage.id).first(),
    ).resolves.toBeNull()
    await expect(
      env.DB.prepare('SELECT id FROM wiki_redirects WHERE page_id = ?').bind(oldPage.id).first(),
    ).resolves.toBeNull()

    // The recently-trashed page (not yet 30 days old) survives the purge untouched.
    await expect(
      env.DB.prepare('SELECT id FROM wiki_pages WHERE id = ?').bind(recentPage.id).first(),
    ).resolves.not.toBeNull()
  })

  test('covers MCP list_wiki_trash / undelete_wiki_page / purge_wiki_trash mirror the REST behavior', async () => {
    const mcp = async function mcp<T>(name: string, args: unknown): Promise<JsonRpcError | JsonRpcResult<T>> {
      await resetRateLimits()
      return mcpCall<T>(workspaceId, name, args, authHeaders(token, slug))
    }
    const page = await createPage('MCP Trash Page', 'content')
    await trashPage(page.slug)

    const trashList = mcpData(
      await mcp('list_wiki_trash', {}),
      Schema.Array(Schema.Struct({ id: Schema.String, purgeAfter: Schema.Number })).pipe(Schema.mutable),
    )
    expect(trashList.some((r) => r.id === page.id)).toBe(true)

    const restored = mcpData(
      await mcp('undelete_wiki_page', { id: page.id }),
      Schema.Struct({ id: Schema.String, ok: Schema.Boolean }),
    )
    expect(restored).toMatchObject({ ok: true, id: page.id })

    await trashPage(page.slug)
    await backdateTrash()
    const purged = mcpData(
      await mcp('purge_wiki_trash', {}),
      Schema.Struct({ purgedCount: Schema.Number, purgedIds: Schema.Array(Schema.String).pipe(Schema.mutable) }),
    )
    expect(purged.purgedIds).toContain(page.id)
  })

  test('a link to a trashed-but-not-purged page is reported as broken (listBrokenWikiLinks)', async () => {
    const target = await createPage('Trash Broken Link Target', 'target content')
    const source = await createPage('Trash Broken Link Source', 'see [[Trash Broken Link Target]]')

    let brokenRes = await req('http://localhost/api/wiki/broken-links', {
      headers: authHeaders(token, slug),
    })
    expect(
      ((await brokenRes.json()) as { targetTitle: string }[]).some((b) => b.targetTitle === 'Trash Broken Link Target'),
    ).toBe(false)

    /*
     * The target is trashed but not yet purged — target_page_id is still set (purge
     * is what nulls it out), so without the EXISTS-deleted_at clause this link would
     * stay silently "resolved" until the 30-day purge finally clears it.
     */
    await trashPage(target.slug)

    brokenRes = await req('http://localhost/api/wiki/broken-links', {
      headers: authHeaders(token, slug),
    })
    expect(
      ((await brokenRes.json()) as { targetTitle: string; sourceSlug: string }[]).some(
        (b) => b.targetTitle === 'Trash Broken Link Target' && b.sourceSlug === source.slug,
      ),
    ).toBe(true)
  })

  test("purge only removes trash in the caller's own workspace", async () => {
    const other = await seedFixture({ role: 'admin' })
    const createOtherRes = await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(other.token, other.workspace.slug),
      body: JSON.stringify({ title: 'Other Workspace Trash Page', content: 'content' }),
    })
    const otherPage = await readNativeJson(createOtherRes, IdAndSlugResponse)
    await req(`http://localhost/api/wiki/${otherPage.slug}`, {
      method: 'DELETE',
      headers: authHeaders(other.token, other.workspace.slug),
    })
    await env.DB.prepare('UPDATE wiki_pages SET deleted_at = ? WHERE id = ?')
      .bind(currentEpochSeconds() - 31 * 24 * 60 * 60, otherPage.id)
      .run()

    const purgeRes = await req('http://localhost/api/wiki/purge-trash', {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(purgeRes.status).toBe(200)
    const purged = await readNativeJson(
      purgeRes,
      Schema.Struct({ purgedIds: Schema.Array(Schema.String).pipe(Schema.mutable) }),
    )
    expect(purged.purgedIds).not.toContain(otherPage.id)
    await expect(
      env.DB.prepare('SELECT id FROM wiki_pages WHERE id = ?').bind(otherPage.id).first(),
    ).resolves.not.toBeNull()
  })

  test('trash list/undelete/purge never reach across workspaces', async () => {
    const other = await seedFixture({ role: 'admin' })
    const createOtherRes = await req('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(other.token, other.workspace.slug),
      body: JSON.stringify({ title: 'Cross Workspace Trash Page', content: 'content' }),
    })
    const otherPage = await readNativeJson(createOtherRes, IdAndSlugResponse)
    await req(`http://localhost/api/wiki/${otherPage.slug}`, {
      method: 'DELETE',
      headers: authHeaders(other.token, other.workspace.slug),
    })

    const listRes = await req('http://localhost/api/wiki/trash', {
      headers: authHeaders(token, slug),
    })
    const listed = await readNativeJson(listRes, IdListResponse)
    expect(listed.some((r) => r.id === otherPage.id)).toBe(false)

    const undeleteRes = await req(`http://localhost/api/wiki/trash/${otherPage.id}/undelete`, {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(undeleteRes.status).toBe(404)
  })

  test('undeleting a cascade-trashed root also restores descendants sharing the same batch', async () => {
    const parent = await createPage('Cascade Undelete Parent', 'content')
    const child = await createPage('Cascade Undelete Child', 'content', { parentId: parent.id })
    const grandchild = await createPage('Cascade Undelete Grandchild', 'content', {
      parentId: child.id,
    })

    await trashPage(parent.slug, true)

    const undeleteRes = await req(`http://localhost/api/wiki/trash/${parent.id}/undelete`, {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(undeleteRes.status).toBe(200)
    await expect(undeleteRes.json()).resolves.toMatchObject({ ok: true, restoredCount: 3 })

    for (const p of [parent, child, grandchild]) {
      const row = await env.DB.prepare('SELECT deleted_at FROM wiki_pages WHERE id = ?')
        .bind(p.id)
        .first<{ deleted_at: number | null }>()
      expect(row?.deleted_at).toBeNull()

      const res = await req(`http://localhost/api/wiki/${p.slug}`, {
        headers: authHeaders(token, slug),
      })
      expect(res.status).toBe(200)
    }
  })

  test("undeleting a cascade-trashed root 409s (not a raw 500) when a descendant's slug was reclaimed", async () => {
    const parent = await createPage('Cascade Undelete Conflict Parent', 'content')
    const child = await createPage('Cascade Undelete Conflict Child', 'content', {
      parentId: parent.id,
    })

    await trashPage(parent.slug, true)

    // A brand-new page claims the now-freed child slug while the subtree is trashed.
    const reclaimed = await createPage('Cascade Undelete Conflict Reclaimed', 'content', {
      slug: child.slug,
    })
    expect(reclaimed.slug).toBe(child.slug)

    const undeleteRes = await req(`http://localhost/api/wiki/trash/${parent.id}/undelete`, {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(undeleteRes.status).toBe(409)
    const body = await readNativeJson(
      undeleteRes,
      Schema.Struct({ error: Schema.optional(Schema.String), message: Schema.optional(Schema.String) }),
    )
    const message = body.error ?? body.message ?? ''
    expect(message).toContain(child.slug)

    /*
     * Nothing in the batch should have been restored — the whole check runs before
     * any row is updated.
     */
    const parentRow = await env.DB.prepare('SELECT deleted_at FROM wiki_pages WHERE id = ?')
      .bind(parent.id)
      .first<{ deleted_at: number | null }>()
    expect(parentRow?.deleted_at).not.toBeNull()
  })

  test('undeleting a cascade-trashed root does NOT restore a descendant trashed separately, same window', async () => {
    /*
     * Regression test for the trash_batch_id disambiguation (PROJ-496 follow-up):
     * trashing the child alone and then cascade-trashing the parent right after, with
     * no artificial time offset, used to be indistinguishable from "trashed in one
     * cascade batch" when both landed on the same deleted_at second. trash_batch_id
     * gives each deleteWikiPage call its own identity regardless of timestamp, so this
     * now correctly leaves the independently-trashed child alone.
     */
    const parent = await createPage('Cascade Undelete Mixed Parent', 'content')
    const child = await createPage('Cascade Undelete Mixed Child', 'content', {
      parentId: parent.id,
    })
    await trashPage(child.slug)
    await trashPage(parent.slug, true)

    const undeleteRes = await req(`http://localhost/api/wiki/trash/${parent.id}/undelete`, {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(undeleteRes.status).toBe(200)
    await expect(undeleteRes.json()).resolves.toMatchObject({ ok: true, restoredCount: 1 })

    const childRow = await env.DB.prepare('SELECT deleted_at FROM wiki_pages WHERE id = ?')
      .bind(child.id)
      .first<{ deleted_at: number | null }>()
    expect(childRow?.deleted_at).not.toBeNull()
  })

  test("non-cascade trash leaves a trashed child's parent_id untouched; undelete restores original parent", async () => {
    const parent = await createPage('Noncascade Reparent Parent', 'content')
    const child = await createPage('Noncascade Reparent Child', 'content', {
      parentId: parent.id,
    })
    await trashPage(child.slug)

    await trashPage(parent.slug, false)

    const childRow = await env.DB.prepare('SELECT parent_id FROM wiki_pages WHERE id = ?')
      .bind(child.id)
      .first<{ parent_id: string | null }>()
    expect(childRow?.parent_id).toBe(parent.id)

    const undeleteRes = await req(`http://localhost/api/wiki/trash/${child.id}/undelete`, {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(undeleteRes.status).toBe(200)

    const restoredRow = await env.DB.prepare('SELECT parent_id FROM wiki_pages WHERE id = ?')
      .bind(child.id)
      .first<{ parent_id: string | null }>()
    expect(restoredRow?.parent_id).toBe(parent.id)
  })

  test('purge re-parents a live child left pointing at a page that gets purged', async () => {
    const grandparent = await createPage('Purge Reparent Grandparent', 'content')
    const parent = await createPage('Purge Reparent Parent', 'content', {
      parentId: grandparent.id,
    })
    const child = await createPage('Purge Reparent Child', 'content', { parentId: parent.id })

    /*
     * Cascade-trash grandparent -> parent -> child as one batch, then undelete just the
     * child on its own — it's now live again with parent_id still pointing at the
     * still-trashed `parent`.
     */
    await trashPage(grandparent.slug, true)
    const undeleteRes = await req(`http://localhost/api/wiki/trash/${child.id}/undelete`, {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(undeleteRes.status).toBe(200)

    await backdateTrash()

    const purgeRes = await req('http://localhost/api/wiki/purge-trash', {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(purgeRes.status).toBe(200)
    const purged = await readNativeJson(
      purgeRes,
      Schema.Struct({ purgedIds: Schema.Array(Schema.String).pipe(Schema.mutable) }),
    )
    expect(purged.purgedIds).toStrictEqual(expect.arrayContaining([grandparent.id, parent.id]))

    const childRow = await env.DB.prepare('SELECT parent_id FROM wiki_pages WHERE id = ?')
      .bind(child.id)
      .first<{ parent_id: string | null }>()
    // parent_id must not dangle — it either got nulled or repointed at a surviving
    // ancestor, never left pointing at grandparent/parent (both now purged).
    expect(childRow?.parent_id === null || Predicate.isNullish(childRow?.parent_id)).toBe(true)
  })

  test('purge deletes wiki_revisions rows for purged pages', async () => {
    const page = await createPage('Purge Revisions Page', 'v1')
    await req(`http://localhost/api/wiki/${page.slug}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ content: 'v2' }),
    })
    const revisionsBefore = await env.DB.prepare('SELECT id FROM wiki_revisions WHERE page_id = ?')
      .bind(page.id)
      .all<{ id: string }>()
    expect(revisionsBefore.results.length).toBeGreaterThan(0)

    await trashPage(page.slug)
    await backdateTrash()

    const purgeRes = await req('http://localhost/api/wiki/purge-trash', {
      method: 'POST',
      headers: authHeaders(token, slug),
    })
    expect(purgeRes.status).toBe(200)

    const revisionsAfter = await env.DB.prepare('SELECT id FROM wiki_revisions WHERE page_id = ?')
      .bind(page.id)
      .all<{ id: string }>()
    expect(revisionsAfter.results).toHaveLength(0)
  })
})

/*
 * PROJ-812: a slug equal to another page's id must never make an id-or-slug lookup
 * hit the wrong page, and new id-shaped slugs are rejected outright.
 */
describe('wiki slug/id collisions (PROJ-812)', () => {
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

  const create = async function create(body: Record<string, unknown>): Promise<Response> {
    return resetRateLimitAndFetch('http://localhost/api/wiki', {
      method: 'POST',
      headers: authHeaders(token, slug),
      body: JSON.stringify(body),
    })
  }

  test('rejects an explicit slug shaped like a dashed or undashed page id', async () => {
    const dashed = await create({ title: 'A', slug: crypto.randomUUID() })
    expect(dashed.status).toBe(400)
    const hex = await create({ title: 'B', slug: crypto.randomUUID().replace(/-/gu, '') })
    expect(hex.status).toBe(400)
  })

  test('rejects renaming a page to an id-shaped slug', async () => {
    const res = await create({ title: 'Rename Me' })
    const page = await readNativeJson(res, IdResponse)
    const put = await resetRateLimitAndFetch(`http://localhost/api/wiki/${page.id}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ slug: crypto.randomUUID() }),
    })
    expect(put.status).toBe(400)
  })

  test('suffixes an auto-derived slug when the title is itself an id', async () => {
    const id = crypto.randomUUID()
    const res = await create({ title: id })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { slug: string }).slug).toBe(`${id}-page`)
  })

  test("resolves GET, PUT and DELETE by id to the id's page when a legacy slug equals that id", async () => {
    /*
     * Legacy (pre-PROJ-812) data, inserted directly since the API now refuses it: the
     * impostor row is written FIRST, so a lookup without an id preference returns it.
     */
    const target = { id: crypto.randomUUID() }
    const impostorId = crypto.randomUUID()
    const now = currentEpochSeconds()
    const insert = (id: string, pageSlug: string, title: string): D1PreparedStatement =>
      env.DB.prepare(
        `INSERT INTO wiki_pages (id, workspace_id, project_id, slug, title, content,
				 parent_id, created_by_id, updated_by_id, created_at, updated_at)
				 VALUES (?, ?, NULL, ?, ?, 'body', NULL, ?, ?, ?, ?)`,
      ).bind(id, workspaceId, pageSlug, title, userId, userId, now, now)
    await env.DB.batch([insert(impostorId, target.id, 'Impostor'), insert(target.id, 'target', 'Target')])

    const get = await resetRateLimitAndFetch(`http://localhost/api/wiki/${target.id}`, {
      headers: authHeaders(token, slug),
    })
    expect(get.status).toBe(200)
    expect(((await get.json()) as { id: string }).id).toBe(target.id)

    const put = await resetRateLimitAndFetch(`http://localhost/api/wiki/${target.id}`, {
      method: 'PUT',
      headers: authHeaders(token, slug),
      body: JSON.stringify({ title: 'Target Renamed' }),
    })
    expect(put.status).toBe(200)

    const del = await resetRateLimitAndFetch(`http://localhost/api/wiki/${target.id}`, {
      method: 'DELETE',
      headers: authHeaders(token, slug),
    })
    expect(del.status).toBeLessThan(300)

    const rows = await env.DB.prepare('SELECT id, title, deleted_at FROM wiki_pages WHERE id IN (?, ?)')
      .bind(target.id, impostorId)
      .all<{ id: string; title: string; deleted_at: number | null }>()
    const byId = Object.fromEntries(rows.results.map((result) => [result.id, result]))
    expect(byId[target.id].title).toBe('Target Renamed')
    expect(byId[target.id].deleted_at).not.toBeNull()
    expect(byId[impostorId].title).toBe('Impostor')
    expect(byId[impostorId].deleted_at).toBeNull()
  })
})
