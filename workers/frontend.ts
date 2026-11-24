import { RemovalPolicy } from 'alchemy'
import { adopt } from 'alchemy/AdoptPolicy'
import * as Cloudflare from 'alchemy/Cloudflare'
import { Effect } from 'effect'

import { DeploymentEnvironment, DeploymentLayer, rateLimiterReference } from '../worker-environment.ts'
import { deployment } from '../worker-graph.ts'
import { Core } from './core.ts'

class FrontendIdentity extends Cloudflare.Worker<FrontendIdentity>()(
  'Frontend',
  Effect.gen(function* () {
    const environment = yield* DeploymentEnvironment
    return {
      name: deployment.frontend.name,
      main: deployment.frontend.main,
      compatibility: deployment.frontend.compatibility,
      workersDev: { enabled: false, previewsEnabled: false },
      domain: { name: deployment.frontend.hostname, previews: false },
      env: { ...environment.frontendEnv, CORE: yield* Core, RATE_LIMITER: rateLimiterReference() },
      vite: { rootDir: '.', viteEnvironments: { entry: 'rsc', children: ['ssr'] } },
    }
  }),
  Effect.promise(() => import('../src/web/worker.ts')).pipe(Effect.flatMap(({ makeWebWorker }) => makeWebWorker())),
) {}

export const Frontend = FrontendIdentity.pipe(adopt(true), RemovalPolicy.retain())

// oxlint-disable-next-line import/no-default-export -- Alchemy bundles the frontend Worker runtime from the default export.
export default Frontend.pipe(Effect.provide(DeploymentLayer))
