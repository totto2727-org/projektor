import { Effect, Schema } from 'effect'

import type { CoreReply } from '#core/contract.ts'
import { coreReply } from '#core/contract.ts'
import { publicDomainFailure } from '#core/domain-errors.ts'
import type { CoreEnvironment } from '#core/environment.ts'

import { makeApiDomainHandlers } from './domain-operations.ts'
import { makeApiIdentityHandlers } from './identity-operations.ts'
import { runMaintenance } from './maintenance.ts'
import { makeApiPublicHandlers } from './public-operations.ts'
import { makeApiRateLimitHandlers } from './rate-limit.ts'

/**
 * Compose the named API operation families.
 *
 * @param {Effect.Effect<CoreEnvironment, never, R>} envSource Effect that provides Core bindings to each operation.
 * @returns {ReturnType<typeof makeApiCoreHandlers>} The named identity, domain, public, rate limit and maintenance handlers.
 */
export const makeApiCoreHandlers = function makeApiCoreHandlers<R>(
  envSource: Effect.Effect<CoreEnvironment, never, R>,
) {
  return {
    ...makeApiIdentityHandlers(envSource),
    ...makeApiDomainHandlers(envSource),
    ...makeApiPublicHandlers(envSource),
    ...makeApiRateLimitHandlers(envSource),
    apiMaintenance: (): CoreReply<R> =>
      coreReply(
        'apiMaintenance',
        Schema.Null,
        Effect.flatMap(envSource, (env) =>
          Effect.tryPromise({
            catch: publicDomainFailure,
            try: async () => {
              await runMaintenance(env)
              return null
            },
          }),
        ),
      ),
  }
}
export type ApiCoreRpcShape = ReturnType<typeof makeApiCoreHandlers<never>>
