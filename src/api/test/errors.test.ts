import { describe, expect, test } from 'vite-plus/test'

import { ConflictError, ForbiddenError, NotFoundError, ServiceError, ValidationError } from '#commands/errors.ts'

import { serviceErrToResponse } from '../http/error-adapter.ts'
import { toMcpError } from '../mcp/error-adapter.ts'

describe('ValidationError', () => {
  test('carries the zod-flattened issues and a fixed message', () => {
    const issues = { formErrors: ['bad'], fieldErrors: { title: ['required'] } }
    const err = new ValidationError(issues)
    expect(err.kind).toBe('validation')
    expect(err.message).toBe('Validation failed')
    expect(err.issues).toBe(issues)
    expect(err).toBeInstanceOf(ServiceError)
  })
})

describe('NotFoundError', () => {
  test('defaults to a generic message', () => {
    const err = new NotFoundError()
    expect(err.kind).toBe('not_found')
    expect(err.message).toBe('Not found')
  })

  test('accepts a custom message', () => {
    const err = new NotFoundError('Issue not found')
    expect(err.message).toBe('Issue not found')
  })
})

describe('ForbiddenError', () => {
  test('defaults to a generic message', () => {
    const err = new ForbiddenError()
    expect(err.kind).toBe('forbidden')
    expect(err.message).toBe('Forbidden')
  })

  test('accepts a custom message', () => {
    const err = new ForbiddenError('Not a workspace member')
    expect(err.message).toBe('Not a workspace member')
  })
})

describe('ConflictError', () => {
  test('defaults to a generic message', () => {
    const err = new ConflictError()
    expect(err.kind).toBe('conflict')
    expect(err.message).toBe('Conflict')
  })

  test('accepts a custom message', () => {
    const err = new ConflictError('Slug already taken')
    expect(err.message).toBe('Slug already taken')
  })
})

/*
 * The adapters key off `err.kind` (ServiceError) / `instanceof` to decide what a
 * caller is allowed to see, so a regression there is a silent info leak or a
 * wrong HTTP/JSON-RPC status. Cover both surfaces directly here.
 */
describe('http/error-adapter: serviceErrToResponse', () => {
  const fakeCtx = { json: (body: unknown, status: number) => ({ body, status }) } as never

  test('maps ValidationError to 400 with the issues payload', async () => {
    const issues = { formErrors: [], fieldErrors: { name: ['required'] } }
    const res = serviceErrToResponse(fakeCtx, new ValidationError(issues)) as unknown as {
      body: unknown
      status: number
    }
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: issues })
  })

  test('maps NotFoundError to 404 with the message', () => {
    const res = serviceErrToResponse(fakeCtx, new NotFoundError('Issue not found')) as unknown as {
      body: unknown
      status: number
    }
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Issue not found' })
  })

  test('maps ForbiddenError to 403 with the message', () => {
    const res = serviceErrToResponse(fakeCtx, new ForbiddenError('nope')) as unknown as {
      body: unknown
      status: number
    }
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'nope' })
  })

  test('maps ConflictError to 409 with the message', () => {
    const res = serviceErrToResponse(fakeCtx, new ConflictError('taken')) as unknown as {
      body: unknown
      status: number
    }
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'taken' })
  })

  test("rethrows anything that isn't a ServiceError", () => {
    expect(() => serviceErrToResponse(fakeCtx, new Error('boom'))).toThrow('boom')
  })
})

describe('mcp/error-adapter: toMcpError', () => {
  /*
   * PROJ-508: previously the Zod issues were dropped entirely so an MCP caller had
   * no way to learn why its params were rejected. They're deliberately client-facing
   * (field names + validation messages, never internals), so they now travel in the
   * JSON-RPC 2.0 `error.data` member instead.
   */
  test('maps ValidationError to -32602 with the issues in error.data and a message summary', () => {
    const issues = { formErrors: ['ambiguous heading'], fieldErrors: {} }
    const result = toMcpError(new ValidationError(issues), 'req-1')
    expect(result).toEqual({
      code: -32_602,
      message: 'Invalid params (ambiguous heading)',
      data: issues,
    })
  })

  test('maps NotFoundError to -32000 with its client-facing message', () => {
    expect(toMcpError(new NotFoundError('Issue not found'), 'req-1')).toEqual({
      code: -32_000,
      message: 'Issue not found',
    })
  })

  /*
   * PROJ-508: structured NotFoundError.details (e.g. patch_wiki_page's currentHeadings)
   * used to be JSON-encoded into `message` as a workaround; now it travels in `data`,
   * with a bounded human-readable summary also folded into `message` as a fallback for
   * MCP hosts that don't surface `data` to the calling model.
   */
  test('maps a NotFoundError with details to -32000 with the details in error.data and a message summary', () => {
    const result = toMcpError(
      new NotFoundError("Heading 'Nope' not found", { currentHeadings: ['Alpha', 'Beta'] }),
      'req-1',
    )
    expect(result).toEqual({
      code: -32_000,
      message: "Heading 'Nope' not found (currentHeadings: Alpha, Beta)",
      data: { currentHeadings: ['Alpha', 'Beta'] },
    })
  })

  /*
   * PROJ-508: an empty details object must be treated the same as no details at all —
   * omit `data` (per the JSON-RPC 2.0 contract) rather than sending `data: {}`.
   */
  test('treats an empty NotFoundError.details object as no details', () => {
    expect(toMcpError(new NotFoundError('Issue not found', {}), 'req-1')).toEqual({
      code: -32_000,
      message: 'Issue not found',
    })
  })

  test('maps ForbiddenError to -32000 with its client-facing message', () => {
    expect(toMcpError(new ForbiddenError('Not allowed'), 'req-1')).toEqual({
      code: -32_000,
      message: 'Not allowed',
    })
  })

  test('maps ConflictError to -32000 with its client-facing message', () => {
    expect(toMcpError(new ConflictError('Slug taken'), 'req-1')).toEqual({
      code: -32_000,
      message: 'Slug taken',
    })
  })

  /*
   * PROJ-508: structured ConflictError.details (e.g. wiki's optimistic-lock
   * currentRevisionId + diff) used to be JSON-encoded into `message` as a workaround
   * (PROJ-484); now it travels in `data`, with a bounded human-readable summary also
   * folded into `message` as a fallback for MCP hosts that don't surface `data`.
   */
  test('maps a ConflictError with details to -32000 with the details in error.data and a message summary', () => {
    const result = toMcpError(
      new ConflictError('Revision conflict', { currentRevisionId: 'rev-2', diff: '...' }),
      'req-1',
    )
    expect(result).toEqual({
      code: -32_000,
      message: 'Revision conflict (currentRevisionId: rev-2; diff: ...)',
      data: { currentRevisionId: 'rev-2', diff: '...' },
    })
  })

  /*
   * PROJ-508: a long diff shouldn't blow up the message with unbounded text — the
   * summary folded into `message` is truncated; `data` still carries the full value.
   */
  test('truncates a long detail value in the message summary but not in error.data', () => {
    const longDiff = 'x'.repeat(500)
    const result = toMcpError(new ConflictError('Revision conflict', { diff: longDiff }), 'req-1')
    expect(result.data).toEqual({ diff: longDiff })
    expect(result.message.length).toBeLessThan(150)
    expect(result.message).toContain('diff: xxx')
  })

  /*
   * PROJ-508: an empty details object must be treated the same as no details at all —
   * omit `data` (per the JSON-RPC 2.0 contract) rather than sending `data: {}`.
   */
  test('treats an empty ConflictError.details object as no details', () => {
    expect(toMcpError(new ConflictError('Slug taken', {}), 'req-1')).toEqual({
      code: -32_000,
      message: 'Slug taken',
    })
  })

  test('maps a non-ServiceError to a generic internal error carrying the request id, not the raw message', () => {
    const result = toMcpError(new Error('stack trace with secrets'), 'req-42')
    expect(result.code).toBe(-32_000)
    expect(result.message).toBe('Internal error (request: req-42)')
    expect(result.message).not.toContain('stack trace with secrets')
    expect(result.data).toEqual({ requestId: 'req-42' })
  })
})
