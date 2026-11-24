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
import { fetchNativeApi } from './native-fetch.ts'

describe('covers MCP tool annotations (PROJ-887)', () => {
  test('every core tool declares readOnlyHint and openWorldHint', () => {
    const missing = coreMCPTools.filter(
      (t) => Predicate.isNullish(t.annotations?.readOnlyHint) || Predicate.isNullish(t.annotations?.openWorldHint),
    )
    expect(missing.map((t) => t.name)).toEqual([])
  })

  test('openWorldHint is false on every core tool', () => {
    const wrong = coreMCPTools.filter((t) => t.annotations?.openWorldHint !== false)
    expect(wrong.map((t) => t.name)).toEqual([])
  })

  test('every read-capability tool is annotated readOnlyHint: true', () => {
    const wrong = coreMCPTools.filter(
      (t) => capabilityForMcpTool(t.name) === 'read' && t.annotations?.readOnlyHint !== true,
    )
    expect(wrong.map((t) => t.name)).toEqual([])
  })

  test('readOnlyHint: true only on read-capability tools (never auto-approve a write)', () => {
    const wrong = coreMCPTools.filter(
      (t) => t.annotations?.readOnlyHint === true && capabilityForMcpTool(t.name) !== 'read',
    )
    expect(wrong.map((t) => t.name)).toEqual([])
  })

  test('update_wiki_page is not claimed idempotent (each save adds a revision)', () => {
    const t = coreMCPTools.find((x) => x.name === 'update_wiki_page')
    expect(t?.annotations?.idempotentHint).not.toBe(true)
  })

  test('every non-read (write-capability) tool declares destructiveHint', () => {
    const missing = coreMCPTools.filter(
      (t) => capabilityForMcpTool(t.name) === 'write' && Predicate.isNullish(t.annotations?.destructiveHint),
    )
    expect(missing.map((t) => t.name)).toEqual([])
  })

  test('the destructive set matches exactly the 22 tools from the ticket/wiki', () => {
    const actualDestructive = coreMCPTools
      .filter((t) => t.annotations?.destructiveHint === true)
      .map((t) => t.name)
      .sort()
    expect(actualDestructive).toEqual([...DESTRUCTIVE_TOOLS].toSorted())
    expect(actualDestructive).toHaveLength(22)
  })

  test('no non-destructive tool is marked destructiveHint: true, and vice versa', () => {
    const destructiveSet = new Set(DESTRUCTIVE_TOOLS)
    const mismatched = coreMCPTools.filter(
      (t) => Boolean(t.annotations?.destructiveHint) !== destructiveSet.has(t.name),
    )
    expect(mismatched.map((t) => t.name)).toEqual([])
  })
})

describe('tools/list response carries annotations (PROJ-887)', () => {
  test('returns readOnlyHint/openWorldHint/destructiveHint in the wire payload', async () => {
    const fixture = await seedFixture()
    const headers = authHeaders(fixture.token, fixture.workspace.slug)
    const res = (await fetchNativeApi(`http://localhost/mcp/${fixture.workspace.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/list', params: {} }),
    }).then((response) => response.json())) as JsonRpcResult<{
      tools: { name: string; annotations?: Record<string, unknown> }[]
    }>

    const listIssues = res.result.tools.find((t) => t.name === 'list_issues')
    expect(listIssues?.annotations).toMatchObject({ openWorldHint: false, readOnlyHint: true })

    const deleteIssue = res.result.tools.find((t) => t.name === 'delete_issue')
    expect(deleteIssue?.annotations).toMatchObject({
      destructiveHint: true,
      openWorldHint: false,
      readOnlyHint: false,
    })

    // Every tool in the wire response must carry annotations at all.
    const missing = res.result.tools.filter((t) => Predicate.isNullish(t.annotations))
    expect(missing.map((t) => t.name)).toEqual([])
  })
})
