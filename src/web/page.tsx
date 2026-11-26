import { Predicate, Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'
import type { ReactNode } from 'react'

import {
  HTTP_BAD_REQUEST,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_UNAUTHORIZED,
  HTTP_UNPROCESSABLE_CONTENT,
} from '#contracts/http-status.ts'

import { RuntimeProvider } from './client/runtime.tsx'
import { ProjectNav } from './components/project-nav.tsx'
import { EFFRONT } from './effront.ts'
import { getRouteParams, RequestServices } from './request.ts'
import type { Env, PageFailure, PreparedView, RouteParams } from './request.ts'
import { ScopeSelection } from './selection.tsx'
import type { RequestScope, ScopeOptions } from './server/server-context.ts'

export type RouteRenderer = (
  scope: RequestScope,
  url: URL,
  params: RouteParams,
) => Effect.Effect<ReactNode, PageFailure, RequestServices>
export type PublicRenderer = (
  env: Env,
  scope: null,
  url: URL,
  params: RouteParams,
) => Effect.Effect<ReactNode, PageFailure, RequestServices>

const errorResponse = function errorResponse(error: PageFailure): HttpServerResponse.HttpServerResponse {
  const { status } = error
  const message =
    status === HTTP_UNAUTHORIZED
      ? 'Your session has expired. Refresh this page to sign in.'
      : status === HTTP_FORBIDDEN
        ? 'You do not have access to this workspace or project.'
        : status === HTTP_NOT_FOUND
          ? 'The requested page was not found.'
          : status === HTTP_UNPROCESSABLE_CONTENT
            ? 'This view exceeds its supported data range. Narrow the date or issue filters, or use the paginated issue list.'
            : status === HTTP_BAD_REQUEST
              ? 'The page address is invalid.'
              : 'The page is temporarily unavailable. Please try again.'
  return HttpServerResponse.text(
    `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Projektor</title><main><h1>${message}</h1><a href="/">View projects</a></main></html>`,
    {
      status,
      contentType: 'text/html; charset=utf-8',
      headers: { 'cache-control': 'private, no-store' },
    },
  )
}

/**
 * Prepare typed initial data before HTTP streaming, preserving denial/error statuses.
 *
 * @param {RouteRenderer | PublicRenderer} render The scoped or public route renderer that supplies the page content.
 * @param {ScopeOptions & { public?: boolean; projectNav?: boolean }} options Route scope requirements and public-page or project-navigation settings.
 * @returns {ReturnType<typeof pageRenderer>} The Effront page factory and the request-local render effect.
 */
export const pageRenderer = function pageRenderer(
  render: RouteRenderer | PublicRenderer,
  options: ScopeOptions & { public?: boolean; projectNav?: boolean } = {},
) {
  const view: PreparedView = Effect.gen(function* () {
    const services = yield* RequestServices
    const params = yield* getRouteParams
    const scope = options.public === true ? null : yield* services.scope(options)
    let content: ReactNode
    if (Predicate.isNullish(scope)) {
      content = yield* (render as PublicRenderer)(services.env, null, services.url, params)
    } else if (scope.selection.kind === 'selection-required') {
      content = <ScopeSelection scope={scope} url={services.url} />
    } else {
      content = yield* (render as RouteRenderer)(scope, services.url, params)
    }
    return (
      <RuntimeProvider key={services.url.href} scope={scope} url={services.url.href}>
        {options.projectNav && scope?.selection.kind === 'project' && (
          <ProjectNav scope={scope} url={services.url.href} />
        )}
        {content}
      </RuntimeProvider>
    )
  })
  const prepare = Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* services.prepare(view)
  })
  const Check = EFFRONT.Middleware.make((httpEffect) =>
    Effect.gen(function* () {
      const { request } = yield* RequestServices
      // Mutate first, then refresh. A POST must never preload stale primary data.
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return yield* httpEffect
      }
      const prepared = yield* prepare.pipe(Effect.result)
      if (prepared._tag === 'Failure') {
        return errorResponse(prepared.failure)
      }
      return yield* httpEffect
    }),
  )
  return { factory: EFFRONT.withMiddleware(Check), render: () => prepare }
}
