import { Request as WorkerRequest, WorkerEnvironment } from 'alchemy/Cloudflare/Workers'
import { Predicate, Cache, Context, Data, Effect, Exit, Layer, Option, Schema } from 'effect'
import { HttpRouter } from 'effect/http'
import { makeCoreClient } from 'projektor/core-client'
import type { ReactNode } from 'react'

import type { CoreRpcShape } from '#core/contract.ts'
import type { Env as ApiEnvironment } from '#types'

import { loadRequestScope } from './server/server-context.ts'
import type { ApiError, RequestScope, ScopeError, ScopeOptions } from './server/server-context.ts'

export type Env = Pick<
  ApiEnvironment,
  | 'ENVIRONMENT'
  | 'RATE_LIMITER'
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
> &
  Readonly<{ CORE: Readonly<{ fetch: (request: Request) => Promise<Response> }> }>

const isMissingBinding = Schema.is(Schema.Undefined)

export const isWebEnvironment = function isWebEnvironment(value: unknown): value is Env {
  if (!Predicate.isObjectOrArray(value)) {
    return false
  }
  const core: unknown = Reflect.get(value, 'CORE')
  if (!Predicate.isObjectOrArray(core) || !Predicate.isFunction(Reflect.get(core, 'fetch'))) {
    return false
  }
  if (
    !['development', 'staging', 'production'].some((environment) => environment === Reflect.get(value, 'ENVIRONMENT'))
  ) {
    return false
  }
  const limiter: unknown = Reflect.get(value, 'RATE_LIMITER')
  if (
    !isMissingBinding(limiter) &&
    (!Predicate.isObjectOrArray(limiter) ||
      !Predicate.isFunction(Reflect.get(limiter, 'get')) ||
      !Predicate.isFunction(Reflect.get(limiter, 'idFromName')))
  ) {
    return false
  }
  const strings = [
    'RATE_LIMIT_AUTH_MAX',
    'RATE_LIMIT_API_MAX',
    'RATE_LIMIT_WINDOW_SECS',
    'RATE_LIMIT_TEST_EPOCH',
    'RATE_LIMIT_TEST_NOW_MS',
    'BRAND_NAME',
    'BRAND_MARK',
    'BRAND_ACCENT',
    'BRAND_ON_ACCENT',
    'BRAND_LOGO_URL',
  ] satisfies Readonly<(keyof Env)[]>
  return strings.every(
    (key) => isMissingBinding(Reflect.get(value, key)) || Predicate.isString(Reflect.get(value, key)),
  )
}

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
  Readonly<{
    request: Request
    core: CoreRpcShape
    env: Env
    url: URL
    scope: (options?: ScopeOptions) => Effect.Effect<RequestScope, PageFailure>
    prepare: (view: PreparedView) => PreparedView
    invalidate: Effect.Effect<void>
  }>
>()('projektor/ssr/RequestServices') {}

/**
 * Construct services without creating a nested runtime or any cross-request cache.
 *
 * @param {Request} request The browser request for the lifetime of the request-local caches.
 * @param {Env} env The Web Worker environment with its Core binding.
 * @returns {ReturnType<typeof makeRequestServices>} An effect that constructs the request services and their scope and view caches.
 */
export const makeRequestServices = (request: Request, env: Env) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    const scopes = yield* Cache.makeWith((options: ScopeOptions) => loadRequestScope(url, options, { env, request }), {
      capacity: 32,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Infinity : 0),
    })
    const views = yield* Cache.makeWith((view: PreparedView) => view, {
      capacity: 32,
      requireServicesAt: 'lookup',
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Infinity : 0),
    })
    return {
      request,
      core: makeCoreClient(env.CORE),
      env,
      url,
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
    if (!isWebEnvironment(env)) {
      return yield* Effect.die(new Error('Invalid Web Worker bindings'))
    }
    return yield* makeRequestServices(request, env)
  }),
)
