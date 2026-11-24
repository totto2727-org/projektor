import { RemovalPolicy } from 'alchemy'
import { Effect } from 'effect'

import { Core as CoreIdentity } from '../src/workers/identities.ts'
import { DeploymentEnvironment, DeploymentLayer, rateLimiterReference } from '../worker-environment.ts'
import { deployment } from '../worker-graph.ts'

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
  Effect.promise(() => import('../src/core/worker.ts')).pipe(
    Effect.flatMap(({ makeCoreHandlers }) => makeCoreHandlers),
  ),
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

// oxlint-disable-next-line import/no-default-export -- Alchemy bundles the private Core Worker runtime from the default export.
export default Core.pipe(Effect.provide(DeploymentLayer))
