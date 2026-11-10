import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'

import { CORE_ACTOR_HEADER } from '../core/contract'
import { transferCoreBinary } from './core-binary'
import { makeRequestServices, RequestServices } from './request'

function execute(request: Request, fetch: (request: Request) => Promise<Response>) {
  return Effect.gen(function* () {
    const services = yield* makeRequestServices(request, { CORE: { fetch }, ENVIRONMENT: 'production' })
    return yield* transferCoreBinary('/files/a?workspaceId=w').pipe(Effect.provideService(RequestServices, services))
  })
}

describe('Web same-binding binary transport', () => {
  it('preserves response streams and forwards only raw Access proof, never claimed identity headers', async () => {
    const stream = new ReadableStream<Uint8Array>()
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(stream))
    const incoming = new Request('https://front.test/api/files/a', {
      headers: { cookie: 'other=value; CF_Authorization=verified.jwt', 'x-user-id': 'forged' },
    })
    const response = await Effect.runPromise(execute(incoming, fetch))
    expect(response.body).toBe(stream)
    expect(fetch).toHaveBeenCalledOnce()
    const forwarded = fetch.mock.calls[0]?.[0]
    expect(forwarded?.url).toBe('https://core.internal/files/a?workspaceId=w')
    expect(forwarded?.headers.get('x-user-id')).toBeNull()
    expect(forwarded?.headers.get(CORE_ACTOR_HEADER)).toBe(
      JSON.stringify({ requestUrl: incoming.url, method: 'GET', accessJwt: 'verified.jwt' }),
    )
  })

  it('retains original request cancellation on the native binding request', async () => {
    const abort = new AbortController()
    const incoming = new Request('https://front.test/api/files/a', { signal: abort.signal })
    const fetch = vi.fn(async (request: Request) => {
      abort.abort('disconnected')
      expect(request.signal.aborted).toBe(true)
      return new Response(null)
    })
    await Effect.runPromise(execute(incoming, fetch))
  })

  it('does not expose transport diagnostics or malformed failure response contents', async () => {
    const incoming = new Request('https://front.test/api/files/a')
    const failure = await Effect.runPromise(
      execute(incoming, async () => {
        throw new Error('private driver diagnostic')
      }).pipe(Effect.flip),
    )
    expect(failure.status).toBe(502)
    expect(failure.message).not.toContain('private driver')
    const malformed = await Effect.runPromise(
      execute(incoming, async () => new Response('private SQL diagnostic', { status: 500 })).pipe(Effect.flip),
    )
    expect(malformed.status).toBe(500)
    expect(malformed.message).toBe('The operation could not be completed.')
  })
})
