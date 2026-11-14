import { Effect } from 'effect'

import { DeploymentEnvironment } from './worker-environment'
import { Api } from './workers/api'
import { Core } from './workers/core'
import { Frontend } from './workers/frontend'

export const WorkerResources = Effect.gen(function* () {
  const core = yield* Core
  const api = yield* Api
  const frontend = yield* Frontend
  const environment = yield* DeploymentEnvironment
  yield* environment.bindApi(api)
  return { core, api, frontend }
})
