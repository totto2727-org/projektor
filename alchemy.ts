import { Effect } from 'effect'

import { DeploymentEnvironment } from './worker-environment.ts'
import { Api } from './workers/api.ts'
import { Core } from './workers/core.ts'
import { Frontend } from './workers/frontend.ts'

export const WorkerResources = Effect.gen(function* () {
  const core = yield* Core
  const api = yield* Api
  const frontend = yield* Frontend
  const environment = yield* DeploymentEnvironment
  yield* environment.bindApi(api)
  return { core, api, frontend }
})
