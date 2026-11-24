import { Request as WorkerRequest } from 'alchemy/Cloudflare/Workers'
import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'

import { handleApiBinaryRequest } from './api/files.ts'
import { makeApiCoreHandlers } from './api/operations.ts'
import type { CoreShape } from './contract.ts'
import { coreEnvironment } from './environment.ts'
import type { CoreEnvironmentSource } from './environment.ts'
import { handleCoreFileRequest } from './files.ts'
import { handleSharedLogoRequest } from './shared-logo.ts'
import { makeWebCoreHandlers } from './web/operations.ts'

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
