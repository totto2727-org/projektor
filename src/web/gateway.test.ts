import { Effect, Layer } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpServerResponse } from 'effect/http'
import { describe, expect, it, vi } from 'vite-plus/test'

import { forwardApi } from './gateway'

const env = { API_BASE: 'https://api.example.test' }
const front = 'https://front.example.test'

type Transport = (request: HttpClientRequest.HttpClientRequest) => Response | Promise<Response>

function mockedClient(transport: Transport) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.promise(() => Promise.resolve().then(() => transport(request))).pipe(
        Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      ),
    ),
  )
}

function run(request: Request, transport: Transport) {
  return Effect.runPromise(
    forwardApi(request, env).pipe(Effect.map(HttpServerResponse.toWeb), Effect.provide(mockedClient(transport))),
  )
}

async function asWeb(request: HttpClientRequest.HttpClientRequest) {
  return Effect.runPromise(HttpClientRequest.toWeb(request))
}

describe('fixed API gateway', () => {
  it("preserves the backend's safe browser login redirect without following it", async () => {
    const transport = vi.fn<Transport>(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: '/issues?workspace=alpha#current' },
        }),
    )
    const response = await run(new Request(`${front}/auth/login?redirect_url=%2Fissues`), transport)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/issues?workspace=alpha#current')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it.each(['https://evil.test/', '//evil.test/', '/\\evil.test/', 'javascript:alert(1)'])(
    'never exposes an unsafe login redirect %s',
    async (location) => {
      const response = await run(
        new Request(`${front}/auth/login`),
        () => new Response(null, { status: 302, headers: { location } }),
      )
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/')
    },
  )

  it('keeps API challenge redirects opaque rather than forwarding credentials or Location', async () => {
    const transport = vi.fn<Transport>(
      () =>
        new Response('private challenge body', {
          status: 302,
          headers: { location: 'https://access.example.test/login' },
        }),
    )
    const response = await run(new Request(`${front}/api/issues`), transport)
    expect(response.status).toBe(401)
    expect(response.headers.get('location')).toBeNull()
    await expect(response.json()).resolves.toEqual({
      error: 'The API requires a new authenticated session.',
    })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('forwards only selected identity/context headers to the fixed API origin', async () => {
    let forwarded: Request | undefined
    const response = await run(
      new Request(`${front}/api/files/id?workspace=alpha`, {
        headers: {
          authorization: 'Bearer caller',
          'cf-access-jwt-assertion': 'assertion',
          cookie: 'theme=dark; CF_Authorization=session; unrelated=secret',
          'x-workspace-slug': 'alpha',
          'x-user-id': 'spoofed',
          range: 'bytes=0-3',
        },
      }),
      async (request) => {
        forwarded = await asWeb(request)
        return Response.json(
          { ok: true },
          {
            headers: {
              'set-cookie': 'other=secret',
              'access-control-allow-origin': '*',
              etag: '"resource"',
            },
          },
        )
      },
    )
    if (!forwarded) throw new Error('Expected forwarded request')
    expect(forwarded.url).toBe(`${env.API_BASE}/api/files/id?workspace=alpha`)
    expect(Object.fromEntries(forwarded.headers)).toMatchObject({
      authorization: 'Bearer caller',
      'cf-access-jwt-assertion': 'assertion',
      cookie: 'CF_Authorization=session',
      'x-workspace-slug': 'alpha',
      range: 'bytes=0-3',
    })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('etag')).toBe('"resource"')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('preserves a conditional GET 304 instead of treating it as an auth redirect', async () => {
    const response = await run(
      new Request(`${front}/api/projects`, { headers: { 'if-none-match': '"version"' } }),
      () => new Response(null, { status: 304, headers: { etag: '"version"' } }),
    )
    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
  })

  it('streams a response larger than 10 MiB after the Effect has resolved', async () => {
    let pulls = 0
    const chunk = new Uint8Array(1024 * 1024).fill(7)
    const response = await run(
      new Request(`${front}/api/files/large`),
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              pulls += 1
              if (pulls > 11) return controller.close()
              controller.enqueue(chunk)
            },
          }),
        ),
    )
    expect(pulls).toBeLessThan(11)
    expect((await response.arrayBuffer()).byteLength).toBe(11 * 1024 * 1024)
    expect(pulls).toBe(12)
  })

  it('cancels the upstream Effect stream when the browser consumer cancels', async () => {
    const cancelled = vi.fn()
    const response = await run(
      new Request(`${front}/api/files/stream`),
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array([1]))
            },
            cancel: cancelled,
          }),
        ),
    )
    await response.body?.cancel()
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('does not accept upload or mutation requests outside ServerFn', async () => {
    const transport = vi.fn<Transport>()
    await expect(
      run(
        new Request(`${front}/api/issues`, {
          method: 'POST',
          headers: { origin: 'https://evil.test' },
          body: '{}',
        }),
        transport,
      ),
    ).rejects.toMatchObject({ status: 405 })
    expect(transport).not.toHaveBeenCalled()
  })
})
