import { Predicate, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { hashWorkflowContent } from '#commands/workflow.ts'
import { ApiResults } from '#contracts/api-results.ts'

import { authHeaders, seedFixture, toolError } from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'
import { stringifyOrderedFields, fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { RpcTextResponse, parseNativeMcpText, readNativeJson, readNativeMcpResultText } from './response-json.ts'

const mcpCall = async function mcpCall<T>(
  workspaceId: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
): Promise<JsonRpcResult<T> | JsonRpcError> {
  const res = await fetchNativeApi(
    `http://localhost/mcp/${workspaceId}`,
    requestOptionsWithBody('POST', headers, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })),
  )
  return res.json()
}

describe('workflow spec', () => {
  type TestData = Readonly<{
    slug: string
    token: string
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedFixture()
    const { token } = fixture
    const { slug } = fixture.workspace
    const workspaceId = fixture.workspace.id
    return { slug, token, workspaceId }
  }

  test('handles GET /api/workflow returns the spec content plus a version', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/workflow', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(
      res,
      Schema.Struct({
        content: Schema.String,
        description: Schema.String,
        title: Schema.String,
        version: Schema.String,
      }),
    )
    expect(body.title).toBe('Workflow spec')
    expect(body.content).toContain('Definition of ready')
    expect(body.content).toContain('Human gates')
    // PROJ-599: a pointer only, per the spec's own single-home rule.
    expect(body.content).toContain('## Playbooks')
    expect(body.content).toContain('get_playbook("epic-goal")')
    // PROJ-915: the human-authored files rule is stated in one line.
    expect(body.content).toContain('**Human-authored files**')
    expect(body.content).toContain('`README.md`')
    expect(body.content).toContain('PROJ-914')
    // PROJ-933: a stable content-hash version accompanies the spec.
    expect(body.version).toSatisfy(Predicate.isString)
    expect(body.version.length).toBeGreaterThan(0)
  })

  test('covers MCP get_workflow returns the same content as REST', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const restRes = await fetchNativeApi('http://localhost/api/workflow', {
      headers: authHeaders(token, slug),
    })
    const restBody = await readNativeJson(restRes, ApiResults.apiGetWorkflow)

    const mcpRes = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: {}, name: 'get_workflow' },
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const mcpJson = await readNativeJson(mcpRes, RpcTextResponse)
    const text = readNativeMcpResultText(mcpJson.result)
    const mcpBody = parseNativeMcpText(text, ApiResults.apiGetWorkflow)

    expect(mcpBody).toStrictEqual(restBody)
  })

  /*
   * PROJ-933: version present, stable across requests/processes, and the same on both
   * surfaces.
   */
  test('version is present and stable across repeated requests', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const res1 = await fetchNativeApi('http://localhost/api/workflow', {
      headers: authHeaders(token, slug),
    })
    const body1 = await readNativeJson(res1, Schema.Struct({ version: Schema.String }))

    const res2 = await fetchNativeApi('http://localhost/api/workflow', {
      headers: authHeaders(token, slug),
    })
    const body2 = await readNativeJson(res2, Schema.Struct({ version: Schema.String }))

    expect(body1.version).toBe(body2.version)

    const mcpJson = (await mcpCall(
      workspaceId,
      'tools/call',
      { arguments: {}, name: 'get_workflow' },
      authHeaders(token, slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const mcpBody = parseNativeMcpText(mcpJson.result.content[0].text, Schema.Struct({ version: Schema.String }))
    expect(mcpBody.version).toBe(body1.version)
  })

  test('matching ifVersion over MCP returns only { unchanged: true, version }', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const first = (await mcpCall(
      workspaceId,
      'tools/call',
      { arguments: {}, name: 'get_workflow' },
      authHeaders(token, slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const { version } = parseNativeMcpText(first.result.content[0].text, Schema.Struct({ version: Schema.String }))

    const second = (await mcpCall(
      workspaceId,
      'tools/call',
      { arguments: { ifVersion: version }, name: 'get_workflow' },
      authHeaders(token, slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const body = JSON.parse(second.result.content[0].text)

    expect(body).toStrictEqual({ unchanged: true, version })
  })

  test('matching ifVersion over REST returns only { unchanged: true, version }', async () => {
    const { slug, token } = await seedTestData()
    const first = await fetchNativeApi('http://localhost/api/workflow', {
      headers: authHeaders(token, slug),
    })
    const { version } = await readNativeJson(first, Schema.Struct({ version: Schema.String }))

    const second = await fetchNativeApi(`http://localhost/api/workflow?ifVersion=${version}`, {
      headers: authHeaders(token, slug),
    })
    expect(second.status).toBe(200)
    const body = await second.json()

    expect(body).toStrictEqual({ unchanged: true, version })
  })

  test('a mismatched ifVersion returns the full content (MCP and REST)', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const mcpJson = (await mcpCall(
      workspaceId,
      'tools/call',
      { arguments: { ifVersion: 'not-the-real-version' }, name: 'get_workflow' },
      authHeaders(token, slug),
    )) as JsonRpcResult<{ content: { text: string }[] }>
    const mcpBody = JSON.parse(mcpJson.result.content[0].text)
    expect(mcpBody.content).toContain('Definition of ready')
    expect(mcpBody).not.toHaveProperty('unchanged')

    const restRes = await fetchNativeApi('http://localhost/api/workflow?ifVersion=not-the-real-version', {
      headers: authHeaders(token, slug),
    })
    expect(restRes.status).toBe(200)
    const restBody = await readNativeJson(
      restRes,
      Schema.Struct({ content: Schema.String, unchanged: Schema.optional(Schema.Boolean) }),
    )
    expect(restBody.content).toContain('Definition of ready')
    expect(restBody.unchanged).toBeUndefined()
  })

  test('an absent ifVersion returns the full content, not unchanged', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/workflow', {
      headers: authHeaders(token, slug),
    })
    const body = await readNativeJson(
      res,
      Schema.Struct({ content: Schema.String, unchanged: Schema.optional(Schema.Boolean) }),
    )
    expect(body.content).toContain('Definition of ready')
    expect(body.unchanged).toBeUndefined()
  })

  test('hashWorkflowContent changes when content changes and is stable for the same content', async () => {
    await seedTestData()
    const a1 = await hashWorkflowContent('some spec content')
    const a2 = await hashWorkflowContent('some spec content')
    const differentHash = await hashWorkflowContent('some different spec content')

    expect(a1).toBe(a2)
    expect(a1).not.toBe(differentHash)
  })

  test('version is the hash of the whole returned payload (title, description, content)', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/workflow', {
      headers: authHeaders(token, slug),
    })
    const body = await readNativeJson(
      res,
      Schema.Struct({
        content: Schema.String,
        description: Schema.String,
        title: Schema.String,
        version: Schema.String,
      }),
    )
    expect(body.version).toBe(
      await hashWorkflowContent(
        stringifyOrderedFields([
          ['title', body.title],
          ['description', body.description],
          ['content', body.content],
        ]),
      ),
    )
  })

  test('ifVersion longer than 64 chars is rejected', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/api/workflow?ifVersion=${'a'.repeat(65)}`, {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(400)
  })

  test('initialize instructions contain the current workflow version', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const workflowRes = await fetchNativeApi('http://localhost/api/workflow', {
      headers: authHeaders(token, slug),
    })
    const { version } = await readNativeJson(workflowRes, Schema.Struct({ version: Schema.String }))

    const initRes = (await mcpCall(workspaceId, 'initialize', {}, authHeaders(token, slug))) as JsonRpcResult<{
      instructions: string
    }>

    expect(initRes.result.instructions).toContain(version)
    expect(initRes.result.instructions).toContain('ifVersion')
  })

  test('an invalid ifVersion type over MCP returns a validation tool error', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const res = await mcpCall(
      workspaceId,
      'tools/call',
      { arguments: { ifVersion: 42 }, name: 'get_workflow' },
      authHeaders(token, slug),
    )

    expect(toolError(res)?.code).toBe('validation')
  })

  test('an invalid ifVersion type over REST (repeated query param) is a 400 validation error', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/workflow?ifVersion=a&ifVersion=b', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(400)
  })
})
