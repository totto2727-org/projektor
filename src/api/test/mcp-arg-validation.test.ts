import { String, Array, Iterable, Predicate } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test'

import { validateToolArgs } from '#api/mcp/validate-args.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture, toolError } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'

/*
 * PROJ-920: MCP arguments are validated against each tool's inputSchema (types, enums,
 * lengths, required) before the handler runs, so a wrongly-typed argument is a validation
 * tool error naming the field — never a handler crash surfacing as an internal error.
 */

type Schema = Record<string, unknown>

const schemaType = function schemaType(s: Schema): string | undefined {
  return globalThis.Array.isArray(s.type) ? (s.type[0] as string) : (s.type as string | undefined)
}

const validValue = function validValue(s: Schema): unknown {
  if (globalThis.Array.isArray(s.enum) && Array.isArrayNonEmpty(s.enum)) {
    return s.enum[0]
  }
  switch (schemaType(s)) {
    case 'string':
      return 'x'.repeat(Math.max(1, Predicate.isNumber(s.minLength) ? s.minLength : 1))
    case 'number':
    case 'integer':
      return Predicate.isNumber(s.minimum) ? s.minimum : 1
    case 'boolean':
      return true
    case 'array':
      return []
    case 'object':
      return {}
    default:
      return 'x'
  }
}

const wrongValue = function wrongValue(s: Schema): unknown {
  switch (schemaType(s)) {
    case 'string':
      return 42
    case 'number':
    case 'integer':
      return 'ten'
    case 'boolean':
      return 'yes'
    case 'array':
    case 'object':
      return 'not-a-container'
    default:
      return undefined
  }
}

const rpc = async function rpc(
  workspaceId: string,
  headers: Record<string, string>,
  method: string,
  params: unknown,
): Promise<{ result?: { tools: { name: string; inputSchema: Schema }[] } }> {
  const res = await fetchNativeApi(
    `http://localhost/mcp/${workspaceId}`,
    requestOptionsWithBody('POST', headers, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })),
  )
  return res.json() as Promise<{
    result?: { tools: { name: string; inputSchema: Schema }[] }
  }>
}

describe('covers PROJ-920: MCP tool arguments are type-checked before the handler runs', () => {
  const prevMax = env.RATE_LIMIT_API_MAX
  beforeAll(() => {
    env.RATE_LIMIT_API_MAX = '10000' // One call per tool below
  })
  afterAll(() => {
    env.RATE_LIMIT_API_MAX = prevMax
  })

  test('every tool rejects a wrongly-typed required argument with a validation tool error naming it', async () => {
    const testFixture = await seedFixture({ role: 'owner' })
    const headers = authHeaders(testFixture.token, testFixture.workspace.slug)
    const list = await rpc(testFixture.workspace.id, headers, 'tools/list', {})
    const tools = list.result?.tools ?? []
    expect(tools.length).toBeGreaterThan(50)

    const failures: string[] = []
    let checked = 0
    for (const tool of tools) {
      const props = (tool.inputSchema.properties ?? {}) as Record<string, Schema>
      const required = ((tool.inputSchema.required ?? []) as string[]).filter((k) => props[k])
      const target = required.find((k) => wrongValue(props[k]) !== undefined)
      if (Predicate.isNullish(target) || String.isEmpty(target)) {
        continue
      }
      const args: Record<string, unknown> = {}
      Iterable.forEach(required, (k) => {
        args[k] = validValue(props[k])
      })
      args[target] = wrongValue(props[target])

      const res = await rpc(testFixture.workspace.id, headers, 'tools/call', {
        name: tool.name,
        arguments: args,
      })
      checked += 1
      const err = toolError(res)
      if (err?.code !== 'validation' || !err.fields || !(target in err.fields)) {
        failures.push(`${tool.name}.${target}: ${err?.code ?? 'ok'} ${err?.message ?? ''}`)
      }
    }
    expect(checked).toBeGreaterThan(50)
    expect(failures).toStrictEqual([])
  })

  test('puts the failing field in fields like a service ValidationError', async () => {
    const testFixture = await seedFixture({ role: 'owner' })
    const headers = authHeaders(testFixture.token, testFixture.workspace.slug)
    const res = await rpc(testFixture.workspace.id, headers, 'tools/call', {
      name: 'get_issue',
      arguments: { id: 42 },
    })
    const err = toolError(res)
    expect(err?.code).toBe('validation')
    expect(err?.fields?.id?.[0]).toMatch(/must be string/u)
  })

  test('still reports missing required arguments by name (PROJ-877)', async () => {
    const testFixture = await seedFixture({ role: 'owner' })
    const headers = authHeaders(testFixture.token, testFixture.workspace.slug)
    const res = await rpc(testFixture.workspace.id, headers, 'tools/call', {
      name: 'create_issue',
      arguments: {},
    })
    const err = toolError(res)
    expect(err?.code).toBe('validation')
    expect(err?.message).toContain('Missing required argument(s)')
    expect(err?.fields).toBeDefined()
    expect(Object.keys(err?.fields ?? {})).toContain('title')
  })
})

describe('validateToolArgs', () => {
  const schema: Schema = {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['todo', 'done'] },
      assigneeId: { type: 'string', nullable: true },
      labels: { type: 'array', items: { type: 'string' }, maxItems: 2 },
      limit: { type: 'integer', minimum: 1 },
      title: { type: 'string', minLength: 1, maxLength: 5 },
    },
    required: ['status'],
  }

  test('accepts valid args, null for nullable fields, and undeclared extras', () => {
    expect(
      validateToolArgs(schema, {
        status: 'todo',
        assigneeId: null,
        labels: ['a'],
        limit: 3,
        extra: 1,
      }),
    ).toStrictEqual([])
  })

  test('reports enum, item, length, integer and minimum violations with paths', () => {
    const issues = validateToolArgs(schema, {
      status: 'nope',
      labels: ['a', 2, 'c'],
      limit: 1.5,
      title: 'toolong',
    })
    const paths = issues.map((issue) => issue.path).sort()
    expect(paths).toStrictEqual(['labels', 'labels[1]', 'limit', 'status', 'title'])
  })

  test('stays as lenient as the services: numeric/boolean strings and null for optional fields', () => {
    expect(validateToolArgs(schema, { status: 'done', limit: '3', labels: null, title: null })).toStrictEqual([])
    expect(validateToolArgs({ properties: { flag: { type: 'boolean' } } }, { flag: 'true' })).toStrictEqual([])
    expect(validateToolArgs(schema, { status: null }).map((i) => i.path)).toStrictEqual(['status'])
    expect(validateToolArgs(schema, { status: 'todo', limit: 'ten' }).map((i) => i.path)).toStrictEqual(['limit'])
  })
})
