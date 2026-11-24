import { Effect } from 'effect'

import { HTTP_FORBIDDEN } from '#contracts/http-status.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import type { CoreRpcShape } from '#core/contract.ts'
import type { BrowserCommand } from '#core/web/command-contract.ts'
import { browserRequest } from '@/core.ts'
import { RequestServices } from '@/request.ts'

import { requireDataWorkspace } from './data-context.ts'
import { ApiError, ScopeError } from './errors.ts'
import type { FunctionContext } from './function-context.ts'

export interface BrowserCommandClient {
  readonly proof: BrowserCommand
  readonly core: CoreRpcShape
}

/** Local composition only. Neither a callback nor a capability crosses the native binding. */
export const runBrowserCommand = function runBrowserCommand<A, E, R>(
  context: FunctionContext,
  operation: (client: BrowserCommandClient) => Effect.Effect<A, E, R>,
): Effect.Effect<A, ApiError | ScopeError | E, RequestServices | R> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    const auth = context.scope.auth
    if (!auth || auth.kind !== 'human' || (auth.method !== 'access' && auth.method !== 'dev')) {
      return yield* new ScopeError(HTTP_FORBIDDEN, 'An interactive browser session is required.')
    }
    const workspace = yield* Effect.try({
      catch: (cause) =>
        cause instanceof ScopeError
          ? cause
          : new ApiError('request', HTTP_FORBIDDEN, 'Selected workspace is not accessible.'),
      try: () => requireDataWorkspace(context.scope),
    })
    return yield* operation({
      proof: {
        request: browserRequest(services.request),
        workspaceSlug: context.workspaceSlug ?? workspace.slug,
        ...(isNonEmptyText(context.projectId) ? { projectId: context.projectId } : {}),
      },
      core: services.core,
    })
  })
}
