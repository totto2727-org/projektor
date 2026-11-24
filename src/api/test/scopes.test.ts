import { Iterable } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  capabilityForMcpTool,
  capabilityForMethod,
  capabilityForOAuthScope,
  OAUTH_SCOPES_SUPPORTED,
  parseScopes,
  tokenAllows,
} from '#api/auth/scopes.ts'
/**
 * PROJ-17 — API-token scope enforcement.
 *
 * Covers:
 *  - the pure scope helpers (auth/scopes.ts),
 *  - REST enforcement (read token blocked from writes, write/`*` allowed),
 *  - MCP per-tool enforcement (read token blocked from write tools),
 *  - scope validation + membership check at token creation (/auth/tokens).
 */
import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedProject, seedToken, seedUser, seedWorkspace } from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

/** Seed a workspace + owner + a project in it, for scope-enforcement tests. */
const seedScopeFixture = async function seedScopeFixture() {
  const ws = await seedWorkspace(`ws-${crypto.randomUUID().slice(0, 8)}`)
  const user = await seedUser(`u-${crypto.randomUUID().slice(0, 8)}@example.com`)
  await env.DB.prepare(
    "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
  )
    .bind(ws.id, user.id, currentEpochSeconds())
    .run()
  const project = await seedProject(ws.id)
  return { slug: ws.slug, workspaceId: ws.id, userId: user.id, projectId: project.id }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('covers PROJ-17: scope helpers', () => {
  test("tokenAllows: '*' grants everything", () => {
    expect(tokenAllows(['*'], 'read')).toBe(true)
    expect(tokenAllows(['*'], 'write')).toBe(true)
  })

  test("tokenAllows: 'write' implies 'read'", () => {
    expect(tokenAllows(['write'], 'write')).toBe(true)
    expect(tokenAllows(['write'], 'read')).toBe(true)
  })

  test("tokenAllows: 'read' permits reads only", () => {
    expect(tokenAllows(['read'], 'read')).toBe(true)
    expect(tokenAllows(['read'], 'write')).toBe(false)
  })

  test('tokenAllows: unknown/empty scopes grant nothing (fail-closed)', () => {
    expect(tokenAllows([], 'read')).toBe(false)
    expect(tokenAllows(['bogus'], 'read')).toBe(false)
    expect(tokenAllows(['bogus'], 'write')).toBe(false)
  })

  test('capabilityForMethod: safe methods read, others write', () => {
    expect(capabilityForMethod('GET')).toBe('read')
    expect(capabilityForMethod('HEAD')).toBe('read')
    expect(capabilityForMethod('POST')).toBe('write')
    expect(capabilityForMethod('patch')).toBe('write')
    expect(capabilityForMethod('DELETE')).toBe('write')
  })

  test('capabilityForMcpTool: list/get/search/wiki_tree read, rest write', () => {
    expect(capabilityForMcpTool('list_issues')).toBe('read')
    expect(capabilityForMcpTool('get_prioritized_issues')).toBe('read')
    expect(capabilityForMcpTool('search_wiki')).toBe('read')
    expect(capabilityForMcpTool('wiki_tree')).toBe('read')
    expect(capabilityForMcpTool('create_issue')).toBe('write')
    expect(capabilityForMcpTool('add_comment')).toBe('write')
    expect(capabilityForMcpTool('delete_wiki_page')).toBe('write')
  })

  test('parseScopes: parses JSON arrays, fails closed on garbage', () => {
    expect(parseScopes('["read","write"]')).toStrictEqual(['read', 'write'])
    expect(parseScopes(null)).toStrictEqual([])
    expect(parseScopes('not json')).toStrictEqual([])
    expect(parseScopes('{"a":1}')).toStrictEqual([])
    expect(parseScopes('["read",2,null]')).toStrictEqual(['read'])
  })

  test('parseScopes: accepts the legacy unquoted bracketed format', () => {
    // Some early tokens stored "[read,write]" (not valid JSON) — must still work.
    expect(parseScopes('[read,write]')).toStrictEqual(['read', 'write'])
    expect(parseScopes('[ read , write ]')).toStrictEqual(['read', 'write'])
    expect(parseScopes('[]')).toStrictEqual([])
    // Round-trips through tokenAllows as a real write-capable token.
    expect(tokenAllows(parseScopes('[read,write]'), 'write')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// REST enforcement
// ---------------------------------------------------------------------------

describe('covers PROJ-17: REST scope enforcement', () => {
  let slug: string
  let projectId: string
  let userId: string
  let workspaceId: string

  beforeEach(async () => {
    ;({ slug, workspaceId, userId, projectId } = await seedScopeFixture())
  })

  test('read-only token can GET but not POST', async () => {
    const token = await seedToken(workspaceId, userId, { scopes: ['read'] })
    const headers = authHeaders(token, slug)

    const getRes = await fetchNativeApi('http://localhost/api/issues', { headers })
    expect(getRes.status).toBe(200)

    const postRes = await fetchNativeApi('http://localhost/api/issues', {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectId, title: 'should be blocked' }),
    })
    expect(postRes.status).toBe(403)
    await expect(postRes.json()).resolves.toMatchObject({ error: expect.stringContaining('write') })
  })

  test('write token can POST', async () => {
    const token = await seedToken(workspaceId, userId, { scopes: ['write'] })
    const res = await fetchNativeApi('http://localhost/api/issues', {
      body: JSON.stringify({ projectId, title: 'written by write token' }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
  })

  test('wildcard token can both read and write', async () => {
    const token = await seedToken(workspaceId, userId, { scopes: ['*'] })
    const headers = authHeaders(token, slug)

    const response = await fetchNativeApi('http://localhost/api/issues', { headers })
    expect(response.status).toBe(200)
    const postRes = await fetchNativeApi('http://localhost/api/issues', {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectId, title: 'written by wildcard token' }),
    })
    expect(postRes.status).toBe(201)
  })

  test('read token is blocked from DELETE', async () => {
    const token = await seedToken(workspaceId, userId, { scopes: ['read'] })
    const res = await fetchNativeApi(`http://localhost/api/issues/${crypto.randomUUID()}`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// MCP enforcement
// ---------------------------------------------------------------------------

const mcpCall = async function mcpCall(
  workspaceId: string,
  name: string,
  args: unknown,
  headers: Record<string, string>,
): Promise<JsonRpcResult | JsonRpcError> {
  const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  return res.json()
}

const isMcpError = function isMcpError(rpc: JsonRpcResult | JsonRpcError): rpc is JsonRpcError {
  return 'error' in rpc
}

describe('covers PROJ-17: MCP scope enforcement', () => {
  let slug: string
  let projectId: string
  let userId: string
  let workspaceId: string

  beforeEach(async () => {
    ;({ slug, workspaceId, userId, projectId } = await seedScopeFixture())
  })

  test('read token: read tool works, write tool is blocked', async () => {
    const token = await seedToken(workspaceId, userId, { scopes: ['read'] })
    const headers = authHeaders(token, slug)

    const listed = await mcpCall(workspaceId, 'list_issues', {}, headers)
    expect(isMcpError(listed)).toBe(false)

    const created = await mcpCall(workspaceId, 'create_issue', { projectId, title: 'blocked' }, headers)
    expect(isMcpError(created)).toBe(true)
    if (isMcpError(created)) {
      expect(created.error.code).toBe(-32_003)
      expect(created.error.message).toContain('write')
    }
  })

  test('write token: write tool works', async () => {
    const token = await seedToken(workspaceId, userId, { scopes: ['write'] })
    const created = await mcpCall(
      workspaceId,
      'create_issue',
      { projectId, title: 'made via mcp' },
      authHeaders(token, slug),
    )
    expect(isMcpError(created)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Token creation: scope validation + membership (POST /auth/tokens)
// ---------------------------------------------------------------------------

describe('covers PROJ-17: POST /auth/tokens', () => {
  let workspaceId: string
  let userId: string
  let prevDevEmail: string | undefined

  // PROJ-903: minting requires a human session — the dev bypass here.
  afterEach(() => {
    env.DEV_USER_EMAIL = prevDevEmail as string
  })

  beforeEach(async () => {
    const ws = await seedWorkspace(`ws-${crypto.randomUUID().slice(0, 8)}`)
    workspaceId = ws.id
    const email = `u-${crypto.randomUUID().slice(0, 8)}@example.com`
    const user = await seedUser(email)
    userId = user.id
    await env.DB.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    )
      .bind(workspaceId, userId, currentEpochSeconds())
      .run()
    prevDevEmail = env.DEV_USER_EMAIL
    env.DEV_USER_EMAIL = email
  })

  test('a member can mint a token for their workspace', async () => {
    const res = await fetchNativeApi('http://localhost/auth/tokens', {
      body: JSON.stringify({ name: 'mine', workspaceId, scopes: ['read'] }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ token: expect.any(String) })
  })

  test("minting a token for a workspace you don't belong to is forbidden", async () => {
    const other = await seedWorkspace(`ws-${crypto.randomUUID().slice(0, 8)}`)
    const res = await fetchNativeApi('http://localhost/auth/tokens', {
      body: JSON.stringify({ name: 'sneaky', workspaceId: other.id, scopes: ['*'] }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })

  test('rejects invalid scope values', async () => {
    const res = await fetchNativeApi('http://localhost/auth/tokens', {
      body: JSON.stringify({ name: 'bad', workspaceId, scopes: ['admin'] }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })
})

/*
 * PROJ-655: the OAuth wire names are a public contract — they ship in
 * `scopes_supported` on the discovery documents, which Claude caches globally by
 * URL across every user of an instance. Pinning them in a test makes a rename a
 * deliberate act rather than a refactor's collateral damage.
 */
describe('covers OAuth wire scope names (PROJ-655)', () => {
  test('advertises exactly the two namespaced scopes', () => {
    expect([...OAUTH_SCOPES_SUPPORTED]).toStrictEqual(['projektor:read', 'projektor:write'])
  })

  test('maps each wire scope to the capability it grants', () => {
    expect(capabilityForOAuthScope('projektor:read')).toBe('read')
    expect(capabilityForOAuthScope('projektor:write')).toBe('write')
  })

  test('fails closed on a scope it does not issue', () => {
    /*
     * Notably the bare internal names: they are NOT valid on the wire, so a
     * client that guesses them gets nothing rather than accidental read access.
     */
    Iterable.forEach(['read', 'write', '*', 'offline_access', 'projektor:admin', ''], (scope) => {
      expect(capabilityForOAuthScope(scope)).toBeNull()
    })
  })
})
