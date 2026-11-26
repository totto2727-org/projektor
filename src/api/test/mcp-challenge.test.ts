import { Iterable } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'

import { seedFixture, seedToken } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'

/*
 * PROJ-651: RFC 9728 WWW-Authenticate challenges on the MCP endpoint.
 *
 * The challenge is the only discovery entry point an MCP client has, and Anthropic
 * is explicit that Claude does not honour the header on a non-401 response. So these
 * tests care about two things a JSON-body assertion cannot see: the transport-level
 * status, and the header riding on it.
 *
 * A realistic https host throughout — resource_metadata is a URL built from the
 * request, and a localhost assertion would not catch an origin-derivation bug.
 */
const HOST = 'https://projektor.example.com'

const mcpUrl = function mcpUrl(workspaceId: string): string {
  return `${HOST}/mcp/${workspaceId}`
}

const rpc = function rpc(method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
}

/**
 * Parse `Bearer k="v", k2="v2"` into a map, so tests assert on values not substrings.
 *
 * @param {string | null} header The authentication challenge header returned by the MCP endpoint.
 * @returns {Record<string, string>} The decoded Bearer challenge parameters by name.
 */
const parseChallenge = function parseChallenge(header: string | null): Record<string, string> {
  expect(isNonEmptyText(header)).toBe(true)
  const bearer = header as string
  expect(bearer.startsWith('Bearer ')).toBe(true)
  const out: Record<string, string> = {}
  Iterable.forEach(bearer.slice(7).matchAll(/([a-z_]+)="((?:[^"\\]|\\.)*)"/g), ([, key, value]) => {
    out[key] = value.replaceAll(/\\(.)/g, '$1')
  })
  return out
}

describe('covers MCP 401 carries an RFC 9728 challenge', () => {
  type TestData = Readonly<{
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedFixture()
    const workspaceId = fixture.workspace.id
    return { workspaceId }
  }

  test('points at the per-workspace protected resource metadata document', async () => {
    const { workspaceId } = await seedTestData()
    const res = await fetchNativeApi(mcpUrl(workspaceId), {
      body: rpc('initialize'),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(res.status).toBe(401)
    const challenge = parseChallenge(res.headers.get('WWW-Authenticate'))
    // Per-workspace, not origin-level: Claude matches the PRM document's
    // `resource` against the URL the user typed, path component included.
    expect(challenge.resource_metadata).toBe(`${HOST}/.well-known/oauth-protected-resource/mcp/${workspaceId}`)
    expect(challenge.scope).toBe('projektor:read projektor:write')
  })

  test('derives resource_metadata from the request host, not a fixed origin', async () => {
    const { workspaceId } = await seedTestData()
    const other = 'https://tenant.projektor.dev'
    const res = await fetchNativeApi(`${other}/mcp/${workspaceId}`, {
      body: rpc('initialize'),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    const challenge = parseChallenge(res.headers.get('WWW-Authenticate'))
    expect(challenge.resource_metadata).toBe(`${other}/.well-known/oauth-protected-resource/mcp/${workspaceId}`)
  })

  test('challenges an invalid bearer token too, not just a missing one', async () => {
    const { workspaceId } = await seedTestData()
    const res = await fetchNativeApi(mcpUrl(workspaceId), {
      body: rpc('initialize'),
      headers: { Authorization: 'Bearer tok_not_a_real_token', 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata=')
  })
})

describe('/api/* 401s are unchanged', () => {
  /*
   * PROJ-430: the frontend reloads the page to re-authenticate on a 401, so the
   * shape of an /api/* 401 is load-bearing. The challenge must not leak onto it.
   */
  test('carries no WWW-Authenticate header and the same bare body', async () => {
    const res = await fetchNativeApi(`${HOST}/api/projects`)

    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBeNull()
    await expect(res.json()).resolves.toStrictEqual({ error: 'Unauthorized' })
  })

  test('is unchanged for an invalid bearer token as well', async () => {
    const res = await fetchNativeApi(`${HOST}/api/projects`, {
      headers: { Authorization: 'Bearer tok_not_a_real_token' },
    })

    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBeNull()
  })
})

describe('insufficient scope is a 403 challenge, not a 200 with a JSON-RPC error', () => {
  let workspaceId: string
  let readToken: string

  beforeEach(async () => {
    const fixture = await seedFixture()
    workspaceId = fixture.workspace.id
    readToken = await seedToken(fixture.workspace.id, fixture.user.id, { scopes: ['read'] })
  })

  const callAsReadToken = async function callAsReadToken(method: string, params: unknown): Promise<Response> {
    return fetchNativeApi(
      mcpUrl(workspaceId),
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${readToken}`, 'Content-Type': 'application/json' },
        rpc(method, params),
      ),
    )
  }

  test('returns 403 with error=insufficient_scope on a write tool', async () => {
    const res = await callAsReadToken('tools/call', {
      name: 'create_project',
      arguments: { name: 'nope', key: 'NOPE' },
    })

    /*
     * The status is the point. A 200 carrying a JSON-RPC error is invisible to
     * the client's step-up flow: Claude hands the text to the model as a tool
     * result and moves on, so the user reads "please sign in" prose in the chat
     * instead of being offered a Connect button.
     */
    expect(res.status).toBe(403)

    const challenge = parseChallenge(res.headers.get('WWW-Authenticate'))
    expect(challenge.error).toBe('insufficient_scope')
    expect(challenge.resource_metadata).toBe(`${HOST}/.well-known/oauth-protected-resource/mcp/${workspaceId}`)
    /*
     * All scopes in one go — challenging incrementally would force a second
     * consent round-trip the moment the client touched another operation.
     */
    expect(challenge.scope).toBe('projektor:read projektor:write')
  })

  test('keeps the JSON-RPC -32003 body so existing pk_ token callers are unaffected', async () => {
    const res = await callAsReadToken('tools/call', {
      name: 'create_project',
      arguments: { name: 'nope', key: 'NOPE' },
    })

    const body = await res.json<{ error: { code: number; message: string } }>()
    expect(body.error.code).toBe(-32_003)
    expect(body.error.message).toBe("Token lacks 'write' scope")
  })

  test('treats prompts/get the same way — it is gated by the same scope check', async () => {
    const res = await callAsReadToken('prompts/get', { name: 'epic-goal', arguments: {} })

    expect(res.status).toBe(403)
    expect(parseChallenge(res.headers.get('WWW-Authenticate')).error).toBe('insufficient_scope')
  })

  test('still allows a read tool through on 200 with no challenge', async () => {
    const res = await callAsReadToken('tools/call', {
      name: 'list_projects',
      arguments: {},
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('WWW-Authenticate')).toBeNull()
  })
})
