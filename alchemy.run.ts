import { localState, Stack } from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import { Effect } from 'effect'

import { DeploymentLayer, WorkerResources } from './alchemy'

export const workers = WorkerResources.pipe(Effect.provide(DeploymentLayer))

export default Stack(
  'projektor',
  { state: localState(), providers: Cloudflare.providers() },
  workers.pipe(Effect.map(({ api, frontend }) => ({ api: api.url, frontend: frontend.url }))),
)
