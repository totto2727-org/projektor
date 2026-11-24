import { Effect } from 'effect'
import { describe, expect, test, vi } from 'vite-plus/test'

import { CORE_ACTOR_HEADER } from '#core/contract.ts'
import { runTestEffect } from '#tests/run-effect.ts'

import { transferCoreBinary } from './core-binary.ts'
import { makeRequestServices, RequestServices } from './request.ts'

const execute = function execute(request: Request, fetch: (request: Request) => Promise<Response>) {
  return Effect.gen(function* () {
    const services = yield* makeRequestServices(request, { CORE: { fetch }, ENVIRONMENT: 'production' })
    return yield* transferCoreBinary('/files/a?workspaceId=w').pipe(Effect.provideService(RequestServices, services))
  })
}

describe('web same-binding binary transport', () => {
  test('preserves response streams and forwards only raw Access proof, never claimed identity headers', async () => {
    const stream = new ReadableStream<Uint8Array>()
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(stream))
    const incoming = new Request('https://front.test/api/files/a', {
      headers: { cookie: 'other=value; CF_Authorization=verified.jwt', 'x-user-id': 'forged' },
    })
    const response = await runTestEffect(execute(incoming, fetch))
    expect(response.body).toBe(stream)
    expect(fetch).toHaveBeenCalledOnce()
    const forwarded = fetch.mock.calls[0]?.[0]
    expect(forwarded?.url).toBe('https://core.internal/files/a?workspaceId=w')
    expect(forwarded?.headers.get('x-user-id')).toBeNull()
    expect(forwarded?.headers.get(CORE_ACTOR_HEADER)).toBe(
      JSON.stringify({ requestUrl: incoming.url, method: 'GET', accessJwt: 'verified.jwt' }),
    )
  })

  test('retains original request cancellation on the native binding request', async () => {
    const abort = new AbortController()
    const incoming = new Request('https://front.test/api/files/a', { signal: abort.signal })
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async (request: Request) => {
      abort.abort('disconnected')
      expect(request.signal.aborted).toBe(true)
      return new Response()
    })
    await runTestEffect(execute(incoming, fetch))
  })

  test('does not expose transport diagnostics or malformed failure response contents', async () => {
    const incoming = new Request('https://front.test/api/files/a')
    const failure = await runTestEffect(
      execute(incoming, async () => {
        throw new Error('private driver diagnostic')
      }).pipe(Effect.flip),
    )
    expect(failure.status).toBe(502)
    expect(failure.message).not.toContain('private driver')
    const malformed = await runTestEffect(
      execute(incoming, async () => new Response('private SQL diagnostic', { status: 500 })).pipe(Effect.flip),
    )
    expect(malformed.status).toBe(500)
    expect(malformed.message).toBe('The operation could not be completed.')
  })
})
