import type { Effect } from 'effect'

import { makeCoreClient } from '../../core/client'
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
  return coreResult(RequestScopeSchema, core.browserScope(browserRequest(services.request), options))
}
