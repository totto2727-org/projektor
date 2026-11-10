import { Request as WorkerRequest } from 'alchemy/Cloudflare/Workers'
import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'

import { handleApiBinaryRequest } from './api/files'
import { makeApiCoreHandlers } from './api/operations'
import type { CoreShape } from './contract'
import { coreEnvironment } from './environment'
import { handleCoreFileRequest } from './files'
import { handleSharedLogoRequest } from './shared-logo'
import { makeWebCoreHandlers } from './web/operations'

/** Stable named handlers, with environment Effects resolved inside each invocation. */
export const makeCoreHandlers = Effect.sync(
  () =>
    ({
      ...makeApiCoreHandlers(coreEnvironment),
      ...makeWebCoreHandlers(coreEnvironment),
      fetch: Effect.gen(function* () {
        const env = yield* coreEnvironment
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
