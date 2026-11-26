import { assert, describe, expect, test } from 'vite-plus/test'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedIssueFixture } from './helpers.ts'
import type { JsonRpcError, JsonRpcResult } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

type PromptFixture = Readonly<{
  epicNumber: number
  mcpCall: (method: string, params: unknown) => Promise<unknown>
}>

const seedPromptFixture = async function seedPromptFixture(): Promise<PromptFixture> {
  const fixture = await seedIssueFixture({ issueTitle: 'Ship the widget' })
  const { token } = fixture
  const { slug } = fixture
  const { workspaceId } = fixture
  const epicId = fixture.issueId
  /*
   * Read the seeded number directly from D1, same reasoning as
   * playbook-compose.test.ts: avoid warming getIssue's KV cache via REST.
   */
  const row = await env.DB.prepare('SELECT number FROM issues WHERE id = ?').bind(epicId).first<{ number: number }>()
  assert.exists(row)
  const epicNumber = row.number

  const mcpCall = async function mcpCall(method: string, params: unknown): Promise<unknown> {
    const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    return res.json()
  }
  return { epicNumber, mcpCall }
}

describe('covers MCP prompts', () => {
  test('prompts/list returns the epic-goal prompt with its arguments', async () => {
    const { mcpCall } = await seedPromptFixture()
    const json = (await mcpCall('prompts/list', {})) as JsonRpcResult<{
      prompts: {
        name: string
        description: string
        arguments: { name: string; required: boolean }[]
      }[]
    }>
    const prompt = json.result.prompts.find((listedPrompt) => listedPrompt.name === 'epic-goal')
    assert.isDefined(prompt)
    const argNames = prompt.arguments.map((a) => a.name)
    expect(argNames).toStrictEqual(['epicRef', 'variant', 'reviewModel', 'cadence', 'checkpointInterval'])
    expect(prompt.arguments.find((a) => a.name === 'epicRef')?.required).toBe(true)
    expect(prompt.arguments.find((a) => a.name === 'variant')?.required).toBe(false)
  })

  test('prompts/get with only epicRef returns the composed directive as a user message', async () => {
    const { epicNumber, mcpCall } = await seedPromptFixture()
    const json = (await mcpCall(
      'prompts/get',
      fieldsInOrder([
        ['name', 'epic-goal'],
        ['arguments', { epicRef: `PROJ-${epicNumber}` }],
      ]),
    )) as JsonRpcResult<{
      description: string
      messages: { role: string; content: { type: string; text: string } }[]
    }>
    expect(json.result.messages).toHaveLength(1)
    expect(json.result.messages[0].role).toBe('user')
    expect(json.result.messages[0].content.type).toBe('text')
    expect(json.result.messages[0].content.text).toContain('Ship the widget')
    expect(json.result.messages[0].content.text).toContain('Self-feed (bounded)')
    expect(json.result.messages[0].content.text).toContain('Human checkpoint')
    expect(json.result.messages[0].content.text).toContain('every 10 completed tickets')
  })

  test('prompts/get honors string-valued variant/reviewModel/cadence/checkpointInterval arguments', async () => {
    const { epicNumber, mcpCall } = await seedPromptFixture()
    const json = (await mcpCall(
      'prompts/get',
      fieldsInOrder([
        ['name', 'epic-goal'],
        [
          'arguments',
          {
            epicRef: `PROJ-${epicNumber}`,
            variant: 'full',
            reviewModel: 'sonnet',
            cadence: '5',
            checkpointInterval: '3',
          },
        ],
      ]),
    )) as JsonRpcResult<{ messages: { content: { text: string } }[] }>
    const { text } = json.result.messages[0].content
    expect(text).toContain('Self-feed (full)')
    expect(text).toContain('every 5 completed tickets')
    expect(text).toContain('adversarial sonnet review')
    expect(text).toContain('every 3 completed tickets')
  })

  test('prompts/get on an unresolvable epicRef surfaces the compose error', async () => {
    const { mcpCall } = await seedPromptFixture()
    const json = (await mcpCall('prompts/get', {
      arguments: { epicRef: 'PROJ-999999' },
      name: 'epic-goal',
    })) as JsonRpcError
    expect(json.error.code).toBe(-32_000)
    expect(json.error.message).toContain('not found')
  })

  test('prompts/get on an unknown prompt name errors, naming valid options', async () => {
    const { mcpCall } = await seedPromptFixture()
    const json = (await mcpCall('prompts/get', {
      arguments: {},
      name: 'does-not-exist',
    })) as JsonRpcError
    expect(json.error.message).toContain('does-not-exist')
    expect((json.error.data as { validNames: string[] })?.validNames).toContain('epic-goal')
  })
})
