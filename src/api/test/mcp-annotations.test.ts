/*
 * PROJ-887 — MCP tool annotations (readOnlyHint / destructiveHint / idempotentHint /
 * openWorldHint) on every core tool, and their presence on the `tools/list` wire
 * response.
 */
import { Predicate } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { capabilityForMcpTool } from '#api/auth/scopes.ts'
import { DESTRUCTIVE_TOOLS } from '#api/mcp/annotations.ts'
import { coreMCPTools } from '#api/routes/mcp.ts'

import { authHeaders, seedFixture } from './helpers.ts'
import type { JsonRpcResult } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'

describe('covers MCP tool annotations (PROJ-887)', () => {
  test('every core tool declares readOnlyHint and openWorldHint', () => {
    const missing = coreMCPTools.filter(
      (tool) =>
        Predicate.isNullish(tool.annotations?.readOnlyHint) || Predicate.isNullish(tool.annotations?.openWorldHint),
    )
    expect(missing.map((tool) => tool.name)).toStrictEqual([])
  })

  test('openWorldHint is false on every core tool', () => {
    const wrong = coreMCPTools.filter((tool) => tool.annotations?.openWorldHint !== false)
    expect(wrong.map((tool) => tool.name)).toStrictEqual([])
  })

  test('every read-capability tool is annotated readOnlyHint: true', () => {
    const wrong = coreMCPTools.filter(
      (tool) => capabilityForMcpTool(tool.name) === 'read' && tool.annotations?.readOnlyHint !== true,
    )
    expect(wrong.map((tool) => tool.name)).toStrictEqual([])
  })

  test('readOnlyHint: true only on read-capability tools (never auto-approve a write)', () => {
    const wrong = coreMCPTools.filter(
      (tool) => tool.annotations?.readOnlyHint === true && capabilityForMcpTool(tool.name) !== 'read',
    )
    expect(wrong.map((tool) => tool.name)).toStrictEqual([])
  })

  test('update_wiki_page is not claimed idempotent (each save adds a revision)', () => {
    const t = coreMCPTools.find((tool) => tool.name === 'update_wiki_page')
    expect(t?.annotations?.idempotentHint).not.toBe(true)
  })

  test('every non-read (write-capability) tool declares destructiveHint', () => {
    const missing = coreMCPTools.filter(
      (tool) => capabilityForMcpTool(tool.name) === 'write' && Predicate.isNullish(tool.annotations?.destructiveHint),
    )
    expect(missing.map((tool) => tool.name)).toStrictEqual([])
  })

  test('the destructive set matches exactly the 22 tools from the ticket/wiki', () => {
    const actualDestructive = coreMCPTools
      .filter((tool) => tool.annotations?.destructiveHint === true)
      .map((tool) => tool.name)
      .sort()
    expect(actualDestructive).toEqual([...DESTRUCTIVE_TOOLS].toSorted())
    expect(actualDestructive).toHaveLength(22)
  })

  test('no non-destructive tool is marked destructiveHint: true, and vice versa', () => {
    const destructiveSet = new Set(DESTRUCTIVE_TOOLS)
    const mismatched = coreMCPTools.filter(
      (tool) => Boolean(tool.annotations?.destructiveHint) !== destructiveSet.has(tool.name),
    )
    expect(mismatched.map((t) => t.name)).toStrictEqual([])
  })
})

describe('tools/list response carries annotations (PROJ-887)', () => {
  test('returns readOnlyHint/openWorldHint/destructiveHint in the wire payload', async () => {
    const fixture = await seedFixture()
    const headers = authHeaders(fixture.token, fixture.workspace.slug)
    const res = (await fetchNativeApi(
      `http://localhost/mcp/${fixture.workspace.id}`,
      requestOptionsWithBody(
        'POST',
        headers,
        JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/list', params: {} }),
      ),
    ).then((response) => response.json())) as JsonRpcResult<{
      tools: { name: string; annotations?: Record<string, unknown> }[]
    }>

    const listIssues = res.result.tools.find((tool) => tool.name === 'list_issues')
    expect(listIssues?.annotations).toMatchObject({ openWorldHint: false, readOnlyHint: true })

    const deleteIssue = res.result.tools.find((tool) => tool.name === 'delete_issue')
    expect(deleteIssue?.annotations).toMatchObject({
      destructiveHint: true,
      openWorldHint: false,
      readOnlyHint: false,
    })

    // Every tool in the wire response must carry annotations at all.
    const missing = res.result.tools.filter((tool) => Predicate.isNullish(tool.annotations))
    expect(missing.map((tool) => tool.name)).toStrictEqual([])
  })
})
