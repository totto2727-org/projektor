import { Effect } from 'effect'

import { Core, DeploymentLayer } from './alchemy'

export default Core.pipe(Effect.provide(DeploymentLayer))
