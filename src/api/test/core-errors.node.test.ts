import { Hono } from 'hono'
import { describe, expect, it } from 'vite-plus/test'

import type { HonoEnv } from '#types'

import { coreFailure } from '../../core/contract'
import { serviceErrToResponse } from '../http/error-adapter'
import { toMcpError, toToolError } from '../mcp/error-adapter'

/** Exercise the public adapters with the validated native envelope's error type. */
describe('Core failures at public protocol boundaries', () => {
  it('preserves REST validation fields without serializing error diagnostics', async () => {
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
    expect(await response.json()).toEqual({ error: { formErrors: [], fieldErrors: { title: ['Required'] } } })
  })

  it('preserves REST conflict metadata and retry guidance', async () => {
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
    expect(await response.json()).toEqual({
      error: 'Page changed',
      currentRevisionId: 'revision-2',
      diff: '-old\n+new',
    })
  })

  it('renders Core validation failures as actionable MCP tool errors', () => {
    const error = coreFailure(400, 'Validation failed', {
      kind: 'validation',
      details: { formErrors: [], fieldErrors: { title: ['Required'] } },
    })
    expect(toMcpError(error, 'request-1')).toMatchObject({
      code: -32602,
      data: { fieldErrors: { title: ['Required'] } },
    })
    const result = toToolError(error)
    expect(result?.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('Required')
    expect(JSON.stringify(result)).not.toContain('occurrenceId')
  })

  it('preserves structured conflicts without reviving remote ServiceError instances', () => {
    const error = coreFailure(409, 'Page changed', { kind: 'conflict', details: { currentRevisionId: 'revision-2' } })
    expect(toMcpError(error, 'request-2')).toMatchObject({ code: -32000, data: { currentRevisionId: 'revision-2' } })
    expect(JSON.stringify(toToolError(error))).toContain('Re-read')
  })

  it('keeps unexpected Core failures out of actionable tool errors', () => {
    const error = coreFailure(500, 'An unexpected error occurred.')
    expect(toToolError(error)).toBeNull()
    expect(toMcpError(error, 'request-3')).toMatchObject({ code: -32000, data: { requestId: 'request-3' } })
  })
})
