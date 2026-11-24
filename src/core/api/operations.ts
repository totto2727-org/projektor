import { Effect, Schema } from 'effect'

import { coreReply } from '#core/contract.ts'
import { publicDomainFailure } from '#core/domain-errors.ts'
import type { CoreEnvironment } from '#core/environment.ts'

import { makeApiDomainHandlers } from './domain-operations.ts'
import { makeApiIdentityHandlers } from './identity-operations.ts'
import { runMaintenance } from './maintenance.ts'
import { makeApiPublicHandlers } from './public-operations.ts'
import { makeApiRateLimitHandlers } from './rate-limit.ts'

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
