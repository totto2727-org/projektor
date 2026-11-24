import { Hono } from 'hono'
import { describe, expect, test } from 'vite-plus/test'

import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { toMcpError, toToolError } from '#api/mcp/error-adapter.ts'
import { coreFailure } from '#core/contract.ts'
import type { HonoEnv } from '#types'

/** Exercise the public adapters with the validated native envelope's error type. */
describe('core failures at public protocol boundaries', () => {
  test('preserves REST validation fields without serializing error diagnostics', async () => {
    const app = new Hono<HonoEnv>()
    app.get('/', (c) =>
      serviceErrToResponse(
        c,
        coreFailure(400, 'Validation failed', {
          kind: 'validation',
          details: { formErrors: [], fieldErrors: { title: ['Required'] } },
        }),
      ),
    )
    const response = await app.request('/')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toStrictEqual({
      error: { fieldErrors: { title: ['Required'] }, formErrors: [] },
    })
  })

  test('preserves REST conflict metadata and retry guidance', async () => {
    const app = new Hono<HonoEnv>()
    app.get('/', (c) =>
      serviceErrToResponse(
        c,
        coreFailure(409, 'Page changed', {
          kind: 'conflict',
          details: { currentRevisionId: 'revision-2', diff: '-old\n+new' },
          retryAfter: 3,
        }),
      ),
    )
    const response = await app.request('/')
    expect(response.status).toBe(409)
    expect(response.headers.get('Retry-After')).toBe('3')
    await expect(response.json()).resolves.toStrictEqual({
      currentRevisionId: 'revision-2',
      diff: '-old\n+new',
      error: 'Page changed',
    })
  })

  test('renders Core validation failures as actionable MCP tool errors', () => {
    const error = coreFailure(400, 'Validation failed', {
      kind: 'validation',
      details: { formErrors: [], fieldErrors: { title: ['Required'] } },
    })
    expect(toMcpError(error, 'request-1')).toMatchObject({
      code: -32_602,
      data: { fieldErrors: { title: ['Required'] } },
    })
    const result = toToolError(error)
    expect(result?.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('Required')
    expect(JSON.stringify(result)).not.toContain('occurrenceId')
  })

  test('preserves structured conflicts without reviving remote ServiceError instances', () => {
    const error = coreFailure(409, 'Page changed', { kind: 'conflict', details: { currentRevisionId: 'revision-2' } })
    expect(toMcpError(error, 'request-2')).toMatchObject({ code: -32_000, data: { currentRevisionId: 'revision-2' } })
    expect(JSON.stringify(toToolError(error))).toContain('Re-read')
  })

  test('keeps unexpected Core failures out of actionable tool errors', () => {
    const error = coreFailure(500, 'An unexpected error occurred.')
    expect(toToolError(error)).toBeNull()
    expect(toMcpError(error, 'request-3')).toMatchObject({ code: -32_000, data: { requestId: 'request-3' } })
  })
})
