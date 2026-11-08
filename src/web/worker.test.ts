import type { Request as WorkerRequest, WorkerEnvironment } from 'alchemy/Cloudflare/Workers'
import type { Effect, Scope } from 'effect'
import type { HttpServerRequest, HttpServerResponse } from 'effect/http'
import { expectTypeOf, it } from 'vite-plus/test'

import type { makeWebWorker } from './worker'

type Construction = ReturnType<typeof makeWebWorker>
type Fetch = Effect.Success<Construction>['fetch']

it('keeps Web Worker construction and request contracts concrete across the configured application adapter', () => {
  expectTypeOf<Effect.Error<Construction>>().toEqualTypeOf<never>()
  expectTypeOf<Effect.Services<Construction>>().toEqualTypeOf<never>()
  expectTypeOf<Effect.Error<Fetch>>().toEqualTypeOf<never>()
  expectTypeOf<Effect.Success<Fetch>>().toEqualTypeOf<HttpServerResponse.HttpServerResponse>()
  expectTypeOf<Effect.Services<Fetch>>().toEqualTypeOf<
    WorkerRequest | WorkerEnvironment | HttpServerRequest.HttpServerRequest | Scope.Scope
  >()
  expectTypeOf<Effect.Services<Construction>>().not.toBeAny()
  expectTypeOf<Effect.Services<Fetch>>().not.toBeAny()
  expectTypeOf<Effect.Error<Construction>>().not.toBeAny()
  expectTypeOf<Effect.Error<Fetch>>().not.toBeAny()
})
