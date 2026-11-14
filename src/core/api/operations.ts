import { Effect, Schema } from 'effect'

import { coreReply } from '../contract'
import { publicDomainFailure } from '../domain-errors'
import type { CoreEnvironment } from '../environment'
import { makeApiDomainHandlers } from './domain-operations'
import { makeApiIdentityHandlers } from './identity-operations'
import { runMaintenance } from './maintenance'
import { makeApiPublicHandlers } from './public-operations'
import { makeApiRateLimitHandlers } from './rate-limit'

/** Compose concrete named families without an operation dispatcher or protocol proxy. */
export function makeApiCoreHandlers<R>(envSource: Effect.Effect<CoreEnvironment, never, R>) {
  return {
    ...makeApiIdentityHandlers(envSource),
    ...makeApiDomainHandlers(envSource),
    ...makeApiPublicHandlers(envSource),
    ...makeApiRateLimitHandlers(envSource),
    apiMaintenance: () =>
      coreReply(
        'apiMaintenance',
        Schema.Null,
        Effect.flatMap(envSource, (env) =>
          Effect.tryPromise({
            try: async () => {
              await runMaintenance(env)
              return null
            },
            catch: publicDomainFailure,
          }),
        ),
      ),
  }
}
export type ApiCoreRpcShape = ReturnType<typeof makeApiCoreHandlers<never>>
