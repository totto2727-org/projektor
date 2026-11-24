import { Schema, Iterable } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  authHeaders,
  seedCustomFieldDef,
  seedCustomFieldValue,
  seedFixture,
  seedGroupGrant,
  seedIssue,
  seedMember,
  seedProject,
  seedUser,
  toolError,
} from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import {
  IssueTitlesResponse,
  RecordItemsResponse,
  TitleItemsResponse,
  ItemsResponse,
  parseNativeMcpText,
  IdAndSlugResponse,
  IdResponse,
  JsonListResponse,
  SlugResponse,
  readNativeJson,
} from './response-json.ts'

const mcpFetch = async function mcpFetch(
  workspaceId: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
  query = '',
): Promise<Response> {
  return fetchNativeApi(`http://localhost/mcp/${workspaceId}${query}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
}

const mcpCall = async function mcpCall<T>(
  workspaceId: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
  query = '',
): Promise<JsonRpcResult<T> | JsonRpcError> {
  const res = await mcpFetch(workspaceId, method, params, headers, query)
  return res.json()
}

const IssuePageCursor = Schema.Union([Schema.Number, Schema.Null])
const IssuePageResponse = Schema.Struct({
  ...RecordItemsResponse.fields,
  next: Schema.optional(Schema.String),
  nextCursor: Schema.optional(IssuePageCursor),
})

describe('covers MCP endpoint', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let projectId: string
  let headers: Record<string, string>

  beforeEach(async () => {
    const fixture = await seedFixture()
    token = fixture.token
    slug = fixture.workspace.slug
    workspaceId = fixture.workspace.id
    headers = authHeaders(token, slug)
    const project = await seedProject(workspaceId)
    projectId = project.id
    await seedGroupGrant(workspaceId, fixture.user.id, projectId)
  })

  test('initialize returns server info', async () => {
    const res = (await mcpCall(workspaceId, 'initialize', {}, headers)) as JsonRpcResult<{
      protocolVersion: string
      serverInfo: { name: string; version: string }
      instructions: string
    }>
    /*
     * "2025-11-25" is the latest *legacy* protocol version (initialize handshake).
     * "2026-07-28" denotes the modern per-request `_meta` era, which has no
     * initialize method — claiming it here while still running the legacy
     * handshake would misrepresent what this server actually implements.
     */
    expect(res.result.protocolVersion).toBe('2025-11-25')
    expect(res.result.serverInfo.name).toBe('projektor')
    /*
     * __PROJEKTOR_VERSION__ is only injected by the release build (scripts/build-release.sh);
     * tests run without that define, so the fallback applies.
     */
    expect(res.result.serverInfo.version).toBe('dev')
    // Instructions point at the canonical workflow spec rather than restating rules (PROJ-251).
    expect(res.result.instructions).toContain('get_workflow')
    // PROJ-599: instructions point working-an-epic agents at the shipped playbook.
    expect(res.result.instructions).toContain('get_playbook("epic-goal")')
    // PROJ-600: capabilities advertise the native prompts primitive.
    expect(res.result).toHaveProperty('capabilities.prompts')
  })

  test('initialize response carries no session identifier (PROJ-452)', async () => {
    const res = await mcpFetch(workspaceId, 'initialize', {}, headers)
    expect(res.headers.get('Mcp-Session-Id')).toBeNull()
    const body = (await res.json()) as JsonRpcResult<Record<string, unknown>>
    expect(body.result).not.toHaveProperty('sessionId')
  })

  test('calls tools/list directly with no prior initialize and no session header (PROJ-452)', async () => {
    /*
     * The 2026-07-28 spec drops the initialize/initialized handshake and
     * Mcp-Session-Id requirement; this asserts projektor never depended on
     * either in the first place — a fresh request with no session state
     * attached succeeds identically to one preceded by `initialize`.
     */
    const res = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    expect(res.result.tools.length).toBeGreaterThan(0)
  })

  test('tools/list includes cache hints (PROJ-454)', async () => {
    const res = (await mcpCall<{ ttlMs: number; cacheScope: string }>(
      workspaceId,
      'tools/list',
      {},
      headers,
    )) as JsonRpcResult<{ ttlMs: number; cacheScope: string }>
    expect(res.result.ttlMs).toBeGreaterThan(0)
    expect(res.result.cacheScope).toBe('private')
  })

  test('tools/list responses differ by query string back to back, same path (PROJ-717)', async () => {
    const filtered = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=issues',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    const unfiltered = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    expect(filtered.result.tools.length).toBeLessThan(unfiltered.result.tools.length)
  })

  test('tools/list returns core tools', async () => {
    const res = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    const names = res.result.tools.map((t) => t.name)
    expect(names).toContain('list_issues')
    expect(names).toContain('create_issue')
    expect(names).toContain('search_wiki')
    expect(names).toContain('get_wiki_page')
  })

  test('tools/call list_issues returns empty page initially', async () => {
    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'list_issues', arguments: {} },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const data = parseNativeMcpText(res.result.content[0].text, IssuePageResponse)
    expect(Array.isArray(data.items)).toBe(true)
    expect(data.items).toHaveLength(0)
    expect(data.next).toBeUndefined()
  })

  test('tools/call create_issue then list_issues returns it', async () => {
    await mcpCall(
      workspaceId,
      'tools/call',
      {
        name: 'create_issue',
        arguments: { projectId, title: 'MCP-created issue', priority: 'high' },
      },
      headers,
    )

    const listRes = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'list_issues', arguments: {} },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const data = parseNativeMcpText(listRes.result.content[0].text, IssuePageResponse)
    expect(data.items).toHaveLength(1)
    expect((data.items[0] as { title: string }).title).toBe('MCP-created issue')
    expect((data.items[0] as { priority: string }).priority).toBe('high')
  })

  test('tools/call search_wiki finds pages', async () => {
    await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'How to use the MCP endpoint', title: 'MCP Docs' }),
    })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'search_wiki', arguments: { query: 'MCP endpoint' } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const results = parseNativeMcpText(res.result.content[0].text, TitleItemsResponse).items
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toBe('MCP Docs')
  })

  test('tools/call get_wiki_page retrieves a page', async () => {
    await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: '## Steps', title: 'Runbook' }),
    })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'get_wiki_page', arguments: { slug: 'runbook' } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const page = parseNativeMcpText(
      res.result.content[0].text,
      Schema.Struct({ content: Schema.String, title: Schema.String }),
    )
    expect(page.title).toBe('Runbook')
    expect(page.content).toBe('## Steps')
  })

  test('returns JSON-RPC error for unknown method', async () => {
    const res = (await mcpCall(workspaceId, 'not/a/method', {}, headers)) as JsonRpcError
    expect(res.error.code).toBe(-32_601)
  })

  test('returns JSON-RPC error for unknown tool', async () => {
    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'does_not_exist', arguments: {} },
      headers,
    )) as JsonRpcError
    expect(res.error.code).toBe(-32_601)
    expect(res.error.message).toContain('does_not_exist')
  })

  // PROJ-893: a ValidationError's per-field messages travel in the tool error's
  // `fields` member of a successful JSON-RPC response.
  test('tools/call ValidationError carries Zod issues in the tool error fields', async () => {
    const res = await mcpCall(
      workspaceId,
      'tools/call',
      { name: 'create_issue', arguments: { projectId, title: 123 } },
      headers,
    )
    const err = toolError(res)
    expect(err?.code).toBe('validation')
    expect(err?.message).toBeTruthy()
    expect(err?.fields?.title).toBeTruthy()
    expect(err?.hint).toContain('title')
  })

  /*
   * A ServiceError with no structured `details` (e.g. a plain not-found)
   * still omits `details` entirely rather than sending it as null.
   */
  test('tools/call error without structured details omits details', async () => {
    const res = await mcpCall(
      workspaceId,
      'tools/call',
      { name: 'get_issue', arguments: { id: crypto.randomUUID() } },
      headers,
    )
    const err = toolError(res)
    expect(err?.code).toBe('not_found')
    expect(err && 'details' in err).toBe(false)
  })

  // --- Issues: REST/MCP parity tests ---

  test('covers MCP create_issue with assigneeId and labels persists them', async () => {
    const assignee = await seedUser('mcp-assignee@example.com')
    await seedMember(workspaceId, assignee.id)

    const createRes = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      {
        name: 'create_issue',
        arguments: {
          projectId,
          title: 'With assignee',
          assigneeId: assignee.id,
          labels: ['mcp', 'test'],
        },
      },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const created = parseNativeMcpText(createRes.result.content[0].text, IdResponse)
    expect(created.id).toBeTruthy()

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${created.id}`, { headers })
    const issue = await readNativeJson(getRes, Schema.Struct({ assignee_id: Schema.String, labels: Schema.String }))
    expect(issue.assignee_id).toBe(assignee.id)
    expect(JSON.parse(issue.labels)).toStrictEqual(['mcp', 'test'])
  })

  test('covers MCP update_issue with assigneeId and labels updates them', async () => {
    const assignee = await seedUser('mcp-upd-assignee@example.com')
    await seedMember(workspaceId, assignee.id)

    const createRes = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'create_issue', arguments: { projectId, title: 'Before update' } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const { id } = parseNativeMcpText(createRes.result.content[0].text, IdResponse)

    await mcpCall(
      workspaceId,
      'tools/call',
      {
        name: 'update_issue',
        arguments: { id, assigneeId: assignee.id, labels: ['updated'] },
      },
      headers,
    )

    const getRes = await fetchNativeApi(`http://localhost/api/issues/${id}`, { headers })
    const issue = await readNativeJson(getRes, Schema.Struct({ assignee_id: Schema.String, labels: Schema.String }))
    expect(issue.assignee_id).toBe(assignee.id)
    expect(JSON.parse(issue.labels)).toStrictEqual(['updated'])
  })

  test('covers MCP list_issues with assignee filter returns same subset as REST', async () => {
    const assignee = await seedUser('mcp-list-assignee@example.com')
    await seedMember(workspaceId, assignee.id)

    // Create two issues; only one assigned
    await mcpCall(
      workspaceId,
      'tools/call',
      {
        name: 'create_issue',
        arguments: { projectId, title: 'Unassigned' },
      },
      headers,
    )
    await mcpCall(
      workspaceId,
      'tools/call',
      {
        name: 'create_issue',
        arguments: { projectId, title: 'Assigned', assigneeId: assignee.id },
      },
      headers,
    )

    // MCP filter
    const mcpRes = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'list_issues', arguments: { assignee: assignee.id } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const mcpData = parseNativeMcpText(mcpRes.result.content[0].text, IssuePageResponse)
    expect(mcpData.items).toHaveLength(1)
    expect((mcpData.items[0] as { title: string }).title).toBe('Assigned')

    // REST filter — same result
    const restRes = await fetchNativeApi(`http://localhost/api/issues?assignee=${assignee.id}`, {
      headers,
    })
    const restData = await readNativeJson(restRes, IssuePageResponse)
    expect(restData.items).toHaveLength(1)
    expect((restData.items[0] as { title: string }).title).toBe('Assigned')
  })

  test('covers MCP list_issues returns { items, next } (PROJ-891); REST keeps { items, nextCursor }', async () => {
    const mcpRes = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'list_issues', arguments: {} },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const mcpData = parseNativeMcpText(mcpRes.result.content[0].text, IssuePageResponse)

    const restRes = await fetchNativeApi('http://localhost/api/issues', { headers })
    const restData = await readNativeJson(restRes, IssuePageResponse)

    expect(Array.isArray(mcpData.items)).toBe(true)
    expect('nextCursor' in mcpData).toBe(false)
    expect(Array.isArray(restData.items)).toBe(true)
    expect('nextCursor' in restData).toBe(true)
  })

  test('covers MCP get_issue by ref returns issue', async () => {
    // Create via MCP; project key is 'PROJ', first issue = PROJ-1
    await mcpCall(
      workspaceId,
      'tools/call',
      {
        name: 'create_issue',
        arguments: { projectId, title: 'Ref via MCP' },
      },
      headers,
    )

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'get_issue', arguments: { ref: 'PROJ-1' } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const issue = parseNativeMcpText(res.result.content[0].text, Schema.Struct({ title: Schema.String }))
    expect(issue.title).toBe('Ref via MCP')
  })

  test('covers MCP get_issue for unknown id returns error', async () => {
    const res = await mcpCall(
      workspaceId,
      'tools/call',
      { name: 'get_issue', arguments: { id: crypto.randomUUID() } },
      headers,
    )
    const err = toolError(res)
    expect(err?.code).toBe('not_found')
    expect(err?.message).toMatch(/not found/i)
  })

  // --- wiki parity tests ---

  test('covers MCP list_wiki_pages without parentId returns ALL pages', async () => {
    const parentRes = await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'root', title: 'Parent' }),
    })
    const parent = await readNativeJson(parentRes, IdResponse)

    await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Child', content: 'child', parentId: parent.id }),
    })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'list_wiki_pages', arguments: {} },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const pages = parseNativeMcpText(res.result.content[0].text, JsonListResponse)
    expect(pages).toHaveLength(2)
  })

  test('covers MCP search_wiki with empty query returns []', async () => {
    await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'content', title: 'Some Page' }),
    })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'search_wiki', arguments: { query: '' } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const results = parseNativeMcpText(res.result.content[0].text, ItemsResponse)
    expect(results).toStrictEqual({ items: [] })
  })

  test('covers MCP search_wiki excerpt is at most 250 chars', async () => {
    const longContent = 'z'.repeat(1000)
    await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: longContent, title: 'Verbose Page' }),
    })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'search_wiki', arguments: { query: 'Verbose' } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const results = parseNativeMcpText(
      res.result.content[0].text,
      Schema.Struct({ items: Schema.Array(Schema.Struct({ excerpt: Schema.String })).pipe(Schema.mutable) }),
    ).items
    expect(results).toHaveLength(1)
    expect(results[0].excerpt.length).toBeLessThanOrEqual(250)
  })

  test('covers MCP create_wiki_page without slug auto-generates from title', async () => {
    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'create_wiki_page', arguments: { title: 'Auto Slug Page', content: 'hi' } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const created = parseNativeMcpText(res.result.content[0].text, SlugResponse)
    expect(created.slug).toBe('auto-slug-page')
  })

  test('covers MCP update_wiki_page by id creates a revision when content changes', async () => {
    const createRes = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'create_wiki_page', arguments: { title: 'Rev Test', content: 'v1' } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const { id } = parseNativeMcpText(createRes.result.content[0].text, IdResponse)

    await mcpCall(
      workspaceId,
      'tools/call',
      {
        name: 'update_wiki_page',
        arguments: { id, content: 'v2' },
      },
      headers,
    )

    const revRes = await fetchNativeApi(`http://localhost/api/wiki/rev-test/revisions`, {
      headers,
    })
    const revisions = await readNativeJson(revRes, JsonListResponse)
    expect(revisions).toHaveLength(1)
  })

  test('covers MCP update_wiki_page title-only update does not create a revision', async () => {
    const createRes = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'create_wiki_page', arguments: { title: 'Title Only', content: 'body' } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const { id } = parseNativeMcpText(createRes.result.content[0].text, IdResponse)

    await mcpCall(
      workspaceId,
      'tools/call',
      {
        name: 'update_wiki_page',
        arguments: { id, title: 'New Title' },
      },
      headers,
    )

    const revRes = await fetchNativeApi('http://localhost/api/wiki/title-only/revisions', {
      headers,
    })
    const revisions = await readNativeJson(revRes, JsonListResponse)
    expect(revisions).toHaveLength(0)
  })

  test('covers MCP update_wiki_page by slug works', async () => {
    await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'original', title: 'Slug Update' }),
    })

    await mcpCall(
      workspaceId,
      'tools/call',
      {
        name: 'update_wiki_page',
        arguments: { slug: 'slug-update', content: 'updated' },
      },
      headers,
    )

    const pageRes = await fetchNativeApi('http://localhost/api/wiki/slug-update', { headers })
    const page = await readNativeJson(pageRes, Schema.Struct({ content: Schema.String }))
    expect(page.content).toBe('updated')
  })

  test('covers MCP create_wiki_page with invalid title returns a validation tool error', async () => {
    const res = await mcpCall(
      workspaceId,
      'tools/call',
      { name: 'create_wiki_page', arguments: { title: '' } },
      headers,
    )
    expect('error' in (res as object)).toBe(false)
    expect(toolError(res)?.code).toBe('validation')
  })

  test('covers MCP delete_wiki_page cascade=true removes the page and its subtree (PROJ-238)', async () => {
    const owner = await seedFixture({ role: 'owner' })
    const ownerHeaders = authHeaders(owner.token, owner.workspace.slug)

    const parentRes = await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ content: '', title: 'MCP Cascade Parent' }),
    })
    const parent = await readNativeJson(parentRes, IdAndSlugResponse)

    const childRes = await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ title: 'MCP Cascade Child', content: '', parentId: parent.id }),
    })
    const child = await readNativeJson(childRes, SlugResponse)

    const delRes = (await mcpCall<{ content: { text: string }[] }>(
      owner.workspace.id,
      'tools/call',
      { name: 'delete_wiki_page', arguments: { slug: parent.slug, cascade: true } },
      ownerHeaders,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    expect(JSON.parse(delRes.result.content[0].text)).toStrictEqual({
      deletedCount: 2,
      linkedByCount: 0,
      ok: true,
    })

    const childRes2 = await fetchNativeApi(`http://localhost/api/wiki/${child.slug}`, {
      headers: ownerHeaders,
    })
    expect(childRes2.status).toBe(404)
  })

  test('covers MCP delete_wiki_page default promotes children instead of deleting them', async () => {
    const owner = await seedFixture({ role: 'owner' })
    const ownerHeaders = authHeaders(owner.token, owner.workspace.slug)

    const parentRes = await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ content: '', title: 'MCP Promote Parent' }),
    })
    const parent = await readNativeJson(parentRes, IdAndSlugResponse)

    const childRes = await fetchNativeApi('http://localhost/api/wiki', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ title: 'MCP Promote Child', content: '', parentId: parent.id }),
    })
    const child = await readNativeJson(childRes, SlugResponse)

    await mcpCall(
      owner.workspace.id,
      'tools/call',
      { name: 'delete_wiki_page', arguments: { slug: parent.slug } },
      ownerHeaders,
    )

    const childRes2 = await fetchNativeApi(`http://localhost/api/wiki/${child.slug}`, {
      headers: ownerHeaders,
    })
    expect(childRes2.status).toBe(200)
    const childPage = await readNativeJson(
      childRes2,
      Schema.Struct({ parent_id: Schema.Union([Schema.String, Schema.Null]) }),
    )
    expect(childPage.parent_id).toBeNull()
  })

  // --- get_prioritized_issues ---

  test('get_prioritized_issues returns empty list when no open issues', async () => {
    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'get_prioritized_issues', arguments: { includeNotReady: true } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const data = parseNativeMcpText(
      res.result.content[0].text,
      Schema.Struct({ issues: Schema.Array(Schema.Unknown).pipe(Schema.mutable) }),
    )
    expect(Array.isArray(data.issues)).toBe(true)
    expect(data.issues).toHaveLength(0)
  })

  test('get_prioritized_issues returns issues with _score and _score_breakdown', async () => {
    const { user } = await seedFixture()
    await seedIssue(workspaceId, projectId, user.id, { priority: 'high', title: 'Issue A' })
    await seedIssue(workspaceId, projectId, user.id, { priority: 'low', title: 'Issue B' })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'get_prioritized_issues', arguments: { includeNotReady: true } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const data = JSON.parse(res.result.content[0].text) as {
      issues: {
        title: string
        _score: number
        _score_breakdown: { centrality: number; priority: number; story_points: number }
      }[]
    }
    expect(data.issues.length).toBeGreaterThan(0)
    Iterable.forEach(data.issues, (issue) => {
      expect(typeof issue._score).toBe('number')
      expect(issue._score_breakdown).toHaveProperty('centrality')
      expect(issue._score_breakdown).toHaveProperty('priority')
      expect(issue._score_breakdown).toHaveProperty('story_points')
    })
  })

  test('get_prioritized_issues ranks high-priority issues above low-priority', async () => {
    const { user } = await seedFixture()
    await seedIssue(workspaceId, projectId, user.id, { priority: 'urgent', title: 'Urgent' })
    await seedIssue(workspaceId, projectId, user.id, { priority: 'none', title: 'None' })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'get_prioritized_issues', arguments: { includeNotReady: true } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const data = parseNativeMcpText(
      res.result.content[0].text,
      Schema.Struct({
        issues: Schema.Array(Schema.Struct({ _score: Schema.Number, title: Schema.String })).pipe(Schema.mutable),
      }),
    )
    const titles = data.issues.map((issue) => issue.title)
    expect(titles.indexOf('Urgent')).toBeLessThan(titles.indexOf('None'))
  })

  test('get_prioritized_issues excludes done and cancelled issues', async () => {
    const { user } = await seedFixture()
    await seedIssue(workspaceId, projectId, user.id, { priority: 'high', title: 'Open' })
    await seedIssue(workspaceId, projectId, user.id, {
      priority: 'urgent',
      status: 'done',
      title: 'Done',
    })
    await seedIssue(workspaceId, projectId, user.id, {
      priority: 'urgent',
      status: 'cancelled',
      title: 'Cancelled',
    })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'get_prioritized_issues', arguments: { includeNotReady: true } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const data = parseNativeMcpText(res.result.content[0].text, IssueTitlesResponse)
    const titles = data.issues.map((issue) => issue.title)
    expect(titles).toContain('Open')
    expect(titles).not.toContain('Done')
    expect(titles).not.toContain('Cancelled')
  })

  test('get_prioritized_issues respects limit parameter', async () => {
    const { user } = await seedFixture()
    for (let index = 0; index < 5; index++) {
      await seedIssue(workspaceId, projectId, user.id, { title: `Issue ${index}` })
    }

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'get_prioritized_issues', arguments: { limit: 2, includeNotReady: true } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const data = parseNativeMcpText(
      res.result.content[0].text,
      Schema.Struct({ issues: Schema.Array(Schema.Unknown).pipe(Schema.mutable) }),
    )
    expect(data.issues).toHaveLength(2)
  })

  test('get_prioritized_issues boosts issues with higher in-degree', async () => {
    const { user } = await seedFixture()
    const target = await seedIssue(workspaceId, projectId, user.id, {
      priority: 'none',
      title: 'Target',
    })
    const blocker = await seedIssue(workspaceId, projectId, user.id, {
      priority: 'none',
      title: 'Blocker',
    })

    // Target is blocked by blocker → target gets in-degree 1
    await fetchNativeApi(`http://localhost/api/issues/${blocker.id}/links`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ targetIssueId: target.id, type: 'blocks' }),
    })

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'get_prioritized_issues', arguments: { includeNotReady: true } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const data = parseNativeMcpText(
      res.result.content[0].text,
      Schema.Struct({
        issues: Schema.Array(
          Schema.Struct({ _score_breakdown: Schema.Struct({ centrality: Schema.Number }), title: Schema.String }),
        ).pipe(Schema.mutable),
      }),
    )
    const targetRow = data.issues.find((issue) => issue.title === 'Target')
    const blockerRow = data.issues.find((issue) => issue.title === 'Blocker')
    expect(targetRow?._score_breakdown.centrality).toBe(1)
    expect(blockerRow?._score_breakdown.centrality).toBe(0)
  })

  test('get_prioritized_issues uses story points custom field in scoring', async () => {
    const { user } = await seedFixture()
    const fieldDef = await seedCustomFieldDef(workspaceId, {
      key: 'story_points',
      label: 'Story Points',
      type: 'number',
    })
    const small = await seedIssue(workspaceId, projectId, user.id, {
      priority: 'none',
      title: 'Small (1pt)',
    })
    const large = await seedIssue(workspaceId, projectId, user.id, {
      priority: 'none',
      title: 'Large (8pt)',
    })
    await seedCustomFieldValue(small.id, fieldDef.id, '1')
    await seedCustomFieldValue(large.id, fieldDef.id, '8')

    const res = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'get_prioritized_issues', arguments: { includeNotReady: true } },
      headers,
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const data = parseNativeMcpText(
      res.result.content[0].text,
      Schema.Struct({
        issues: Schema.Array(Schema.Struct({ _score: Schema.Number, title: Schema.String })).pipe(Schema.mutable),
      }),
    )
    const smallRow = data.issues.find((issue) => issue.title === 'Small (1pt)')
    const largeRow = data.issues.find((issue) => issue.title === 'Large (8pt)')
    // Smaller story points → higher score (1/sp is larger for small sp)
    expect(smallRow!._score).toBeGreaterThan(largeRow!._score)
  })
})
