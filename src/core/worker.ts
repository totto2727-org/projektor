import { Request as WorkerRequest } from 'alchemy/Cloudflare/Workers'
import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'

import { handleApiBinaryRequest } from './api/files'
import { makeApiCoreHandlers } from './api/operations'
import type { CoreShape } from './contract'
import { coreEnvironment, type CoreEnvironmentSource } from './environment'
import { handleCoreFileRequest } from './files'
import { handleSharedLogoRequest } from './shared-logo'
import { makeWebCoreHandlers } from './web/operations'

/** Stable named handlers, with environment Effects resolved inside each invocation. */
export const makeCoreHandlersWithEnvironment = (environment: CoreEnvironmentSource) =>
  Effect.sync(
    () =>
      ({
        ...makeApiCoreHandlers(environment),
        ...makeWebCoreHandlers(environment),
        fetch: Effect.gen(function* () {
          const env = yield* environment
          const request = yield* WorkerRequest
          const response = yield* Effect.promise(
            async () =>
              (await handleApiBinaryRequest(request, env)) ??
              (await handleSharedLogoRequest(request, env)) ??
              (await handleCoreFileRequest(request, env)),
          )
          return HttpServerResponse.fromWeb(response)
        }),
      }) satisfies CoreShape,
  )

export const makeCoreHandlers = makeCoreHandlersWithEnvironment(coreEnvironment)
