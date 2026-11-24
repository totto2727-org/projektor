/*
 * PROJ-893: a failed tools/call is a tool *result* (`isError: true`) with a code and a
 * next-step hint, so the model can self-correct. JSON-RPC errors are reserved for protocol
 * faults; scope denials stay an HTTP 403 with a WWW-Authenticate challenge (PROJ-651).
 */
import { Predicate } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test'

import { env } from './fixture-api.ts'
import { seedIssueFixture, seedProjectFixture, seedToken, toolError } from './helpers.ts'
import type { ToolErrorBody } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { IdListResponse, SlugResponse, parseNativeMcpText } from './response-json.ts'

interface Rpc {
  error?: { code: number; message: string }
  result?: { isError?: boolean; content?: { text: string }[] }
}

describe('covers PROJ-893: MCP tool failures are isError results', () => {
  // This suite makes more calls per token than vite.config.ts's RATE_LIMIT_API_MAX.
  const prevApiMax = env.RATE_LIMIT_API_MAX
  beforeAll(() => {
    env.RATE_LIMIT_API_MAX = '1000'
  })
  afterAll(() => {
    env.RATE_LIMIT_API_MAX = prevApiMax
  })

  let f: Awaited<ReturnType<typeof seedIssueFixture>>
  beforeEach(async () => {
    f = await seedIssueFixture({ role: 'owner' })
  })

  const post = async function post(body: unknown, token = f.token): Promise<Response> {
    return fetchNativeApi(
      `http://localhost/mcp/${f.workspaceId}`,
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        Predicate.isString(body) ? body : JSON.stringify(body),
      ),
    )
  }

  const call = async function call(name: string, args: unknown, token = f.token): Promise<Rpc> {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, token)
    expect(res.status).toBe(200)
    return (await res.json()) as Rpc
  }

  /** Asserts the failure is a tool result (not a JSON-RPC error) and returns its body. */
  const failure = async function failure(name: string, args: unknown, token = f.token): Promise<ToolErrorBody> {
    const res = await call(name, args, token)
    expect(res.error, 'must not be a JSON-RPC error').toBeUndefined()
    expect(res.result?.isError).toBe(true)
    const body = toolError(res)
    expect(body).toBeDefined()
    return body as ToolErrorBody
  }

  test('not_found on an issue ref: code, message, and a hint naming the ref format and search_issues', async () => {
    const toolFailure = await failure('get_issue', { ref: 'PROJ-99999' })
    expect(toolFailure.code).toBe('not_found')
    expect(toolFailure.message).toMatch(/not found/i)
    expect(toolFailure.hint).toContain('PROJ-42')
    expect(toolFailure.hint).toContain('search_issues')
  })

  test('not_found on a wiki slug: the hint points at search_wiki', async () => {
    const toolFailure = await failure('get_wiki_page', { slug: 'no-such-page' })
    expect(toolFailure.code).toBe('not_found')
    expect(toolFailure.hint).toContain('search_wiki')
  })

  test('not_found on an unknown agent session hints at register_agent, not at issue refs', async () => {
    const toolFailure = await failure('heartbeat_agent', { id: crypto.randomUUID() })
    expect(toolFailure.code).toBe('not_found')
    expect(toolFailure.hint).toContain('register_agent')
  })

  test('validation: the offending fields are named in `fields` and in the hint', async () => {
    const toolFailure = await failure('create_wiki_page', { title: '', content: 'x' })
    expect(toolFailure.code).toBe('validation')
    expect(Object.keys(toolFailure.fields ?? {})).toContain('title')
    expect(toolFailure.hint).toContain('title')
  })

  test('validation: a missing required argument is named', async () => {
    const toolFailure = await failure('get_project', {})
    expect(toolFailure.code).toBe('validation')
    expect(toolFailure.message).toMatch(/Missing required argument/u)
    expect(toolFailure.fields).toBeDefined()
    expect(toolFailure.hint).toMatch(/^Fix /u)
  })

  test('validation: a wrongly-typed argument is caught before the handler runs', async () => {
    const toolFailure = await failure('get_issue', { ref: 42 })
    expect(toolFailure.code).toBe('validation')
    expect(Object.keys(toolFailure.fields ?? {})).toContain('ref')
  })

  test('forbidden: the hint says what role is needed', async () => {
    const viewer = await seedProjectFixture({ role: 'viewer' })
    const res = await fetchNativeApi(
      `http://localhost/mcp/${viewer.workspaceId}`,
      requestOptionsWithBody(
        'POST',
        { Authorization: `Bearer ${viewer.token}`, 'Content-Type': 'application/json' },
        JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { arguments: { name: 'Nope', key: 'NOPE' }, name: 'create_project' },
        }),
      ),
    )
    const body = (await res.json()) as Rpc
    expect(body.error).toBeUndefined()
    const problem = toolError(body)
    expect(problem?.code).toBe('forbidden')
    expect(problem?.hint).toContain('viewer')
  })

  test('conflict on a stale wiki save: re-read, then patch_wiki_page — and the current revision is in details', async () => {
    const created = parseNativeMcpText(
      (await call('create_wiki_page', { title: 'Locked Doc', content: 'v1' })).result?.content?.[0].text ?? '{}',
      SlugResponse,
    )
    await call('update_wiki_page', { slug: created.slug, content: 'v2' })
    const revisions = parseNativeMcpText(
      (await call('list_wiki_revisions', { slug: created.slug })).result?.content?.[0].text ?? '[]',
      IdListResponse,
    )
    const stale = revisions[0].id
    await call('update_wiki_page', { slug: created.slug, content: 'v3', baseRevisionId: stale })

    const toolFailure = await failure('update_wiki_page', {
      slug: created.slug,
      content: 'v4',
      baseRevisionId: stale,
    })
    expect(toolFailure.code).toBe('conflict')
    expect(toolFailure.hint).toContain('get_wiki_page')
    expect(toolFailure.hint).toContain('patch_wiki_page')
    expect(toolFailure.details?.currentRevisionId).toBeTypeOf('string')
  })

  test('a successful call is not flagged', async () => {
    const res = await call('get_issue', { ref: `PROJ-1` })
    expect(res.error).toBeUndefined()
    expect(res.result?.isError).toBeUndefined()
  })

  describe('covers JSON-RPC errors stay reserved for protocol faults', () => {
    test('an unknown tool is a -32601 protocol error, not an isError result', async () => {
      const res = await call('no_such_tool', {})
      expect(res.error?.code).toBe(-32_601)
      expect(res.result).toBeUndefined()
    })

    test('an unknown method is -32601', async () => {
      const resResponse = await post({ jsonrpc: '2.0', id: 1, method: 'nope/nope' })
      const res = (await resResponse.json()) as Rpc
      expect(res.error?.code).toBe(-32_601)
    })

    test('malformed JSON is a -32700 parse error', async () => {
      const res = await post('{ not json')
      expect(res.status).toBe(400)
      expect(((await res.json()) as Rpc).error?.code).toBe(-32_700)
    })

    test('a body that is not a request object is a -32600 invalid request', async () => {
      const res = await post([1, 2, 3])
      expect(res.status).toBe(400)
      expect(((await res.json()) as Rpc).error?.code).toBe(-32_600)
    })

    test('a tools/call with no tool name is a -32602 invalid-params protocol error', async () => {
      const resResponse = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} })
      const res = (await resResponse.json()) as Rpc
      expect(res.error?.code).toBe(-32_602)
    })
  })

  test('a scope denial stays an HTTP 403 with a WWW-Authenticate challenge', async () => {
    const readOnly = await seedToken(f.workspaceId, f.userId, { scopes: ['read'] })
    const res = await post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_issue', arguments: { projectId: f.projectId, title: 'x' } },
      },
      readOnly,
    )
    expect(res.status).toBe(403)
    expect(res.headers.get('WWW-Authenticate')).toBeTruthy()
    const body = (await res.json()) as Rpc
    expect(body.error?.code).toBe(-32_003)
    expect(body.result).toBeUndefined()
  })
})
