import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { authHeaders, seedFixture, toolError } from './helpers.ts'
import type { JsonRpcResult } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { readNativeJson } from './response-json.ts'

describe('playbooks', () => {
  type TestData = Readonly<{
    slug: string
    token: string
    workspaceId: string
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const fixture = await seedFixture()
    const token = fixture.token
    const slug = fixture.workspace.slug
    const workspaceId = fixture.workspace.id
    return { slug, token, workspaceId }
  }

  test('handles GET /api/playbooks lists the registry', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/playbooks', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(
      res,
      Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.String })).pipe(Schema.mutable),
    )
    expect(body.find((playbook) => playbook.name === 'epic-goal')).toBeTruthy()
    expect(body.find((playbook) => playbook.name === 'idea-discovery')).toBeTruthy()
  })

  /*
   * PROJ-633: the playbook reads are deliberately global — no workspace. Adding the
   * compose route required workspace context, and applying workspaceMiddleware to the
   * whole /api/playbooks prefix to get it would make these two 400 without a slug.
   * Every other test here sends one, so only this asserts the prefix stays global.
   */
  test('handles GET /api/playbooks and /:name work without an X-Workspace-Slug header', async () => {
    const { token } = await seedTestData()
    const auth = { Authorization: `Bearer ${token}` }

    const list = await fetchNativeApi('http://localhost/api/playbooks', { headers: auth })
    expect(list.status).toBe(200)

    const one = await fetchNativeApi('http://localhost/api/playbooks/epic-goal', { headers: auth })
    expect(one.status).toBe(200)
  })

  test('covers MCP list_playbooks returns the same content as REST', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const restRes = await fetchNativeApi('http://localhost/api/playbooks', {
      headers: authHeaders(token, slug),
    })
    const restBody = await restRes.json()

    const mcpRes = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: {}, name: 'list_playbooks' },
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const mcpJson = (await mcpRes.json()) as JsonRpcResult<{ content: { text: string }[] }>
    const mcpBody = JSON.parse(mcpJson.result.content[0].text)

    expect(mcpBody).toStrictEqual(restBody)
  })

  test('handles GET /api/playbooks/:name returns the full playbook', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/playbooks/epic-goal', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(res, Schema.Struct({ content: Schema.String, name: Schema.String }))
    expect(body.name).toBe('epic-goal')
    expect(body.content).toContain('bounded variant')
    expect(body.content).toContain('full variant')
    expect(body.content).toContain('Audit first')
  })

  test('handles GET /api/playbooks/idea-discovery returns the full playbook', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/playbooks/idea-discovery', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(200)
    const body = await readNativeJson(res, Schema.Struct({ content: Schema.String, name: Schema.String }))
    expect(body.name).toBe('idea-discovery')
    expect(body.content).toContain('Research frontier')
    expect(body.content).toContain('Gap hypotheses')
    expect(body.content).toContain('Free/open data sources only')
  })

  test('covers MCP get_playbook returns the same content as REST', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const restRes = await fetchNativeApi('http://localhost/api/playbooks/epic-goal', {
      headers: authHeaders(token, slug),
    })
    const restBody = await restRes.json()

    const mcpRes = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { name: 'epic-goal' }, name: 'get_playbook' },
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const mcpJson = (await mcpRes.json()) as JsonRpcResult<{ content: { text: string }[] }>
    const mcpBody = JSON.parse(mcpJson.result.content[0].text)

    expect(mcpBody).toStrictEqual(restBody)
  })

  test('handles GET /api/playbooks/:name 404s on an unknown name', async () => {
    const { slug, token } = await seedTestData()
    const res = await fetchNativeApi('http://localhost/api/playbooks/does-not-exist', {
      headers: authHeaders(token, slug),
    })
    expect(res.status).toBe(404)
    const body = await readNativeJson(
      res,
      Schema.Struct({ error: Schema.String, validNames: Schema.Array(Schema.String).pipe(Schema.mutable) }),
    )
    expect(body.error).toContain('does-not-exist')
    expect(body.validNames).toContain('epic-goal')
  })

  test('covers MCP get_playbook errors on an unknown name, naming valid options', async () => {
    const { slug, token, workspaceId } = await seedTestData()
    const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { name: 'does-not-exist' }, name: 'get_playbook' },
      }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const json = await res.json()
    const err = toolError(json)
    expect(err?.code).toBe('not_found')
    expect(err?.message).toContain('does-not-exist')
    expect(err?.details?.validNames).toContain('epic-goal')
  })
})
