import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { TOOL_COUNT, TOOL_DOMAIN_SLUGS } from '../mcp/catalog.ts'
import { authHeaders, seedFixture } from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'

async function mcpFetch(
  workspaceId: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
  query = '',
): Promise<Response> {
  return SELF.fetch(`http://localhost/mcp/${workspaceId}${query}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
}

async function mcpCall<T>(
  workspaceId: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
  query = '',
): Promise<JsonRpcResult<T> | JsonRpcError> {
  const res = await mcpFetch(workspaceId, method, params, headers, query)
  return res.json()
}

describe('MCP tools/list domain filtering (PROJ-716)', () => {
  let workspaceId: string
  let headers: Record<string, string>

  beforeEach(async () => {
    const fixture = await seedFixture()
    workspaceId = fixture.workspace.id
    headers = authHeaders(fixture.token, fixture.workspace.slug)
  })

  test('no domains param returns the full unfiltered catalog', async () => {
    const res = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    expect(res.result.tools.length).toBe(TOOL_COUNT)
  })

  test("filters to the requested domain's tools only", async () => {
    const res = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=issues',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    const names = res.result.tools.map((t) => t.name)
    expect(names).toContain('get_issue')
    expect(names).toContain('list_issues')
    expect(names).not.toContain('get_wiki_page')
    expect(names.length).toBeLessThan(TOOL_COUNT)
  })

  test('unions tools across multiple requested domains', async () => {
    const res = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=issues,wiki',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    const names = res.result.tools.map((t) => t.name)
    expect(names).toContain('get_issue')
    expect(names).toContain('get_wiki_page')
  })

  test('dedupes repeated slugs and ignores order', async () => {
    const dupRes = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=issues,issues,issues',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    const straightRes = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=issues',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    expect(dupRes.result.tools.map((t) => t.name).sort()).toEqual(straightRes.result.tools.map((t) => t.name).sort())

    const forwardRes = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=issues,wiki',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    const reversedRes = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=wiki,issues',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    expect(forwardRes.result.tools.map((t) => t.name).sort()).toEqual(
      reversedRes.result.tools.map((t) => t.name).sort(),
    )
  })

  test('unknown domain slug returns 400 naming valid domains, never a silent full catalog', async () => {
    const res = await mcpFetch(workspaceId, 'tools/list', {}, headers, '?domains=not-a-domain')
    expect(res.status).toBe(400)
    const body = (await res.json()) as JsonRpcError
    expect(body.error.message).toContain('not-a-domain')
    for (const slug of TOOL_DOMAIN_SLUGS) {
      expect(body.error.message).toContain(slug)
    }
  })

  test('one unknown slug among valid ones still 400s (fail closed)', async () => {
    const res = await mcpFetch(workspaceId, 'tools/list', {}, headers, '?domains=issues,bogus-domain')
    expect(res.status).toBe(400)
  })

  test('blank domains param behaves like no filter', async () => {
    const res = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    expect(res.result.tools.length).toBe(TOOL_COUNT)
  })

  test('tools/call still serves a tool that was filtered out of the listing', async () => {
    const listRes = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=issues',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    expect(listRes.result.tools.map((t) => t.name)).not.toContain('get_wiki_page')

    const callRes = (await mcpCall<{ content: { text: string }[] }>(
      workspaceId,
      'tools/call',
      { name: 'search_wiki', arguments: { query: '' } },
      headers,
      '?domains=issues',
    )) as JsonRpcResult<{ content: { text: string }[] }>
    expect(callRes.result.content[0].text).toBeDefined()
  })
})
