import { RemovalPolicy } from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import { Effect } from 'effect'

import { DeploymentEnvironment } from '../worker-environment'
import { deployment } from '../worker-graph'
import { Core } from './core'

// The configured native entrypoint exports HTTP handlers and the existing Durable Object classes.
export const Api = Cloudflare.Worker(
  'Api',
  Effect.gen(function* () {
    const environment = yield* DeploymentEnvironment
    return {
      name: deployment.api.name,
      main: deployment.api.main,
      compatibility: deployment.api.compatibility,
      workersDev: { enabled: false, previewsEnabled: false },
      domain: { name: deployment.api.hostname, previews: false },
      crons: deployment.api.crons,
      env: {
        ...environment.apiEnv,
        CORE: yield* Core,
        // Keep the existing namespace hosted on its original physical Worker.
        RATE_LIMITER: Cloudflare.DurableObject('RateLimiter', { className: 'RateLimiter' }),
      },
    }
  }),
).pipe(RemovalPolicy.retain())
