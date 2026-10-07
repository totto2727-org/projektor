import { Cause, Effect, Exit, Fiber, Redacted, Schema, type Scope } from 'effect'
import { FetchHttpClient, HttpClientResponse } from 'effect/http'
import { describe, expect, it, vi } from 'vite-plus/test'

import { TestHttpClient } from '../test/http-client'
import { createRequestApi, type RequestApi, type RequestApiOptions } from './api-client'
import { type ApiError, responseError } from './errors'

const Name = Schema.Struct({ name: Schema.String })
const apiBaseUrl = 'https://api.example.test'
const frontUrl = 'https://front.example.test/issues'
const mutationRequest = () =>
  new Request(frontUrl, { method: 'POST', headers: { origin: 'https://front.example.test' } })
function gate() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Runtime execution and fetch substitution belong only at this test boundary. */
function withApi<A, E>(
  transport: typeof fetch,
  use: (api: RequestApi) => Effect.Effect<A, E, Scope.Scope>,
  request = new Request(frontUrl),
  options: RequestApiOptions = { apiBaseUrl },
) {
  return Effect.runPromise(
    createRequestApi(request, options).pipe(
      Effect.flatMap(use),
      Effect.scoped,
      Effect.provide(TestHttpClient),
      Effect.provideService(FetchHttpClient.Fetch, transport),
    ),
  )
}

/** A single concrete test consumer, not a generic request/result facade. */
function readName(api: RequestApi, path = '/api/issues', workspaceSlug?: string) {
  return api
    .execute(api.get(path, { workspaceSlug }))
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Name)), Effect.mapError(responseError), Effect.scoped)
}

describe('Effect request-owned API transport', () => {
  it('builds requests without executing transport', async () => {
    const transport = vi.fn<typeof fetch>()
    await withApi(transport, (api) =>
      Effect.sync(() => {
        expect(api.get('/api/issues').method).toBe('GET')
        expect(api.send('/api/issues', { method: 'PATCH', json: { name: 'new' } }).method).toBe('PATCH')
        expect(api.raw('/api/files/file', { accept: '*/*' }).headers.accept).toBe('*/*')
      }),
    )
    expect(transport).not.toHaveBeenCalled()
  })

  it('forwards only actual identity and explicit workspace with manual redirects and no-store', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: 'issue' }))
    const request = new Request(frontUrl, {
      headers: {
        authorization: 'Bearer caller-token',
        'cf-access-jwt-assertion': 'caller-assertion',
        cookie: 'theme=dark; CF_Authorization=caller-cookie; unrelated=private',
        'x-workspace-slug': 'untrusted',
        'x-user-id': 'spoofed',
      },
    })
    await expect(withApi(transport, (api) => readName(api, '/api/issues', 'selected'), request)).resolves.toEqual({
      name: 'issue',
    })
    const [url, init] = transport.mock.calls[0]
    expect(String(url)).toBe(`${apiBaseUrl}/api/issues`)
    expect(init).toMatchObject({ redirect: 'manual', cache: 'no-store', credentials: 'omit' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      accept: 'application/json',
      authorization: 'Bearer caller-token',
      'cf-access-jwt-assertion': 'caller-assertion',
      cookie: 'CF_Authorization=caller-cookie',
      'x-workspace-slug': 'selected',
    })
  })

  it('does not forward unsupported credentials or invent public identity', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: 'public' }))
    await withApi(
      transport,
      (api) => readName(api, '/api/share/token'),
      new Request(frontUrl, {
        headers: {
          authorization: 'Basic unrelated',
          cookie: 'theme=dark',
          'cf-access-client-secret': 'service-secret',
        },
      }),
    )
    expect(Object.fromEntries(new Headers(transport.mock.calls[0][1]?.headers))).toEqual({
      accept: 'application/json',
    })
  })

  it.each([
    [
      'theme=dark; CF_Authorization="first-token"; CF_Authorization=second-token; unrelated=private',
      'CF_Authorization=first-token',
    ],
    ['theme=dark; CF_Authorization=token%2Fvalue; unrelated=private', 'CF_Authorization=token%2Fvalue'],
  ])('uses Effect cookie parsing and serializes only the selected credential', async (cookie, expected) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: 'cookie' }))
    await withApi(transport, (api) => readName(api, '/auth/me'), new Request(frontUrl, { headers: { cookie } }))
    expect(new Headers(transport.mock.calls[0][1]?.headers).get('cookie')).toBe(expected)
  })

  it('isolates explicit identity and workspace across concurrent executions without a DTO cache', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers)
      return Response.json({
        name: `${headers.get('authorization')}:${headers.get('x-workspace-slug')}`,
      })
    })
    const run = (token: string, workspaces: readonly string[]) =>
      withApi(
        transport,
        (api) =>
          Effect.all(
            workspaces.map((slug) => readName(api, '/api/issues', slug)),
            { concurrency: 3 },
          ),
        new Request(frontUrl, { headers: { authorization: `Bearer ${token}` } }),
      )
    const [a, b] = await Promise.all([run('A', ['one', 'one', 'two']), run('B', ['one'])])
    expect(a).toEqual([{ name: 'Bearer A:one' }, { name: 'Bearer A:one' }, { name: 'Bearer A:two' }])
    expect(b).toEqual([{ name: 'Bearer B:one' }])
    expect(transport).toHaveBeenCalledTimes(4)
  })

  it('constructs encoded queries against the configured origin', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: 'issue' }))
    await withApi(transport, (api) =>
      readName(api, `/api/issues?${new URLSearchParams({ projectId: 'project /?id' })}`),
    )
    const destination = new URL(String(transport.mock.calls[0][0]))
    expect(destination.origin).toBe(apiBaseUrl)
    expect(destination.pathname).toBe('/api/issues')
    expect(destination.searchParams.get('projectId')).toBe('project /?id')
  })

  it.each(['not-a-url', 'http://public.example.test', 'https://user:secret@api.test', 'https://api.test/api'])(
    'rejects unsafe deployment origin %s',
    async (apiBaseUrl) => {
      const transport = vi.fn<typeof fetch>()
      await expect(withApi(transport, () => Effect.void, undefined, { apiBaseUrl })).rejects.toMatchObject({
        _tag: 'ApiError',
        kind: 'configuration',
        status: 500,
      })
      expect(transport).not.toHaveBeenCalled()
    },
  )

  it('allows explicitly configured local HTTP development', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: 'local' }))
    await expect(
      withApi(transport, (api) => readName(api), undefined, {
        apiBaseUrl: 'http://127.0.0.1:8787',
      }),
    ).resolves.toEqual({ name: 'local' })
  })

  it('does not follow Access redirects or expose their bodies', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('private login body', {
        status: 302,
        headers: { location: 'https://login.test' },
      }),
    )
    await expect(withApi(transport, (api) => readName(api, '/auth/me'))).rejects.toMatchObject({
      kind: 'redirect',
      status: 502,
    })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it.each([401, 403, 404, 409, 503])('preserves HTTP %s without exposing private error bodies', async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('private detail', { status }))
    await expect(withApi(transport, (api) => readName(api))).rejects.toMatchObject({
      kind: 'http',
      status,
      message: `The API request failed (${status}).`,
    })
  })

  it('maps network and concrete response failures and redacts their diagnostic causes', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('private-token-detail'))
      .mockResolvedValueOnce(new Response('not JSON'))
      .mockResolvedValueOnce(Response.json({ name: 42 }))
    const failures = await withApi(transport, (api) =>
      Effect.gen(function* () {
        const errors: ApiError[] = []
        for (let i = 0; i < 3; i++) {
          const result = yield* readName(api).pipe(Effect.result)
          if (result._tag === 'Failure') errors.push(result.failure)
        }
        return errors
      }),
    )
    expect(failures.map((error) => error.kind)).toEqual(['network', 'schema', 'schema'])
    expect(failures.every((error) => Redacted.isRedacted(error.cause))).toBe(true)
    expect(JSON.stringify(failures)).not.toContain('private-token-detail')
    expect(transport).toHaveBeenCalledTimes(3)
  })

  it('sends JSON with explicit mutation options and decodes at the consumer', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: 'after' }))
    await expect(
      withApi(
        transport,
        (api) =>
          api
            .execute(
              api.send('/api/issues/one', {
                method: 'PATCH',
                workspaceSlug: 'one',
                json: { name: 'after' },
              }),
            )
            .pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(Name)),
              Effect.mapError(responseError),
              Effect.scoped,
            ),
        mutationRequest(),
      ),
    ).resolves.toEqual({ name: 'after' })
    expect(transport.mock.calls[0][1]?.method).toBe('PATCH')
    expect(new Headers(transport.mock.calls[0][1]?.headers).get('x-workspace-slug')).toBe('one')
    expect(await new Response(transport.mock.calls[0][1]?.body).text()).toBe('{"name":"after"}')
  })

  it.each([undefined, 'https://evil.test'])('rejects missing/cross-site mutation origin %s', async (origin) => {
    const transport = vi.fn<typeof fetch>()
    await expect(
      withApi(
        transport,
        (api) => api.execute(api.send('/api/issues/one', { method: 'DELETE' })),
        new Request(frontUrl, { method: 'POST', headers: origin ? { origin } : undefined }),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(transport).not.toHaveBeenCalled()
  })

  it('keeps raw file streams alive until their owning scope ends and supports empty success bodies', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('file'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await withApi(
      transport,
      (api) =>
        Effect.scoped(
          Effect.gen(function* () {
            const response = yield* api.execute(api.raw('/api/files/file', { accept: '*/*' }))
            expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(false)
            expect(yield* response.text).toBe('file')
            expect((yield* api.execute(api.raw('/api/files/file', { method: 'DELETE' }))).status).toBe(204)
          }),
        ),
      mutationRequest(),
    )
    expect(transport.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true)
  })

  it('interrupts and aborts in-flight HTTP when the incoming request disconnects', async () => {
    const controller = new AbortController()
    const started = gate()
    let outgoingSignal: AbortSignal | null | undefined
    const transport = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      outgoingSignal = init?.signal
      started.resolve()
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        }),
      )
    })
    const pending = withApi(
      transport,
      (api) => readName(api).pipe(Effect.exit),
      new Request(frontUrl, { signal: controller.signal }),
    )
    await started.promise
    controller.abort()
    const exit = await pending
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
    expect(outgoingSignal?.aborted).toBe(true)
  })

  it('keeps fiber interruption as interruption rather than an ApiError', async () => {
    const started = gate()
    let outgoingSignal: AbortSignal | null | undefined
    const transport = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      outgoingSignal = init?.signal
      started.resolve()
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        }),
      )
    })
    await withApi(transport, (api) =>
      Effect.gen(function* () {
        const fiber = yield* readName(api).pipe(Effect.forkChild)
        yield* Effect.promise(() => started.promise)
        yield* Fiber.interrupt(fiber)
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
      }),
    )
    expect(outgoingSignal?.aborted).toBe(true)
  })

  it('does not execute another request once the incoming request is aborted', async () => {
    const controller = new AbortController()
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: 'first' }))
    await withApi(
      transport,
      (api) =>
        Effect.gen(function* () {
          yield* readName(api)
          controller.abort()
          const exit = yield* readName(api).pipe(Effect.exit)
          expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
        }),
      new Request(frontUrl, { signal: controller.signal }),
    )
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
