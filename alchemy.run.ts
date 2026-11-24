import { ALCHEMY_DEV, localState, Stack } from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import { Effect, Layer } from 'effect'

import { WorkerResources } from './alchemy.ts'
import { DeploymentLayer } from './worker-environment.ts'

export const workers = WorkerResources.pipe(Effect.provide(DeploymentLayer))

// Development stays entirely local. Production state survives ephemeral CI runners
// in Alchemy's official encrypted Cloudflare state store, not plaintext artifacts.
export const DeploymentState = Layer.unwrap(
  ALCHEMY_DEV.pipe(
    Effect.orDie,
    Effect.map((dev) => (dev ? localState() : Cloudflare.state())),
  ),
)

// oxlint-disable-next-line import/no-default-export -- Alchemy loads the deployment stack from the default export.
export default Stack(
  'projektor',
  { state: DeploymentState, providers: Cloudflare.providers() },
  workers.pipe(Effect.map(({ api, frontend }) => ({ api: api.url, frontend: frontend.url }))),
)
