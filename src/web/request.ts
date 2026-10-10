import type { D1Database } from '@cloudflare/workers-types'
import { Request as WorkerRequest, WorkerEnvironment } from 'alchemy/Cloudflare/Workers'
import { Cache, Context, Data, Effect, Exit, Layer, Option } from 'effect'
import { HttpRouter } from 'effect/http'
import type { ReactNode } from 'react'

import type { BrowserAuthEnvironment } from '#services/authentication'
import type { Env as ApiEnvironment } from '#types'

import { type ApiError, loadRequestScope, type RequestScope, type ScopeError, type ScopeOptions } from './server'

export interface Env
  extends
    BrowserAuthEnvironment,
    Pick<
      ApiEnvironment,
      | 'R2'
      | 'OAUTH_KV'
      | 'RATE_LIMITER'
      | 'WORKSPACE_HUB'
      | 'STORAGE_QUOTA_BYTES'
      | 'RATE_LIMIT_AUTH_MAX'
      | 'RATE_LIMIT_API_MAX'
      | 'RATE_LIMIT_WINDOW_SECS'
      | 'RATE_LIMIT_TEST_EPOCH'
      | 'RATE_LIMIT_TEST_NOW_MS'
      | 'BRAND_NAME'
      | 'BRAND_MARK'
      | 'BRAND_ACCENT'
      | 'BRAND_ON_ACCENT'
      | 'BRAND_LOGO_URL'
    > {}

export type PageFailure = ApiError | ScopeError
export type PreparedView = Effect.Effect<Awaited<ReactNode>, PageFailure, RequestServices>

class ScopeKey extends Data.Class<ScopeOptions> {}

export type RouteParams = Readonly<Record<string, string | undefined>>
/** Read the framework's matched route, never match or decode the path again. */
export const getRouteParams: Effect.Effect<RouteParams> = Effect.serviceOption(HttpRouter.RouteContext).pipe(
  Effect.map((context) => (Option.isSome(context) ? context.value.params : {})),
)

export class RequestServices extends Context.Service<
  RequestServices,
  {
    readonly request: Request
    readonly env: Env
    readonly url: URL
    readonly db: D1Database
    readonly scope: (options?: ScopeOptions) => Effect.Effect<RequestScope, PageFailure>
    readonly prepare: (view: PreparedView) => PreparedView
    readonly invalidate: Effect.Effect<void>
  }
>()('projektor/ssr/RequestServices') {}

/** Construct services without creating a nested runtime or any cross-request cache. */
export const makeRequestServices = (request: Request, env: Env) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    const scopes = yield* Cache.makeWith(
      (options: ScopeOptions) => loadRequestScope(url, options, { db: env.DB, request, env }),
      { capacity: 32, timeToLive: (exit) => (Exit.isSuccess(exit) ? Infinity : 0) },
    )
    const views = yield* Cache.makeWith((view: PreparedView) => view, {
      capacity: 32,
      requireServicesAt: 'lookup',
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Infinity : 0),
    })
    return {
      request,
      env,
      url,
      db: env.DB,
      scope: (options: ScopeOptions = {}) =>
        getRouteParams.pipe(
          Effect.flatMap((params) =>
            Cache.get(scopes, new ScopeKey({ ...options, projectHint: options.projectHint ?? params.projectSlug })),
          ),
        ),
      prepare: (view: PreparedView) => Cache.get(views, view),
      invalidate: Effect.gen(function* () {
        yield* Cache.invalidateAll(scopes)
        yield* Cache.invalidateAll(views)
      }),
    }
  })

/** Effront owns this Layer and its caches for one request through streaming completion. */
export const RequestServicesLive = Layer.effect(
  RequestServices,
  Effect.gen(function* () {
    const request = yield* WorkerRequest
    const env = yield* WorkerEnvironment
    return yield* makeRequestServices(request, env as unknown as Env)
  }),
)
