import { Effect, Schema } from 'effect'
import { Hono } from 'hono'
import { decodeCoreReply } from 'projektor/core-client'
import { describe, expect, it } from 'vite-plus/test'

import type { HonoEnv } from '#types'

import { serviceErrToResponse } from '../http/error-adapter'

/** Workers prebundles the native client. Error handling must use that same class identity. */
describe('native client failure identity at the public HTTP adapter', () => {
  it.each([401, 403, 502])('preserves a validated Core %i rather than falling through to HTTP 500', async (status) => {
    const wire = JSON.stringify({
      _tag: 'Failure',
      failure: {
        status,
        message: 'Public failure',
        occurrenceId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
        retryAfter: 7,
      },
    })
    const error = await Effect.runPromise(Effect.flip(decodeCoreReply(Schema.String, Effect.succeed(wire))))
    const app = new Hono<HonoEnv>()
    app.get('/', (c) => serviceErrToResponse(c, error))
    const response = await app.request('https://api.test/')
    expect(response.status).toBe(status)
    expect(response.headers.get('Retry-After')).toBe('7')
    expect(await response.json()).toEqual({ error: 'Public failure' })
  })
})
