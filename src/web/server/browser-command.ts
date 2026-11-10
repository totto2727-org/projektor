import { Effect } from 'effect'

import type { CoreRpcShape } from '../../core/contract'
import type { BrowserCommand } from '../../core/web/command-contract'
import { browserRequest } from '../core'
import { RequestServices } from '../request'
import { requireDataWorkspace } from './data-context'
import { ApiError, ScopeError } from './errors'
import type { FunctionContext } from './function-context'

export interface BrowserCommandClient {
  readonly proof: BrowserCommand
  readonly core: CoreRpcShape
}

/** Local composition only. Neither a callback nor a capability crosses the native binding. */
export function runBrowserCommand<A, E, R>(
  context: FunctionContext,
  operation: (client: BrowserCommandClient) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    const workspace = yield* Effect.try({
      try: () => requireDataWorkspace(context.scope),
      catch: (cause) =>
        cause instanceof ScopeError ? cause : new ApiError('request', 403, 'Selected workspace is not accessible.'),
    })
    return yield* operation({
      proof: {
        request: browserRequest(services.request),
        workspaceSlug: context.workspaceSlug ?? workspace.slug,
        ...(context.projectId ? { projectId: context.projectId } : {}),
      },
      core: services.core,
    })
  })
}
