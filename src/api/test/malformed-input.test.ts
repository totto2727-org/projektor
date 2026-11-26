// PROJ-877: malformed JSON and missing params are client errors (400 / JSON-RPC
// -32700/-32600/-32602), never a 500 — and never reach app.onError.
import { describe, expect, onTestFinished, test, vi } from 'vite-plus/test'

import { authHeaders, seedIssueFixture, toolError } from './helpers.ts'
import { fetchNativeApi, stringifyOrderedFields } from './native-fetch.ts'
import { McpRpcResponse, readNativeJson } from './response-json.ts'

type IssueFixture = Awaited<ReturnType<typeof seedIssueFixture>>

const prepareMalformedInput = async function prepareMalformedInput(): Promise<IssueFixture> {
  const fixture = await seedIssueFixture({ role: 'owner' })
  const unhandled = vi.spyOn(console, 'error')
  onTestFinished(() => {
    const escaped = unhandled.mock.calls.filter((args: unknown[]) => args[0] === 'unhandled error')
    expect(escaped).toStrictEqual([])
    vi.restoreAllMocks()
  })
  return fixture
}

describe('covers REST: invalid JSON bodies → 400', () => {
  test.each([
    ['POST', '/api/issues'],
    ['PATCH', '/api/issues/:issueId'],
    ['POST', '/api/issues/:issueId/comments'],
    ['POST', '/api/projects'],
    ['POST', '/api/wiki'],
    ['POST', '/api/sprints'],
    ['POST', '/api/task-types'],
    ['POST', '/api/task-statuses'],
    ['POST', '/api/custom-fields'],
    ['POST', '/api/issues/:issueId/links'],
    ['POST', '/api/agents'],
    ['POST', '/api/file-claims'],
    ['POST', '/api/agent-messages'],
    /*
     * POST /api/workspaces/:slug/tokens needs a human session (PROJ-917); its
     * malformed-body case lives in workspace-tokens.test.ts.
     */
  ])('%s %s', async (method, path) => {
    const fixture = await prepareMalformedInput()
    const url = path.replace(':issueId', fixture.issueId).replace(':slug', fixture.slug)
    const res = await fetchNativeApi(`http://localhost${url}`, {
      body: '{bad json',
      headers: authHeaders(fixture.token, fixture.slug),
      method,
    })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/valid JSON/u)
  })
})

const errorCode = async function errorCode(res: Response): Promise<undefined | number> {
  const rpc = await readNativeJson(res, McpRpcResponse)
  return rpc.error?.code
}

const mcp = async function mcp(fixture: IssueFixture, body: string): Promise<Response> {
  return fetchNativeApi(`http://localhost/mcp/${fixture.workspaceId}`, {
    body,
    headers: { Authorization: `Bearer ${fixture.token}`, 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

describe('covers MCP: parse and envelope errors', () => {
  test('invalid JSON → -32700', async () => {
    const fixture = await prepareMalformedInput()
    const res = await mcp(fixture, '{bad')
    expect(res.status).toBe(400)
    await expect(errorCode(res)).resolves.toBe(-32_700)
  })

  test('not a request object → -32600', async () => {
    const fixture = await prepareMalformedInput()
    const res = await mcp(fixture, '[1,2,3]')
    await expect(errorCode(res)).resolves.toBe(-32_600)
  })

  test('tools/call with no params → -32602', async () => {
    const fixture = await prepareMalformedInput()
    const res = await mcp(
      fixture,
      stringifyOrderedFields([
        ['jsonrpc', '2.0'],
        ['id', 1],
        ['method', 'tools/call'],
      ]),
    )
    expect(res.status).toBe(200)
    await expect(errorCode(res)).resolves.toBe(-32_602)
  })

  test('tools/call get_project with no arguments → validation tool error naming the field', async () => {
    const fixture = await prepareMalformedInput()
    const res = await mcp(
      fixture,
      stringifyOrderedFields([
        ['jsonrpc', '2.0'],
        ['id', 2],
        ['method', 'tools/call'],
        ['params', { name: 'get_project' }],
      ]),
    )
    const body = await res.json()
    const err = toolError(body)
    expect(err?.code).toBe('validation')
    expect(err?.message).toMatch(/Missing required argument/u)
  })
})
