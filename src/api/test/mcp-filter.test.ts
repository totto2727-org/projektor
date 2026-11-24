import { Iterable } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { TOOL_COUNT, TOOL_DOMAIN_SLUGS } from '#api/mcp/catalog.ts'

import { authHeaders, seedFixture } from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'

const mcpFetch = async function mcpFetch(
  workspaceId: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
  query = '',
): Promise<Response> {
  return fetchNativeApi(
    `http://localhost/mcp/${workspaceId}${query}`,
    requestOptionsWithBody('POST', headers, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })),
  )
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

describe('covers MCP tools/list domain filtering (PROJ-716)', () => {
  type TestData = Readonly<{
    headers: Record<string, string>
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedFixture()
    const workspaceId = fixture.workspace.id
    const headers = authHeaders(fixture.token, fixture.workspace.slug)
    return { headers, workspaceId }
  }

  test('no domains param returns the full unfiltered catalog', async () => {
    const { headers, workspaceId } = await seedTestData()
    const res = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    expect(res.result.tools).toHaveLength(TOOL_COUNT)
  })

  test("filters to the requested domain's tools only", async () => {
    const { headers, workspaceId } = await seedTestData()
    const res = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=issues',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    const names = res.result.tools.map((tool) => tool.name)
    expect(names).toContain('get_issue')
    expect(names).toContain('list_issues')
    expect(names).not.toContain('get_wiki_page')
    expect(names.length).toBeLessThan(TOOL_COUNT)
  })

  test('unions tools across multiple requested domains', async () => {
    const { headers, workspaceId } = await seedTestData()
    const res = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=issues,wiki',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    const names = res.result.tools.map((tool) => tool.name)
    expect(names).toContain('get_issue')
    expect(names).toContain('get_wiki_page')
  })

  test('dedupes repeated slugs and ignores order', async () => {
    const { headers, workspaceId } = await seedTestData()
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
    expect(dupRes.result.tools.map((tool) => tool.name).sort()).toStrictEqual(
      straightRes.result.tools.map((tool) => tool.name).sort(),
    )

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
    expect(forwardRes.result.tools.map((tool) => tool.name).sort()).toStrictEqual(
      reversedRes.result.tools.map((tool) => tool.name).sort(),
    )
  })

  test('unknown domain slug returns 400 naming valid domains, never a silent full catalog', async () => {
    const { headers, workspaceId } = await seedTestData()
    const res = await mcpFetch(workspaceId, 'tools/list', {}, headers, '?domains=not-a-domain')
    expect(res.status).toBe(400)
    const body = (await res.json()) as JsonRpcError
    expect(body.error.message).toContain('not-a-domain')
    Iterable.forEach(TOOL_DOMAIN_SLUGS, (slug) => {
      expect(body.error.message).toContain(slug)
    })
  })

  test('one unknown slug among valid ones still 400s (fail closed)', async () => {
    const { headers, workspaceId } = await seedTestData()
    const res = await mcpFetch(workspaceId, 'tools/list', {}, headers, '?domains=issues,bogus-domain')
    expect(res.status).toBe(400)
  })

  test('blank domains param behaves like no filter', async () => {
    const { headers, workspaceId } = await seedTestData()
    const res = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    expect(res.result.tools).toHaveLength(TOOL_COUNT)
  })

  test('tools/call still serves a tool that was filtered out of the listing', async () => {
    const { headers, workspaceId } = await seedTestData()
    const listRes = (await mcpCall<{ tools: { name: string }[] }>(
      workspaceId,
      'tools/list',
      {},
      headers,
      '?domains=issues',
    )) as JsonRpcResult<{ tools: { name: string }[] }>
    expect(listRes.result.tools.map((tool) => tool.name)).not.toContain('get_wiki_page')

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
