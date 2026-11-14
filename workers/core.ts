import { RemovalPolicy } from 'alchemy'
import { Effect } from 'effect'

import { Core as CoreIdentity } from '../src/workers/identities'
import { DeploymentEnvironment, DeploymentLayer, rateLimiterReference } from '../worker-environment'
import { deployment } from '../worker-graph'

const CoreLive = CoreIdentity.make(
  Effect.gen(function* () {
    const environment = yield* DeploymentEnvironment
    return {
      name: deployment.core.name,
      main: deployment.core.main,
      compatibility: deployment.core.compatibility,
      workersDev: { enabled: false, previewsEnabled: false },
      env: { ...environment.coreEnv, RATE_LIMITER: rateLimiterReference() },
    }
  }),
  Effect.promise(() => import('../src/core/worker')).pipe(Effect.flatMap(({ makeCoreHandlers }) => makeCoreHandlers)),
)

export const Core = CoreIdentity.pipe(
  Effect.provide(CoreLive),
  RemovalPolicy.retain(),
  Effect.tap((core) =>
    Effect.gen(function* () {
      const environment = yield* DeploymentEnvironment
      yield* environment.bindCore(core)
    }),
  ),
)

export default Core.pipe(Effect.provide(DeploymentLayer))
