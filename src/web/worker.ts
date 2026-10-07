import { makeApplicationHttpEffect } from '@effront/alchemy/cloudflare'
import { Request as WorkerRequest } from 'alchemy/Cloudflare/Workers'
import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'

import { forwardApi } from './gateway'
import { HttpClientLive } from './http-client-layer'
import { sessionNavigation } from './session-navigation'

/** Runtime behavior lives here, independently of deployment resources and environments. */
export const makeWebWorker = (apiBase: string) =>
  Effect.gen(function* () {
    const application = yield* makeApplicationHttpEffect(() =>
      import('./entry.effront').then((module) => module.default),
    )
    const fetch = Effect.gen(function* () {
      const request = yield* WorkerRequest
      const url = new URL(request.url)
      if (url.pathname === '/auth/session') return yield* sessionNavigation(request)
      if (
        (request.method === 'GET' || request.method === 'HEAD') &&
        (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/files/'))
      ) {
        const headers = new Headers(request.headers)
        const workspace = url.searchParams.get('workspace')
        if (url.pathname.startsWith('/api/files/') && workspace) headers.set('X-Workspace-Slug', workspace)
        return yield* forwardApi(new Request(request, { headers }), { API_BASE: apiBase }).pipe(
          Effect.provide(HttpClientLive),
        )
      }
      return yield* application
    }).pipe(
      Effect.catchTag('ApiError', (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status, headers: { 'cache-control': 'private, no-store' } },
          ),
        ),
      ),
      Effect.orDie,
    )
    return { fetch }
  })
