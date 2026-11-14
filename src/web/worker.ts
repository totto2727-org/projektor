import { makeApplicationHttpEffect } from '@effront/alchemy/cloudflare/application'
import { Request as WorkerRequest } from 'alchemy/Cloudflare/Workers'
import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'

import { transferCoreBinary } from './core-binary'
import type application from './entry.effront'
import { downloadFile } from './file-download'
import { RequestServices, RequestServicesLive } from './request'
import { ScopeError } from './server/errors'
import { sessionNavigation } from './session-navigation'

function logoResponse(request: Request) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    const pathname = new URL(request.url).pathname
    const publicLogo = /^\/api\/share\/([^/]+)\/logo$/.exec(pathname)
    const workspaceLogo = /^\/api\/workspaces\/([^/]+)\/brand\/logo$/.exec(pathname)
    const value = publicLogo?.[1] ?? workspaceLogo?.[1]
    if (!value) return yield* new ScopeError(404, 'Not found')
    const selector = yield* Effect.try({
      try: () => decodeURIComponent(value),
      catch: () => new ScopeError(400, 'Invalid logo address.'),
    })
    const path = publicLogo
      ? `/share-logo/${encodeURIComponent(selector)}`
      : yield* services
          .scope({ workspaceHint: selector, projectHint: '', requireWorkspace: true })
          .pipe(
            Effect.flatMap((scope) =>
              scope.selection.kind === 'workspace' || scope.selection.kind === 'project'
                ? Effect.succeed(`/workspace-logo?workspaceId=${encodeURIComponent(scope.selection.workspace.id)}`)
                : Effect.fail(new ScopeError(403, 'Selected workspace is not accessible.')),
            ),
          )
    const object = yield* transferCoreBinary(path, { method: request.method })
    const headers = {
      'content-type': object.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    }
    if (request.method === 'HEAD') return HttpServerResponse.empty({ headers })
    return HttpServerResponse.fromWeb(new Response(object.body, { headers }))
  })
}

/** Runtime behavior lives here, independently of deployment resources and environments. */
export const makeWebWorker = () =>
  Effect.gen(function* () {
    const applicationHttpEffect = yield* makeApplicationHttpEffect<typeof application>()
    const fetch = Effect.gen(function* () {
      const request = yield* WorkerRequest
      const url = new URL(request.url)
      if (url.pathname === '/auth/session') return yield* sessionNavigation(request)
      if (url.pathname === '/auth/login') {
        if (request.method !== 'GET' && request.method !== 'HEAD')
          return HttpServerResponse.empty({ status: 405, headers: { allow: 'GET, HEAD' } })
        const requested = url.searchParams.get('redirect_url') ?? '/'
        const destination = new URL(requested.startsWith('/') ? requested : '/', url.origin)
        const location =
          destination.origin === url.origin ? `${destination.pathname}${destination.search}${destination.hash}` : '/'
        return HttpServerResponse.redirect(location, { status: 302, headers: { 'cache-control': 'private, no-store' } })
      }
      if (/^\/api\/files\/[^/]+$/.test(url.pathname))
        return yield* downloadFile(request).pipe(Effect.provide(RequestServicesLive))
      if (/^\/api\/(?:share\/[^/]+\/logo|workspaces\/[^/]+\/brand\/logo)$/.test(url.pathname)) {
        if (request.method !== 'GET' && request.method !== 'HEAD')
          return HttpServerResponse.empty({ status: 405, headers: { allow: 'GET, HEAD' } })
        return yield* logoResponse(request).pipe(Effect.provide(RequestServicesLive))
      }
      return yield* applicationHttpEffect
    }).pipe(
      Effect.catchTags({
        ApiError: (error) =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              { error: error.message },
              { status: error.status, headers: { 'cache-control': 'private, no-store' } },
            ),
          ),
        ScopeError: (error) =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              { error: error.message },
              { status: error.status, headers: { 'cache-control': 'private, no-store' } },
            ),
          ),
      }),
      Effect.orDie,
    )
    return { fetch }
  })
