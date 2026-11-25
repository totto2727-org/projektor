import type { Effect } from 'effect'
import { makeCoreClient } from 'projektor/core-client'

import { RequestScopeSchema } from '#core/web/scope.ts'
import type { RequestScope, ScopeOptions } from '#core/web/scope.ts'
import { browserRequest, coreResult } from '@/core.ts'

import type { ApiError, ScopeError } from './errors.ts'

export * from '#core/web/scope.ts'

export const loadRequestScope = function loadRequestScope(
  _url: URL,
  options: ScopeOptions,
  services: Readonly<{ request: Request; env: { readonly CORE: unknown } }>,
): Effect.Effect<RequestScope, ApiError | ScopeError> {
  const core = makeCoreClient(services.env.CORE)
  // Cache keys are Data.Class instances. Only a plain DTO may cross native RPC.
  const input: ScopeOptions = {
    requireProject: options.requireProject,
    requireWorkspace: options.requireWorkspace,
    projectHint: options.projectHint,
    workspaceHint: options.workspaceHint,
  }
  return coreResult(RequestScopeSchema, core.browserScope(browserRequest(services.request), input))
}
