import type { Effect } from 'effect'
import { makeCoreClient } from 'projektor/core-client'

import { RequestScopeSchema, type RequestScope, type ScopeOptions } from '../../core/web/scope'
import { browserRequest, coreResult } from '../core'
import type { ApiError, ScopeError } from './errors'

export * from '../../core/web/scope'

export function loadRequestScope(
  _url: URL,
  options: ScopeOptions,
  services: { readonly request: Request; readonly env: { readonly CORE: unknown } },
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
